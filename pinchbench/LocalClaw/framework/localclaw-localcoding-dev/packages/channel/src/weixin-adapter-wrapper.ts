import type { ChannelMessage, ChannelAdapter } from "golembot";
import type { WeixinAdapter } from "golembot/dist/channels/weixin.js";
import { randomUUID } from "node:crypto";

const ILINK_BASE_URL = "https://ilinkai.weixin.qq.com";

/**
 * 包装 golembot 原生 WeixinAdapter，解决微信渠道在 gateway streaming 下的三个问题：
 *
 * 1. thinking 气泡：微信无可编辑/可删除消息，无法承载 gateway 的 "⏳ thinking..."。
 *    提供 no-op sendStatus（返回""）+ clearStatus，使 gateway 走状态分支而非
 *    fallback adapter.reply()，statusMessageId 为 falsy 后续 update/finalize 全跳过 → 零气泡。
 *
 * 2. context_token 限次 + 单轮 ~10 条上限：见下方 reply / flushPending 注释。
 *
 * 3. 不提供 typing：iLink 的「正在输入」一旦发出（sendtyping status:1）既不会自然过期、
 *    也无可用的停止手段（status:0 虽返回 ret:0 但实测不清除状态，会持续显示到用户下次
 *    发消息）。故本 wrapper **不实现 typing**，gateway 检测到 adapter 无 typing 即不发
 *    输入指示器。处理中的反馈由 streaming 首段气泡的快速到达体现。
 */
export function enhanceWeixinAdapter(
  adapter: WeixinAdapter,
  token: string,
  baseUrl?: string,
): ChannelAdapter {
  const apiBase = (baseUrl || ILINK_BASE_URL).replace(/\/$/, "");

  // ── pollLoop 死亡看门狗 ──
  // golembot 原生 WeixinAdapter 在 token 失效（getupdates 返回 401）时会把内部
  // running 置 false 并静默 return，既不抛错也不通知外层。adapter.start() 早已
  // resolve，故 startWithRetry 永远等不到 reject，渠道停在「connected 却无回复」。
  // 这里轮询底层 running 标志，检测到非主动停止的翻转即触发 onPollDead，由
  // GolemChannelManager 据此把状态翻成 error，避免假阳性绿点。
  let pollDeadCb: (() => void) | undefined;
  let watchdog: ReturnType<typeof setInterval> | undefined;
  let stopped = false;

  function startWatchdog(): void {
    if (watchdog) clearInterval(watchdog);
    watchdog = setInterval(() => {
      if (stopped) return;
      // 底层 pollLoop 401 后置 running=false（正常运行时恒为 true）
      if ((adapter as any).running === false) {
        if (watchdog) { clearInterval(watchdog); watchdog = undefined; }
        console.error("[weixin-wrapper] pollLoop died (token likely expired), notifying manager");
        pollDeadCb?.();
      }
    }, 15_000);
    (watchdog as any).unref?.();
  }

  async function start(onMessage: (msg: ChannelMessage) => void): Promise<void> {
    stopped = false;
    await adapter.start(onMessage);
    startWatchdog();
  }

  async function stop(): Promise<void> {
    stopped = true;
    if (watchdog) { clearInterval(watchdog); watchdog = undefined; }
    await adapter.stop();
  }

  function headers(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      AuthorizationType: "ilink_bot_token",
      Authorization: `Bearer ${token}`,
      "X-WECHAT-UIN": String(Math.floor(Math.random() * 1_000_000_000)),
    };
  }

  // ── 状态消息 no-op（消除 thinking 气泡）──
  async function sendStatus(_msg: ChannelMessage, _text: string): Promise<string> {
    return "";
  }
  async function updateStatus(): Promise<void> {}
  async function clearStatus(): Promise<void> {}

  // ── 流式多段 reply：阈值合并 + 封顶（规避微信 iLink 单轮 ~10 条消息上限）──
  //
  // 微信 iLink 对单轮交互的主动推送消息数有 ~10 条上限（context_token="" 反刷屏限制），
  // 超出静默丢弃。gateway streaming 按段落 flush 一段一条 reply，长回复 >10 段时尾部丢失。
  //
  // 策略：按 sender 维护本轮累积缓冲。每次 reply 追加文本，达到 COALESCE_THRESHOLD
  // 才真正发出一条气泡（合并小段落）；流式气泡封顶 MAX_STREAM_BUBBLES，达顶后剩余全部
  // 囤积，由轮末 flushPending 一次性发出。总气泡数 ≤ MAX_STREAM_BUBBLES + 1 ≤ 10。
  //
  // context_token 限次修复（沿用已验证设计）：本轮首条用真实 context_token（正经回复），
  // 后续条用空 context_token（主动推送模式）。
  const COALESCE_THRESHOLD = 1500;
  const MAX_STREAM_BUBBLES = 9;
  const repliedMsgs = new WeakSet<object>();
  type TurnState = { buffer: string; bubbleCount: number; contextToken: string };
  const turnState = new Map<string, TurnState>();

  /** 实际向 iLink 发送一条消息。isFirst 用真实 context_token，否则空串走主动推送。 */
  async function doSend(userId: string, text: string, contextToken: string, isFirst: boolean): Promise<void> {
    if (!text.trim()) return;
    const body = {
      msg: {
        from_user_id: "",
        to_user_id: userId,
        client_id: randomUUID(),
        message_type: 2,
        message_state: 2,
        context_token: isFirst ? contextToken : "",
        item_list: [{ type: 1, text_item: { text } }],
      },
      base_info: { channel_version: "0.1.0" },
    };
    try {
      const res = await fetch(`${apiBase}/ilink/bot/sendmessage`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        console.error(`[weixin-wrapper] sendmessage failed: HTTP ${res.status} (first=${isFirst})`);
      }
    } catch (e) {
      console.error(`[weixin-wrapper] sendmessage error: ${(e as Error)?.message} (first=${isFirst})`);
    }
  }

  async function reply(msg: ChannelMessage, text: string): Promise<void> {
    if (!text.trim()) return;
    const userId = msg.senderId;
    // 本轮首次 reply：重置该 sender 缓冲，记录 context_token
    if (!repliedMsgs.has(msg as object)) {
      repliedMsgs.add(msg as object);
      turnState.set(userId, {
        buffer: "",
        bubbleCount: 0,
        contextToken: (msg as any).raw?.context_token || "",
      });
    }
    const st = turnState.get(userId) ?? { buffer: "", bubbleCount: 0, contextToken: "" };
    st.buffer += st.buffer ? `\n\n${text}` : text;

    // 未达封顶且累积超阈值 → 合并发一条气泡
    if (st.bubbleCount < MAX_STREAM_BUBBLES && st.buffer.length >= COALESCE_THRESHOLD) {
      const isFirst = st.bubbleCount === 0;
      await doSend(userId, st.buffer, st.contextToken, isFirst);
      st.bubbleCount++;
      st.buffer = "";
    }
    turnState.set(userId, st);
  }

  /** 轮末发送剩余缓冲（由 manager 在 handleMessage resolve 后调用）。 */
  async function flushPending(msg: ChannelMessage): Promise<void> {
    const userId = msg.senderId;
    const st = turnState.get(userId);
    if (!st) return;
    if (st.buffer.trim()) {
      const isFirst = st.bubbleCount === 0;
      await doSend(userId, st.buffer, st.contextToken, isFirst);
    }
    turnState.delete(userId);
  }

  return {
    name: "weixin",
    maxMessageLength: adapter.maxMessageLength,
    start,
    stop,
    reply,
    flushPending,
    send: adapter.send?.bind(adapter),
    listChats: adapter.listChats?.bind(adapter),
    sendStatus,
    updateStatus,
    clearStatus,
    /** 由 GolemChannelManager 注册：pollLoop 因 token 失效静默死亡时回调 */
    setPollDeadHandler(cb: () => void) { pollDeadCb = cb; },
  } as ChannelAdapter & {
    flushPending: (msg: ChannelMessage) => Promise<void>;
    setPollDeadHandler: (cb: () => void) => void;
  };
}
