import { describe, it, expect, vi } from "vitest";
import { createAdapterFromChannel } from "../adapter-factory";

// Mock fs module so tests are isolated from the real account.json on disk
vi.mock("node:fs", () => ({
  existsSync: () => false,
  readFileSync: () => '{"token":"mock"}',
}));

describe("createAdapterFromChannel", () => {
  it("feishu type 返回 FeishuAdapter 实例", () => {
    const adapter = createAdapterFromChannel({
      id: "x", type: "feishu", name: "n", enabled: true,
      credentials: { appId: "a", appSecret: "b" },
      status: "disconnected", createdAt: 0, updatedAt: 0,
    } as any);
    expect(adapter).not.toBeNull();
    expect(adapter?.name).toBe("feishu");
  });

  it("wechat 无 token 时返回 null（未扫码登录）", () => {
    const adapter = createAdapterFromChannel({
      id: "x", type: "wechat", name: "n", enabled: true,
      credentials: {}, status: "disconnected", createdAt: 0, updatedAt: 0,
    } as any);
    // 凭据为空且 account.json 不存在时返回 null
    expect(adapter).toBeNull();
  });

  it("wechat 有 token 时返回增强的 WeixinAdapter", () => {
    const adapter = createAdapterFromChannel({
      id: "x", type: "wechat", name: "n", enabled: true,
      credentials: { token: "test_token_12345" },
      status: "disconnected", createdAt: 0, updatedAt: 0,
    } as any);
    expect(adapter).not.toBeNull();
    expect(adapter?.name).toBe("weixin");
    // wrapper 补了 flushPending（流式合并）与 no-op sendStatus（消除 thinking 气泡）；
    // 不提供 typing（iLink 输入状态无法停止，故不发）。
    expect(typeof (adapter as any).flushPending).toBe("function");
    expect(typeof (adapter as any).sendStatus).toBe("function");
    expect((adapter as any).typing).toBeUndefined();
  });

  it("缺少必填字段不抛但返回 null", () => {
    const adapter = createAdapterFromChannel({
      id: "x", type: "feishu", name: "n", enabled: true,
      credentials: {}, status: "disconnected", createdAt: 0, updatedAt: 0,
    } as any);
    expect(adapter).toBeNull();
  });

  it("wecom credentials 完整时返回 WecomAdapter", () => {
    const adapter = createAdapterFromChannel({
      id: "x", type: "wecom", name: "n", enabled: true,
      credentials: { botId: "ww_xxx", secret: "abc" },
      status: "disconnected", createdAt: 0, updatedAt: 0,
    } as any);
    expect(adapter).not.toBeNull();
    expect(adapter?.name).toBe("wecom");
  });
});
