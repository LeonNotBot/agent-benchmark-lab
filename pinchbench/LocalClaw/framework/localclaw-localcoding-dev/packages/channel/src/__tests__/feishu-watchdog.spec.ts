import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { enhanceFeishuAdapter } from "../feishu-adapter-wrapper";

/**
 * 用一个最小 FeishuAdapter 替身验证接收侧看门狗：
 * - 空闲超阈值后主动强制关闭旧 WSClient 并重新 start（防半开连接）
 * - 进站事件 / 出站活动刷新计时，阻止重建
 * - stop() 停掉看门狗并强制关连接
 */
function makeFakeAdapter() {
  const close = vi.fn();
  const fake: any = {
    name: "feishu",
    maxMessageLength: 4000,
    wsClient: { close },
    startCalls: 0,
    lastOnMessage: undefined as ((m: any) => void) | undefined,
    start: vi.fn(async function (onMessage: (m: any) => void) {
      fake.startCalls++;
      fake.lastOnMessage = onMessage;
    }),
    stop: vi.fn(async () => {}),
    reply: vi.fn(async () => {}),
  };
  return fake;
}

describe("enhanceFeishuAdapter 看门狗", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    process.env.FEISHU_WS_IDLE_REBUILD_MS = "240000"; // 4 分钟
  });
  afterEach(() => {
    vi.useRealTimers();
    delete process.env.FEISHU_WS_IDLE_REBUILD_MS;
  });

  it("空闲超阈值后强制关旧连接并重建", async () => {
    const fake = makeFakeAdapter();
    const adapter = enhanceFeishuAdapter(fake);
    await adapter.start(() => {});
    expect(fake.startCalls).toBe(1);

    // 推进超过阈值（看门狗每 60s 检查一次）
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

    expect(fake.wsClient.close).toHaveBeenCalledWith({ force: true });
    expect(fake.startCalls).toBe(2);
  });

  it("进站事件刷新活动时间，阻止重建", async () => {
    const fake = makeFakeAdapter();
    const adapter = enhanceFeishuAdapter(fake);
    await adapter.start(() => {});

    // 每 2 分钟来一条进站消息，持续 10 分钟
    for (let i = 0; i < 5; i++) {
      await vi.advanceTimersByTimeAsync(2 * 60 * 1000);
      fake.lastOnMessage?.({ chatId: "c", text: "hi" });
    }

    expect(fake.startCalls).toBe(1); // 从未重建
  });

  it("stop() 停看门狗并强制关连接", async () => {
    const fake = makeFakeAdapter();
    const adapter = enhanceFeishuAdapter(fake);
    await adapter.start(() => {});
    await adapter.stop!();

    expect(fake.wsClient.close).toHaveBeenCalledWith({ force: true });
    expect(fake.stop).toHaveBeenCalled();

    // stop 之后即使长时间空闲也不再重建
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    expect(fake.startCalls).toBe(1);
  });
});
