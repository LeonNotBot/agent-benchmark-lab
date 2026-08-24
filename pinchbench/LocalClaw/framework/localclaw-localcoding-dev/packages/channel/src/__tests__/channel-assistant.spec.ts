import { describe, it, expect, vi } from "vitest";
import { ChannelAssistant } from "../channel-assistant";

describe("ChannelAssistant", () => {
  function makeMocks() {
    const runnerService = {
      createRunner: vi.fn(async (opts: any) => {
        setTimeout(() => {
          // Mimic RunnerSpawnService: emit an SDKResultMessage carrying the
          // final summary, then a session.status='completed'.
          opts.onEvent({
            type: "stream.message",
            payload: {
              sessionId: opts.session.id,
              message: { type: "result", subtype: "success", result: "hello" },
            },
          });
          opts.onEvent({
            type: "session.status",
            payload: { sessionId: opts.session.id, status: "completed" },
          });
        }, 0);
        return { handle: { abort: vi.fn() }, envOverrides: {} };
      }),
    };
    const mockSession = {
      id: "sess-1",
      title: "ch",
      status: "idle" as const,
      kind: "channel" as const,
      pendingPermissions: new Map(),
    };
    const sessionService = {
      createSession: vi.fn(() => ({ ...mockSession })),
      getSession: vi.fn(() => undefined),
      recordMessage: vi.fn(),
      updateSession: vi.fn(),
    };
    const chatSessions = {
      resolve: vi.fn((chatId: string, channelId: string) =>
        chatId === "c" && channelId === "ch"
          ? { chatId, channelId, workspaceDir: "/w", sessionKey: null }
          : null,
      ),
      setSessionKey: vi.fn(),
    };
    return { runnerService, sessionService, chatSessions, mockSession };
  }

  it("chat() yields stream events 并完成", async () => {
    const m = makeMocks();
    const a = new ChannelAssistant(
      m.runnerService as any,
      m.sessionService as any,
      m.chatSessions as any,
      "ch",
    );
    const events: any[] = [];
    for await (const e of a.chat("hi", { sessionKey: "feishu:c:user1" })) events.push(e);
    expect(m.runnerService.createRunner).toHaveBeenCalledOnce();
    expect(events.length).toBeGreaterThan(0);
  });

  it("缺少绑定时抛出错误", async () => {
    const m = makeMocks();
    m.chatSessions.resolve = vi.fn(() => null) as any;
    const a = new ChannelAssistant(
      m.runnerService as any,
      m.sessionService as any,
      m.chatSessions as any,
      "ch",
    );
    const iter = a.chat("hi", { sessionKey: "feishu:c:user1" })[Symbol.asyncIterator]();
    await expect(iter.next()).rejects.toThrow();
  });

  it("cancel() 调用 RunnerHandle.abort 后返回 true", async () => {
    const m = makeMocks();
    const abortFn = vi.fn();
    m.runnerService.createRunner = vi.fn(async (opts: any) => {
      setTimeout(
        () =>
          opts.onEvent({
            type: "session.status",
            payload: { sessionId: opts.session.id, status: "completed" },
          }),
        50,
      );
      return { handle: { abort: abortFn }, envOverrides: {} };
    });
    const a = new ChannelAssistant(
      m.runnerService as any,
      m.sessionService as any,
      m.chatSessions as any,
      "ch",
    );

    const iter = a.chat("hi", { sessionKey: "feishu:c:user1" });
    const it = iter[Symbol.asyncIterator]();
    await new Promise((r) => setTimeout(r, 5));
    const ok = await a.cancel("feishu:c:user1");
    expect(ok).toBe(true);
    expect(abortFn).toHaveBeenCalled();
    while (!(await it.next()).done) {
      /* drain */
    }
  });

  it("解析 GolemBot 格式 sessionKey (channelType:chatId:senderId)", async () => {
    const m = makeMocks();
    const a = new ChannelAssistant(
      m.runnerService as any,
      m.sessionService as any,
      m.chatSessions as any,
      "ch",
    );
    const events: any[] = [];
    for await (const e of a.chat("hi", { sessionKey: "feishu:c:user1" })) events.push(e);
    expect(m.runnerService.createRunner).toHaveBeenCalledOnce();
  });

  it("解析 GolemBot group 格式 sessionKey (channelType:chatId)", async () => {
    const m = makeMocks();
    const a = new ChannelAssistant(
      m.runnerService as any,
      m.sessionService as any,
      m.chatSessions as any,
      "ch",
    );
    const events: any[] = [];
    for await (const e of a.chat("hi", { sessionKey: "feishu:c" })) events.push(e);
    expect(m.runnerService.createRunner).toHaveBeenCalledOnce();
  });

  it("工作目录变更后复用旧 session：同步 cwd + 清空 resume，并以新目录 spawn", async () => {
    const m = makeMocks();
    // binding 指向新工作目录，且已有 sessionKey（说明此前发过消息）
    m.chatSessions.resolve = vi.fn(() => ({
      chatId: "c", channelId: "ch", workspaceDir: "/new/dir", sessionKey: "sess-1",
    })) as any;
    // 复用的 session 仍持有旧 cwd 和旧 claudeSessionId
    let stored = { ...m.mockSession, cwd: "/old/dir", claudeSessionId: "claude-old" };
    m.sessionService.getSession = vi.fn(() => stored) as any;
    m.sessionService.updateSession = vi.fn((_id: string, updates: any) => {
      stored = { ...stored, ...updates };
      return stored;
    }) as any;

    const a = new ChannelAssistant(
      m.runnerService as any,
      m.sessionService as any,
      m.chatSessions as any,
      "ch",
    );
    const events: any[] = [];
    for await (const e of a.chat("hi", { sessionKey: "feishu:c:user1" })) events.push(e);

    // 必须同步 cwd 到新目录、并清空 claudeSessionId
    expect(m.sessionService.updateSession).toHaveBeenCalledWith("sess-1", {
      cwd: "/new/dir",
      claudeSessionId: undefined,
    });
    // 不得新建会话（仍复用 sess-1）
    expect(m.sessionService.createSession).not.toHaveBeenCalled();
    // 传给 runner 的 session.cwd 是新目录，resume 上下文已清空
    const opts = m.runnerService.createRunner.mock.calls[0][0];
    expect(opts.session.cwd).toBe("/new/dir");
    expect(opts.resumeSessionId).toBeUndefined();
  });

  it("工作目录未变时复用 session：不触发 cwd 重置", async () => {
    const m = makeMocks();
    m.chatSessions.resolve = vi.fn(() => ({
      chatId: "c", channelId: "ch", workspaceDir: "/same/dir", sessionKey: "sess-1",
    })) as any;
    const stored = { ...m.mockSession, cwd: "/same/dir", claudeSessionId: "claude-x" };
    m.sessionService.getSession = vi.fn(() => stored) as any;

    const a = new ChannelAssistant(
      m.runnerService as any,
      m.sessionService as any,
      m.chatSessions as any,
      "ch",
    );
    const events: any[] = [];
    for await (const e of a.chat("hi", { sessionKey: "feishu:c:user1" })) events.push(e);

    expect(m.sessionService.updateSession).not.toHaveBeenCalledWith(
      "sess-1",
      expect.objectContaining({ cwd: expect.anything() }),
    );
    const opts = m.runnerService.createRunner.mock.calls[0][0];
    expect(opts.resumeSessionId).toBe("claude-x"); // resume 上下文保留
  });
});
