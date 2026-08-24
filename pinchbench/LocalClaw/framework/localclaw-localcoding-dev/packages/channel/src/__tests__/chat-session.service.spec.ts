import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { ChatSessionService } from "../chat-session.service";

describe("ChatSessionService", () => {
  let db: Database.Database;
  let svc: ChatSessionService;

  beforeEach(() => {
    db = new Database(":memory:");
    db.exec(`CREATE TABLE chat_sessions (
      chat_id TEXT NOT NULL, channel_id TEXT NOT NULL,
      workspace_dir TEXT NOT NULL, session_key TEXT,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      PRIMARY KEY (chat_id, channel_id)
    )`);
    svc = new ChatSessionService(db);
  });

  it("首次 resolve 返回 null（未绑定）", () => {
    expect(svc.resolve("chat1", "ch1")).toBeNull();
  });

  it("bind 后 resolve 返回正确数据", () => {
    svc.bind("chat1", "ch1", "/work");
    expect(svc.resolve("chat1", "ch1")).toMatchObject({
      chatId: "chat1", channelId: "ch1", workspaceDir: "/work", sessionKey: null,
    });
  });

  it("setSessionKey 持久化", () => {
    svc.bind("chat1", "ch1", "/work");
    svc.setSessionKey("chat1", "ch1", "sess-123");
    expect(svc.resolve("chat1", "ch1")?.sessionKey).toBe("sess-123");
  });

  it("不同 channel 同一 chat_id 互不干扰", () => {
    svc.bind("c", "ch1", "/a");
    svc.bind("c", "ch2", "/b");
    expect(svc.resolve("c", "ch1")?.workspaceDir).toBe("/a");
    expect(svc.resolve("c", "ch2")?.workspaceDir).toBe("/b");
  });

  it("updateByChannelId 同步更新该渠道所有绑定的工作目录", () => {
    // 建立两个不同用户的会话绑定（旧工作目录）
    svc.bind("user1", "ch1", "/old/work/dir");
    svc.bind("user2", "ch1", "/old/work/dir");
    svc.bind("user3", "ch2", "/other/dir"); // 另一个渠道不受影响

    // 修改 ch1 的工作目录后，同步更新
    svc.updateByChannelId("ch1", "/new/work/dir");

    expect(svc.resolve("user1", "ch1")?.workspaceDir).toBe("/new/work/dir");
    expect(svc.resolve("user2", "ch1")?.workspaceDir).toBe("/new/work/dir");
    // 其他渠道不受影响
    expect(svc.resolve("user3", "ch2")?.workspaceDir).toBe("/other/dir");
  });
});
