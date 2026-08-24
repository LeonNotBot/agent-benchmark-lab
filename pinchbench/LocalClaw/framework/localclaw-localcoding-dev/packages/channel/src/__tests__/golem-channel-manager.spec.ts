import { describe, it, expect, vi } from "vitest";
import { GolemChannelManager } from "../golem-channel-manager";

// mock 真实 golembot handleMessage：漂移检测发生在它之前，测试只关心 re-bind 行为。
vi.mock("golembot/dist/gateway.js", () => ({
  handleMessage: vi.fn(async () => {}),
}));

describe("GolemChannelManager", () => {
  function makeMocks() {
    const adapterMock: any = {
      name: "feishu",
      start: vi.fn(async (cb: any) => {
        adapterMock._cb = cb;
      }),
      stop: vi.fn(async () => {}),
      reply: vi.fn(),
      _cb: null,
    };
    return {
      runner: { createRunner: vi.fn() },
      sessions: { createSession: vi.fn(), getSession: vi.fn() },
      chatSessions: { resolve: vi.fn(() => null), bind: vi.fn(), setSessionKey: vi.fn() },
      messageRecord: { recordIncoming: vi.fn(), recordOutgoing: vi.fn() },
      bridge: { emitSessionUpdate: vi.fn(), emitStreamMessage: vi.fn(), emitNewMessage: vi.fn() },
      adapterFactory: vi.fn(() => adapterMock),
      monitor: { checkNow: vi.fn(async () => ({})) },
      routing: { getActiveCloudModel: vi.fn(() => ({ modelName: "m", label: "M" })), onActiveModelChange: vi.fn(() => () => {}) },
      db: { prepare: vi.fn(() => ({ run: vi.fn(), get: vi.fn(), all: vi.fn(() => []) })) },
      adapterMock,
    };
  }

  it("startChannel 创建 adapter 并 start", async () => {
    const m = makeMocks();
    const mgr = new GolemChannelManager(
      m.runner as any,
      m.sessions as any,
      m.chatSessions as any,
      m.messageRecord as any,
      m.bridge as any,
      m.adapterFactory as any,
      m.monitor as any,
      m.routing as any,
      m.db as any,
    );
    await mgr.startChannel({
      id: "c1",
      type: "feishu",
      name: "n",
      credentials: {},
      enabled: true,
      engine: "golembot",
    } as any);
    expect(m.adapterFactory).toHaveBeenCalledOnce();
    expect(m.adapterMock.start).toHaveBeenCalled();
    expect(mgr.isRunning("c1")).toBe(true);
  });

  it("stopChannel 调用 adapter.stop", async () => {
    const m = makeMocks();
    const mgr = new GolemChannelManager(
      m.runner as any,
      m.sessions as any,
      m.chatSessions as any,
      m.messageRecord as any,
      m.bridge as any,
      m.adapterFactory as any,
      m.monitor as any,
      m.routing as any,
      m.db as any,
    );
    await mgr.startChannel({
      id: "c1",
      type: "feishu",
      name: "n",
      credentials: {},
      enabled: true,
      engine: "golembot",
    } as any);
    await mgr.stopChannel("c1");
    expect(m.adapterMock.stop).toHaveBeenCalled();
    expect(mgr.isRunning("c1")).toBe(false);
  });

  it("不支持的 type / 返回 null 的 factory 不启动", async () => {
    const m = makeMocks();
    m.adapterFactory = vi.fn(() => null);
    const mgr = new GolemChannelManager(
      m.runner as any,
      m.sessions as any,
      m.chatSessions as any,
      m.messageRecord as any,
      m.bridge as any,
      m.adapterFactory as any,
      m.monitor as any,
      m.routing as any,
      m.db as any,
    );
    await mgr.startChannel({
      id: "c1",
      type: "wechat",
      name: "n",
      credentials: {},
      enabled: true,
      engine: "golembot",
    } as any);
    expect(mgr.isRunning("c1")).toBe(false);
  });

  it("legacy engine 的 channel 跳过", async () => {
    const m = makeMocks();
    const mgr = new GolemChannelManager(
      m.runner as any,
      m.sessions as any,
      m.chatSessions as any,
      m.messageRecord as any,
      m.bridge as any,
      m.adapterFactory as any,
      m.monitor as any,
      m.routing as any,
      m.db as any,
    );
    await mgr.startChannel({
      id: "c1",
      type: "wechat",
      name: "n",
      credentials: {},
      enabled: true,
      engine: "legacy",
    } as any);
    expect(m.adapterFactory).not.toHaveBeenCalled();
    expect(mgr.isRunning("c1")).toBe(false);
  });

  it("/bind 命令可绑定 workspace", async () => {
    const m = makeMocks();
    const mgr = new GolemChannelManager(
      m.runner as any,
      m.sessions as any,
      m.chatSessions as any,
      m.messageRecord as any,
      m.bridge as any,
      m.adapterFactory as any,
      m.monitor as any,
      m.routing as any,
      m.db as any,
    );
    await mgr.startChannel({
      id: "c1",
      type: "feishu",
      name: "n",
      credentials: {},
      enabled: true,
      engine: "golembot",
    } as any);
    const validDir = process.cwd();
    const incoming = {
      channelType: "feishu",
      chatId: "chatX",
      chatType: "dm" as const,
      senderId: "u1",
      text: `/bind ${validDir}`,
      raw: {},
    };
    await m.adapterMock._cb(incoming);
    expect(m.chatSessions.bind).toHaveBeenCalledWith("chatX", "c1", validDir);
    expect(m.adapterMock.reply).toHaveBeenCalled();
  });

  it("/bind 不存在的路径时返回错误提示且不绑定", async () => {
    const m = makeMocks();
    const mgr = new GolemChannelManager(
      m.runner as any,
      m.sessions as any,
      m.chatSessions as any,
      m.messageRecord as any,
      m.bridge as any,
      m.adapterFactory as any,
      m.monitor as any,
      m.routing as any,
      m.db as any,
    );
    await mgr.startChannel({
      id: "c1",
      type: "feishu",
      name: "n",
      credentials: {},
      enabled: true,
      engine: "golembot",
    } as any);
    const incoming = {
      channelType: "feishu",
      chatId: "chatX",
      chatType: "dm" as const,
      senderId: "u1",
      text: "/bind /this/path/definitely/does/not/exist/xyz123",
      raw: {},
    };
    await m.adapterMock._cb(incoming);
    expect(m.chatSessions.bind).not.toHaveBeenCalled();
    const replyArg = m.adapterMock.reply.mock.calls[0][1];
    expect(replyArg).toContain("路径不存在");
  });

  it("/bind 相对路径时返回错误提示且不绑定", async () => {
    const m = makeMocks();
    const mgr = new GolemChannelManager(
      m.runner as any,
      m.sessions as any,
      m.chatSessions as any,
      m.messageRecord as any,
      m.bridge as any,
      m.adapterFactory as any,
      m.monitor as any,
      m.routing as any,
      m.db as any,
    );
    await mgr.startChannel({
      id: "c1",
      type: "feishu",
      name: "n",
      credentials: {},
      enabled: true,
      engine: "golembot",
    } as any);
    const incoming = {
      channelType: "feishu",
      chatId: "chatX",
      chatType: "dm" as const,
      senderId: "u1",
      text: "/bind ./relative/path",
      raw: {},
    };
    await m.adapterMock._cb(incoming);
    expect(m.chatSessions.bind).not.toHaveBeenCalled();
    const replyArg = m.adapterMock.reply.mock.calls[0][1];
    expect(replyArg).toContain("绝对路径");
  });

  it("工作目录漂移：已绑定旧目录但 channel 配置已改，自愈 re-bind 到新目录", async () => {
    const m = makeMocks();
    // 已有绑定，但指向旧目录
    m.chatSessions.resolve = vi.fn(() => ({
      chatId: "chatX", channelId: "c1", workspaceDir: "/old/dir", sessionKey: "s1",
    })) as any;
    const mgr = new GolemChannelManager(
      m.runner as any, m.sessions as any, m.chatSessions as any,
      m.messageRecord as any, m.bridge as any, m.adapterFactory as any,
      m.monitor as any, m.routing as any, m.db as any,
    );
    // channel 配置已是新目录（restartChannel 后闭包持有的最新值）
    await mgr.startChannel({
      id: "c1", type: "feishu", name: "n", credentials: {},
      enabled: true, engine: "golembot", workspaceDir: process.cwd(),
    } as any);
    await m.adapterMock._cb({
      channelType: "feishu", chatId: "chatX", chatType: "dm" as const,
      senderId: "u1", text: "你好", raw: {},
    });
    // 必须以 channel 配置为准 re-bind
    expect(m.chatSessions.bind).toHaveBeenCalledWith("chatX", "c1", process.cwd());
  });

  it("工作目录一致时不重复 re-bind", async () => {
    const m = makeMocks();
    m.chatSessions.resolve = vi.fn(() => ({
      chatId: "chatX", channelId: "c1", workspaceDir: process.cwd(), sessionKey: "s1",
    })) as any;
    const mgr = new GolemChannelManager(
      m.runner as any, m.sessions as any, m.chatSessions as any,
      m.messageRecord as any, m.bridge as any, m.adapterFactory as any,
      m.monitor as any, m.routing as any, m.db as any,
    );
    await mgr.startChannel({
      id: "c1", type: "feishu", name: "n", credentials: {},
      enabled: true, engine: "golembot", workspaceDir: process.cwd(),
    } as any);
    await m.adapterMock._cb({
      channelType: "feishu", chatId: "chatX", chatType: "dm" as const,
      senderId: "u1", text: "你好", raw: {},
    });
    expect(m.chatSessions.bind).not.toHaveBeenCalled();
  });
});
