import type { ChannelMessage, ChannelAdapter } from "golembot";
import { markdownToCard } from "golembot/dist/channels/feishu-format.js";
import type { FeishuAdapter } from "golembot/dist/channels/feishu.js";

/**
 * 给 FeishuAdapter 实例添加 typing / sendStatus / updateStatus / clearStatus 方法，
 * 使其支持 GolemBot Gateway 的流式回复能力。
 *
 * 所有方法通过 Feishu REST API 实现，复用 adapter 已建立的 client.tokenManager。
 */
export function enhanceFeishuAdapter(adapter: FeishuAdapter): ChannelAdapter {
  const originalReply = adapter.reply.bind(adapter);
  const originalStart = adapter.start.bind(adapter);
  const originalStop = adapter.stop.bind(adapter);
  const originalSend = adapter.send?.bind(adapter);
  const originalGetGroupMembers = adapter.getGroupMembers?.bind(adapter);
  const originalFetchHistory = adapter.fetchHistory?.bind(adapter);
  const originalListChats = adapter.listChats?.bind(adapter);

  // ── 接收侧看门狗：防 WebSocket 半开连接（NAT/防火墙静默丢弃 TCP，
  //    lark SDK 因从不校验 pong、只认 socket 'close' 事件而永不重连）。
  //
  //    策略：空闲即主动重建。任意进站事件刷新 lastActivity；空闲超过
  //    IDLE_REBUILD_MS（默认 4 分钟，安全低于常见 NAT 5~15 分钟超时）即
  //    强制关闭旧 WSClient 并重新 start，使连接始终保持「年轻」，永远不会
  //    老到被静默丢弃。活跃对话期间进站事件不断，看门狗不触发。
  //    重建窗口内到达的消息由飞书 at-least-once 重投 + seenMsgIds 去重兜底。
  const IDLE_REBUILD_MS = Number(process.env.FEISHU_WS_IDLE_REBUILD_MS) || 4 * 60 * 1000;
  const CHECK_INTERVAL_MS = 60 * 1000;
  let lastActivity = Date.now();
  let watchdog: ReturnType<typeof setInterval> | undefined;
  let savedOnMessage: ((msg: ChannelMessage) => void) | undefined;
  let rebuilding = false;
  let stopped = false;

  function touch(): void {
    lastActivity = Date.now();
  }

  function closeUnderlyingWs(): void {
    // adapter.stop() 只置 wsClient=null 不关连接，会泄漏 ping/reconnect 循环。
    // 直接拿底层 WSClient 强制关闭，停掉其内部定时器。
    try {
      (adapter as any).wsClient?.close?.({ force: true });
    } catch {
      /* best-effort */
    }
  }

  async function rebuild(): Promise<void> {
    if (rebuilding || stopped || !savedOnMessage) return;
    rebuilding = true;
    try {
      console.warn(
        `[feishu] WS idle > ${IDLE_REBUILD_MS}ms, rebuilding connection to avoid half-open`,
      );
      closeUnderlyingWs();
      await originalStart(savedOnMessage);
      touch();
      console.log("[feishu] WS connection rebuilt");
    } catch (e) {
      console.error("[feishu] WS rebuild failed:", (e as Error)?.message);
    } finally {
      rebuilding = false;
    }
  }

  function startWatchdog(): void {
    if (watchdog) clearInterval(watchdog);
    watchdog = setInterval(() => {
      if (stopped || rebuilding) return;
      if (Date.now() - lastActivity > IDLE_REBUILD_MS) {
        void rebuild();
      }
    }, CHECK_INTERVAL_MS);
    // 不阻止进程退出
    (watchdog as any).unref?.();
  }

  // 包裹 start：注入活动打点 + 启动看门狗。
  async function start(onMessage: (msg: ChannelMessage) => void): Promise<void> {
    stopped = false;
    savedOnMessage = (msg: ChannelMessage) => {
      touch();
      onMessage(msg);
    };
    await originalStart(savedOnMessage);
    touch();
    startWatchdog();
  }

  // 包裹 stop：停看门狗 + 强制关底层连接。
  async function stop(): Promise<void> {
    stopped = true;
    if (watchdog) {
      clearInterval(watchdog);
      watchdog = undefined;
    }
    closeUnderlyingWs();
    await originalStop();
  }

  // ── Token helper ──
  async function getToken(): Promise<string> {
    return (adapter as any).client.tokenManager.getTenantAccessToken();
  }

  function openApiUrl(path: string): string {
    const base = (adapter as any).openApiBaseUrl as string;
    return `${base}${path.startsWith("/") ? path : `/${path}`}`;
  }

  // ── typing ──
  async function typing(msg: ChannelMessage): Promise<void> {
    touch();
    try {
      const token = await getToken();
      await fetch(openApiUrl("/open-apis/im/v1/typing"), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          receive_id_type: "open_id",
          receive_id: msg.senderId,
          status: "typing",
        }),
      });
    } catch {
      /* typing is best-effort */
    }
  }

  // ── sendStatus / updateStatus / clearStatus ──
  // 使用 Feishu card（interactive）消息，支持创建后通过 PATCH 更新内容。
  const statusMessageIds = new Map<string, string>(); // chatId → message_id

  async function sendStatus(msg: ChannelMessage, text: string): Promise<string> {
    touch();
    // 如果已有同一 chat 的 status 消息，走 update 路径
    const existingId = statusMessageIds.get(msg.chatId);
    if (existingId) {
      await updateStatus(msg, existingId, text);
      return existingId;
    }
    try {
      const token = await getToken();
      const card = JSON.stringify(markdownToCard(text));
      const res = await fetch(
        openApiUrl("/open-apis/im/v1/messages?receive_id_type=chat_id"),
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            receive_id: msg.chatId,
            msg_type: "interactive",
            content: card,
          }),
        },
      );
      const json = (await res.json()) as { code: number; data?: { message_id: string } };
      if (json.code !== 0 || !json.data?.message_id) return "";
      const messageId = json.data.message_id;
      statusMessageIds.set(msg.chatId, messageId);
      return messageId;
    } catch {
      return "";
    }
  }

  async function updateStatus(_msg: ChannelMessage, statusId: string, text: string): Promise<void> {
    touch();
    try {
      const token = await getToken();
      const card = JSON.stringify(markdownToCard(text));
      await fetch(openApiUrl(`/open-apis/im/v1/messages/${statusId}`), {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ content: card }),
      });
    } catch {
      /* best-effort */
    }
  }

  async function clearStatus(_msg: ChannelMessage, statusId: string): Promise<void> {
    // Feishu 无删除消息 API，更新为 ✅ Done
    try {
      const token = await getToken();
      const card = JSON.stringify(markdownToCard("✅ Done"));
      await fetch(openApiUrl(`/open-apis/im/v1/messages/${statusId}`), {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ content: card }),
      });
    } catch {
      /* best-effort */
    }
  }

  // 包裹 reply：出站回复也算活动。
  const reply: typeof originalReply = async (msg, text, options) => {
    touch();
    return originalReply(msg, text, options);
  };

  return {
    name: "feishu",
    maxMessageLength: adapter.maxMessageLength,

    start,
    stop,
    reply,
    send: originalSend,
    getGroupMembers: originalGetGroupMembers,
    fetchHistory: originalFetchHistory,
    listChats: originalListChats,

    typing,
    sendStatus,
    updateStatus,
    clearStatus,
  };
}
