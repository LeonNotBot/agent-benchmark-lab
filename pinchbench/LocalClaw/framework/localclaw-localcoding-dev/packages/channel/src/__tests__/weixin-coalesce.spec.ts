import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { enhanceWeixinAdapter } from "../weixin-adapter-wrapper";

/**
 * 微信流式「阈值合并 + 封顶」测试：
 * 验证多段落合并成更少气泡（规避 iLink 单轮 ~10 条上限）、内容无丢失、
 * 首条用 context_token 后续用空 token。
 */
describe("enhanceWeixinAdapter 阈值合并", () => {
  const COALESCE_THRESHOLD = 1500;
  const MAX_STREAM_BUBBLES = 9;

  // 记录每次 sendmessage 的 body
  let sentBodies: any[];

  function makeAdapter() {
    // 最小 WeixinAdapter 桩：wrapper 只 bind start/stop/send/listChats + maxMessageLength
    const fake = {
      maxMessageLength: 2000,
      start: vi.fn(async () => {}),
      stop: vi.fn(async () => {}),
      reply: vi.fn(async () => {}),
      send: vi.fn(async () => {}),
      listChats: vi.fn(async () => []),
    };
    return enhanceWeixinAdapter(fake as any, "tok-real", "https://ilinkai.weixin.qq.com") as any;
  }

  function makeMsg(senderId = "u1", contextToken = "ctx-abc") {
    return { senderId, chatId: senderId, chatType: "dm", text: "", raw: { context_token: contextToken } } as any;
  }

  beforeEach(() => {
    sentBodies = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: any) => {
      // wrapper 已不发 typing，仅 sendmessage 走 fetch
      sentBodies.push(JSON.parse(init.body));
      return { ok: true, json: async () => ({}) } as any;
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  /** 提取所有发出消息的正文 */
  const sentTexts = () => sentBodies.map((b) => b.msg.item_list[0].text_item.text);

  it("短文本(<阈值)：reply 不发，flushPending 一次性发出", async () => {
    const a = makeAdapter();
    const msg = makeMsg();
    await a.reply(msg, "短回复");
    expect(sentBodies.length).toBe(0); // 未达阈值，未发
    await a.flushPending(msg);
    expect(sentBodies.length).toBe(1);
    expect(sentTexts()[0]).toBe("短回复");
  });

  it("多个小段落合并：20 段各 100 字 → 气泡数 ≤ 10 且内容无丢失", async () => {
    const a = makeAdapter();
    const msg = makeMsg();
    const segs = Array.from({ length: 20 }, (_, i) => `段落${i}`.padEnd(100, "x"));
    for (const s of segs) await a.reply(msg, s);
    await a.flushPending(msg);

    expect(sentBodies.length).toBeLessThanOrEqual(10);
    // 内容无丢失：所有发出正文拼回包含每一段
    const joined = sentTexts().join("\n\n");
    for (const s of segs) expect(joined).toContain(s);
  });

  it("首条用真实 context_token，后续用空串", async () => {
    const a = makeAdapter();
    const msg = makeMsg("u1", "ctx-xyz");
    // 连发至超过阈值触发首条
    await a.reply(msg, "x".repeat(COALESCE_THRESHOLD + 10));
    await a.reply(msg, "y".repeat(COALESCE_THRESHOLD + 10));
    await a.flushPending(msg);
    expect(sentBodies.length).toBeGreaterThanOrEqual(2);
    expect(sentBodies[0].msg.context_token).toBe("ctx-xyz");
    for (let i = 1; i < sentBodies.length; i++) {
      expect(sentBodies[i].msg.context_token).toBe("");
    }
  });

  it("超长(>封顶)：流式气泡封顶 9，剩余囤到轮末，总数 ≤ 10，无丢失", async () => {
    const a = makeAdapter();
    const msg = makeMsg();
    // 每段就超阈值 → 每段触发一条，共 15 段
    const segs = Array.from({ length: 15 }, (_, i) => `S${i}-`.padEnd(COALESCE_THRESHOLD + 5, "z"));
    for (const s of segs) await a.reply(msg, s);
    await a.flushPending(msg);

    expect(sentBodies.length).toBeLessThanOrEqual(MAX_STREAM_BUBBLES + 1);
    const joined = sentTexts().join("\n\n");
    for (const s of segs) expect(joined).toContain(s);
  });

  it("并发用户隔离：两个 sender 各自缓冲不串", async () => {
    const a = makeAdapter();
    const m1 = makeMsg("u1", "ctx-1");
    const m2 = makeMsg("u2", "ctx-2");
    await a.reply(m1, "用户1的内容");
    await a.reply(m2, "用户2的内容");
    await a.flushPending(m1);
    await a.flushPending(m2);
    const byUser = sentBodies.map((b) => ({ to: b.msg.to_user_id, text: b.msg.item_list[0].text_item.text }));
    expect(byUser.find((x) => x.to === "u1")?.text).toBe("用户1的内容");
    expect(byUser.find((x) => x.to === "u2")?.text).toBe("用户2的内容");
  });

  it("flushPending 无缓冲时安全 no-op", async () => {
    const a = makeAdapter();
    await a.flushPending(makeMsg());
    expect(sentBodies.length).toBe(0);
  });

  it("不提供 typing 方法（iLink typing 无法停止，故不发输入指示器）", () => {
    const a = makeAdapter();
    expect(a.typing).toBeUndefined();
  });
});
