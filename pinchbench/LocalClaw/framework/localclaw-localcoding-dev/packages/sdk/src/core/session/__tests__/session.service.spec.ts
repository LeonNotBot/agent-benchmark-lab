import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { SessionService } from "../session.service";
import { runSdkMigrations } from "../../../database/database.migrations";

/**
 * SessionService 单测：用内存 better-sqlite3 跑真实 SQL，不落盘、不连模型。
 * 每个用例一个全新内存库，保证隔离。generateSessionTitle 涉及模型调用，单独处理。
 */
function makeDb(): Database.Database {
  const db = new Database(":memory:");
  runSdkMigrations(db);
  return db;
}

function makeService(db: Database.Database): SessionService {
  return new SessionService(db);
}

describe("SessionService 会话 CRUD", () => {
  let db: Database.Database;
  let svc: SessionService;

  beforeEach(() => {
    db = makeDb();
    svc = makeService(db);
  });

  it("createSession 写库并返回带 idle 状态的会话", () => {
    const s = svc.createSession({ title: "测试会话", prompt: "hi", cwd: "/tmp" });
    expect(s.id).toBeTruthy();
    expect(s.status).toBe("idle");
    expect(s.kind).toBe("chat");
    expect(s.lastPrompt).toBe("hi");
    // 落库可被独立查询验证
    const row = db.prepare("select * from sessions where id = ?").get(s.id) as any;
    expect(row.title).toBe("测试会话");
    expect(row.cwd).toBe("/tmp");
  });

  it("getSession 从内存返回，未知 id 返回 undefined", () => {
    const s = svc.createSession({ title: "A" });
    expect(svc.getSession(s.id)?.id).toBe(s.id);
    expect(svc.getSession("nope")).toBeUndefined();
  });

  it("createSession 默认 kind=chat，可显式指定 cron/channel", () => {
    const cron = svc.createSession({ title: "C", kind: "cron" });
    expect(cron.kind).toBe("cron");
  });

  it("deleteSession 删除会话及级联消息/用量，返回 true", () => {
    const s = svc.createSession({ title: "待删" });
    svc.recordMessage(s.id, { type: "user_prompt", prompt: "x" } as any);
    svc.computeAndSaveUsageSummary(s.id);
    expect(svc.deleteSession(s.id)).toBe(true);
    expect(svc.getSession(s.id)).toBeUndefined();
    expect(db.prepare("select count(*) c from messages where session_id=?").get(s.id) as any).toEqual({ c: 0 });
    expect(db.prepare("select count(*) c from session_usage where session_id=?").get(s.id) as any).toEqual({ c: 0 });
  });

  it("deleteSession 未知 id 返回 false", () => {
    expect(svc.deleteSession("ghost")).toBe(false);
  });
});

describe("SessionService 更新与查询", () => {
  let db: Database.Database;
  let svc: SessionService;

  beforeEach(() => {
    db = makeDb();
    svc = makeService(db);
  });

  it("updateSession 同步内存与库，未知 id 返回 undefined", () => {
    const s = svc.createSession({ title: "原标题" });
    const updated = svc.updateSession(s.id, { title: "新标题", status: "running" });
    expect(updated?.title).toBe("新标题");
    expect(updated?.status).toBe("running");
    const row = db.prepare("select title, status from sessions where id=?").get(s.id) as any;
    expect(row.title).toBe("新标题");
    expect(row.status).toBe("running");
    expect(svc.updateSession("ghost", { title: "x" })).toBeUndefined();
  });

  it("listSessions 列出 chat 与 cron 类型，按 updated_at 倒序", () => {
    const a = svc.createSession({ title: "chat-A" });
    const cron = svc.createSession({ title: "cron-X", kind: "cron" });
    const b = svc.createSession({ title: "chat-B" });
    // 让 b 更晚更新
    svc.updateSession(b.id, { status: "completed" });
    const list = svc.listSessions();
    // 自动化上线后 listSessions 同时纳入 chat 与 cron 会话（其余 kind 不列）。
    expect(list.every((s) => s.kind === "chat" || s.kind === "cron")).toBe(true);
    expect(list.map((s) => s.id)).toContain(a.id);
    expect(list.map((s) => s.id)).toContain(b.id);
    expect(list.map((s) => s.id)).toContain(cron.id);
  });

  it("getSessionHistory 返回会话 + 按时间排序的消息，未知 id 返回 null", () => {
    const s = svc.createSession({ title: "带历史" });
    svc.recordMessage(s.id, { type: "user_prompt", prompt: "first" } as any);
    svc.recordMessage(s.id, { type: "user_prompt", prompt: "second" } as any);
    const hist = svc.getSessionHistory(s.id);
    expect(hist?.session.id).toBe(s.id);
    expect(hist?.messages).toHaveLength(2);
    expect(svc.getSessionHistory("ghost")).toBeNull();
  });

  it("recordMessage 用 insert or ignore，相同 uuid 不重复插入", () => {
    const s = svc.createSession({ title: "去重" });
    svc.recordMessage(s.id, { type: "result", uuid: "fixed-id" } as any);
    svc.recordMessage(s.id, { type: "result", uuid: "fixed-id" } as any);
    const c = db.prepare("select count(*) c from messages where session_id=?").get(s.id) as any;
    expect(c.c).toBe(1);
  });

  it("recordMessage 丢弃瞬时流式消息(stream_event/tool_progress)，不落库", () => {
    const s = svc.createSession({ title: "流式过滤" });
    svc.recordMessage(s.id, { type: "user_prompt", prompt: "hi" } as any);
    svc.recordMessage(s.id, { type: "stream_event", event: { type: "content_block_delta" } } as any);
    svc.recordMessage(s.id, { type: "tool_progress", data: {} } as any);
    svc.recordMessage(s.id, { type: "result", subtype: "success" } as any);
    // 只剩 user_prompt + result 两条，流式 delta / 进度被过滤
    const c = db.prepare("select count(*) c from messages where session_id=?").get(s.id) as any;
    expect(c.c).toBe(2);
  });

  it("listRecentCwds 去重并按最近更新排序，忽略空 cwd", () => {
    svc.createSession({ title: "无cwd" });
    svc.createSession({ title: "有cwd-1", cwd: "/proj/a" });
    svc.createSession({ title: "有cwd-2", cwd: "/proj/b" });
    const cwds = svc.listRecentCwds();
    expect(cwds).toContain("/proj/a");
    expect(cwds).toContain("/proj/b");
    expect(cwds).not.toContain(undefined as any);
  });

  it("listRecentCwds 按 autoCwd 意图过滤：自动建目录不列，用户显式选择的都列", () => {
    // 「不使用项目」时系统自动建的会话/任务目录：autoCwd=true → 不进列表
    svc.createSession({ title: "自动会话", cwd: "/ws/sessions/2026-07-07_hi_a35625", autoCwd: true });
    svc.createSession({ title: "定时任务", cwd: "/ws/cron/task_df0998", autoCwd: true });
    // 用户显式选择的项目（默认 autoCwd=false）：应列出
    svc.createSession({ title: "用户项目", cwd: "/home/me/Documents/proj" });
    // 关键：用户「使用现有」显式选中的目录，哪怕路径长得像自动目录，也应列出
    // —— 判定看创建意图（autoCwd），不看路径。
    svc.createSession({ title: "显式选了自动目录", cwd: "/ws/sessions/manually_picked" });
    const cwds = svc.listRecentCwds();
    expect(cwds).toContain("/home/me/Documents/proj");
    expect(cwds).toContain("/ws/sessions/manually_picked");
    expect(cwds).not.toContain("/ws/sessions/2026-07-07_hi_a35625");
    expect(cwds).not.toContain("/ws/cron/task_df0998");
  });

  it("settings KV：set 写入、get 读取、set null 删除", () => {
    expect(svc.getSetting("k")).toBeNull();
    svc.setSetting("k", "v");
    expect(svc.getSetting("k")).toBe("v");
    svc.setSetting("k", null);
    expect(svc.getSetting("k")).toBeNull();
  });
});

describe("SessionService 用量统计", () => {
  let db: Database.Database;
  let svc: SessionService;

  beforeEach(() => {
    db = makeDb();
    svc = makeService(db);
  });

  it("computeAndSaveUsageSummary 按工具类型归类并持久化", () => {
    const s = svc.createSession({ title: "用量" });
    const assistant = (blocks: any[]) =>
      ({ type: "assistant", message: { content: blocks } } as any);
    svc.recordMessage(s.id, assistant([
      { type: "tool_use", name: "Skill", input: { skill: "pdf" } },
      { type: "tool_use", name: "mcp__cron__list", input: {} },
      { type: "tool_use", name: "Agent", input: { description: "explore" } },
      { type: "tool_use", name: "Bash", input: {} },
      { type: "tool_use", name: "Read", input: { file_path: "/x/memory/note.md" } },
    ]));
    const summary = svc.computeAndSaveUsageSummary(s.id);
    expect(summary.skills).toEqual([{ name: "pdf", count: 1 }]);
    expect(summary.mcpTools).toEqual([{ name: "mcp__cron__list", count: 1 }]);
    expect(summary.agents).toEqual([{ name: "explore", count: 1 }]);
    expect(summary.memories).toEqual([{ name: "note.md", count: 1 }]);
    expect(summary.otherTools).toEqual({ Bash: 1 });
    // 持久化后可读回
    expect(svc.getUsageSummary(s.id)).toEqual(summary);
  });

  it("getUsageSummary 未计算时返回 null", () => {
    const s = svc.createSession({ title: "无用量" });
    expect(svc.getUsageSummary(s.id)).toBeNull();
  });

  it("saveChangedFiles / getPersistedChangedFiles 往返", () => {
    const s = svc.createSession({ title: "变更文件" });
    svc.computeAndSaveUsageSummary(s.id); // 先建 session_usage 行
    const files = [{ path: "a.ts", status: "modified" as const }];
    svc.saveChangedFiles(s.id, files);
    expect(svc.getPersistedChangedFiles(s.id)).toEqual(files);
  });
});

describe("SessionService 启动对账", () => {
  it("构造时把遗留的 running 会话重置为 error", () => {
    const db = makeDb();
    // 先用一个 service 建会话并置为 running，模拟「上次运行残留」
    const first = new SessionService(db);
    const s = first.createSession({ title: "僵尸会话" });
    first.updateSession(s.id, { status: "running" });
    expect((db.prepare("select status from sessions where id=?").get(s.id) as any).status).toBe("running");

    // 新建 service（模拟重启）触发 reconcileStaleSessions
    const restarted = new SessionService(db);
    const reloaded = restarted.getSession(s.id);
    expect(reloaded?.status).toBe("error");
    expect((db.prepare("select status from sessions where id=?").get(s.id) as any).status).toBe("error");
  });

  it("有成功 result 消息的 running 会话恢复为 completed", () => {
    const db = makeDb();
    const first = new SessionService(db);
    const s = first.createSession({ title: "已完成但状态残留" });
    first.recordMessage(s.id, { type: "user_prompt", prompt: "go" } as any);
    first.recordMessage(s.id, { type: "result", subtype: "success", is_error: false } as any);
    first.updateSession(s.id, { status: "running" });

    const restarted = new SessionService(db);
    expect(restarted.getSession(s.id)?.status).toBe("completed");
  });
});


