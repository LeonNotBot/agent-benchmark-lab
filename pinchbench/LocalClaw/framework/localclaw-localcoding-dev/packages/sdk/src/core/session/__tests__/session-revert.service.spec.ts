import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync, utimesSync } from "fs";
import { execFileSync } from "child_process";
import { tmpdir } from "os";
import { join } from "path";
import { SessionService } from "../session.service";
import { SessionRevertService } from "../session-revert.service";
import { ToolDiffService } from "../tool-diff.service";

// 构造 assistant 工具调用 / tool_result 消息（与 tool-diff 单测一致），用于喂 buildRoundDiffs。
function asstToolUse(name: string, input: any, id = "tu1") {
  return { type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", name, input, id }] } };
}
function toolResult(id: string, text: string) {
  return { type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content: text }] } };
}
import { runSdkMigrations } from "../../../database/database.migrations";
import { configurePaths, __resetPathsForTest } from "../../../config/paths";

/**
 * SessionRevertService 单测：真实临时目录 + 真实 git 仓库。
 * 快照落服务端目录（configurePaths(agentHomeDir) 指到临时目录隔离），验证：
 * 撤销恢复到 HEAD + 快照落文件、重新应用从快照读回、非 git / no-head 拒绝、越界防护、
 * CRLF 编码保真。
 */
let dir: string;      // 工作区（git 仓库）
let homeDir: string;  // agentHome（快照落这里）
let db: Database.Database;
let sessions: SessionService;
let svc: SessionRevertService;
const RK = "round-test"; // 测试用 roundKey

function git(cwd: string, ...args: string[]): void {
  execFileSync("git", args, { cwd, stdio: "pipe" });
}

// 初始化 git 仓库并提交一个基线文件（committed.txt = "base\n"）。
function initRepo(cwd: string): void {
  git(cwd, "init");
  git(cwd, "config", "user.email", "t@t.com");
  git(cwd, "config", "user.name", "t");
  writeFileSync(join(cwd, "committed.txt"), "base\n", "utf8");
  git(cwd, "add", ".");
  git(cwd, "commit", "-m", "init");
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "revert-test-"));
  homeDir = mkdtempSync(join(tmpdir(), "revert-home-"));
  configurePaths({ agentHomeDir: homeDir }); // 快照写到隔离的临时 home
  db = new Database(":memory:");
  runSdkMigrations(db);
  sessions = new SessionService(db);
  svc = new SessionRevertService(sessions);
});
afterEach(() => {
  __resetPathsForTest();
  rmSync(dir, { recursive: true, force: true });
  rmSync(homeDir, { recursive: true, force: true });
});

describe("SessionRevertService", () => {
  it("非 git 仓库 → revertRound 返回 not-git", async () => {
    const s = sessions.createSession({ title: "非git", cwd: dir });
    const res = await svc.revertRound(s.id, RK, ["committed.txt"]);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("not-git");
  });

  it("无 cwd 会话 → no-workspace", async () => {
    const s = sessions.createSession({ title: "无cwd" });
    const res = await svc.revertRound(s.id, RK, ["x.txt"]);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("no-workspace");
  });

  it("撤销已修改的已提交文件 → 恢复到 HEAD 内容，hasSnapshot=true", async () => {
    initRepo(dir);
    const s = sessions.createSession({ title: "改", cwd: dir });
    const file = join(dir, "committed.txt");
    writeFileSync(file, "base\nMODIFIED\n", "utf8"); // 本轮改动

    const res = await svc.revertRound(s.id, RK, ["committed.txt"]);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.hasSnapshot).toBe(true);
    // 磁盘恢复到 HEAD
    expect(readFileSync(file, "utf8").replace(/\r\n/g, "\n")).toBe("base\n");
  });

  it("撤销本轮新建文件（HEAD 无）→ 删除文件", async () => {
    initRepo(dir);
    const s = sessions.createSession({ title: "新建", cwd: dir });
    const file = join(dir, "created.txt");
    writeFileSync(file, "new content\n", "utf8");

    const res = await svc.revertRound(s.id, RK, ["created.txt"]);
    expect(res.ok).toBe(true);
    expect(existsSync(file)).toBe(false); // HEAD 无该文件 → 删除
  });

  it("重新应用 → 从服务端快照读回磁盘（含删除新建文件）", async () => {
    initRepo(dir);
    const s = sessions.createSession({ title: "redo", cwd: dir });
    const file = join(dir, "committed.txt");
    const created = join(dir, "created.txt");
    writeFileSync(file, "base\nMODIFIED\n", "utf8");
    writeFileSync(created, "new\n", "utf8");

    const rev = await svc.revertRound(s.id, RK, ["committed.txt", "created.txt"]);
    expect(rev.ok).toBe(true);
    expect(readFileSync(file, "utf8").replace(/\r\n/g, "\n")).toBe("base\n"); // 恢复 HEAD
    expect(existsSync(created)).toBe(false); // 新建文件被删

    const re = await svc.reapplyRound(s.id, RK);
    expect(re.ok).toBe(true);
    // 重新应用后回到撤销前：修改文件恢复改动，新建文件重现
    expect(readFileSync(file, "utf8").replace(/\r\n/g, "\n")).toBe("base\nMODIFIED\n");
    expect(readFileSync(created, "utf8").replace(/\r\n/g, "\n")).toBe("new\n");
  });

  it("重新应用后快照被清理，二次重新应用返回 no-snapshot", async () => {
    initRepo(dir);
    const s = sessions.createSession({ title: "清理", cwd: dir });
    writeFileSync(join(dir, "committed.txt"), "base\nX\n", "utf8");
    await svc.revertRound(s.id, RK, ["committed.txt"]);
    expect((await svc.reapplyRound(s.id, RK)).ok).toBe(true);
    const again = await svc.reapplyRound(s.id, RK);
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.reason).toBe("no-snapshot");
  });

  it("路径越界（../）被拒绝：不写仓库外文件", async () => {
    initRepo(dir);
    const s = sessions.createSession({ title: "越界", cwd: dir });
    const res = await svc.revertRound(s.id, RK, ["../escape.txt"]);
    expect(res.ok).toBe(true); // 不抛错，只是跳过越界项
    if (res.ok) expect(res.hasSnapshot).toBe(false); // 越界项被跳过，无快照
    expect(existsSync(join(dir, "..", "escape.txt"))).toBe(false);
  });

  it("isGitRepo：git 目录 true，非 git false", async () => {
    expect(await svc.isGitRepo(dir)).toBe(false);
    initRepo(dir);
    expect(await svc.isGitRepo(dir)).toBe(true);
  });

  it("无 commit 的 git 仓库 → no-head，且不删除任何文件（数据安全）", async () => {
    git(dir, "init");
    git(dir, "config", "user.email", "t@t.com");
    git(dir, "config", "user.name", "t");
    const file = join(dir, "pre.txt");
    writeFileSync(file, "precious\n", "utf8");

    const s = sessions.createSession({ title: "无commit", cwd: dir });
    const res = await svc.revertRound(s.id, RK, ["pre.txt"]);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("no-head");
    expect(existsSync(file)).toBe(true); // 文件仍在，内容未动
    expect(readFileSync(file, "utf8")).toBe("precious\n");
  });

  it("无 commit + 注入 ToolDiffService → 用 round-diff oldContent 作基线撤销成功", async () => {
    git(dir, "init");
    git(dir, "config", "user.email", "t@t.com");
    git(dir, "config", "user.name", "t");
    // 已存在文件（撤销前内容），本轮通过 Edit 改成新内容并落盘。
    const file = join(dir, "app.ts");
    writeFileSync(file, "const v = 2\n", "utf8"); // Edit 之后的磁盘内容（新内容）

    const s = sessions.createSession({ title: "无commit可撤销", cwd: dir });
    // 一轮：user_prompt 起点 + assistant Edit（把 v=1 → v=2）。round-diff 会重建 oldContent="const v = 1\n"。
    sessions.recordMessage(s.id, { type: "user_prompt", prompt: "改一下", uuid: "u1" } as any);
    sessions.recordMessage(s.id, asstToolUse("Edit", { file_path: file, old_string: "const v = 1", new_string: "const v = 2" }, "e1") as any);

    // 取本轮 roundKey（首条 assistant uuid；此处无 uuid 回退占位，直接用服务算出的 key）。
    const toolDiff = new ToolDiffService(sessions);
    const rounds = toolDiff.buildRoundDiffs(s.id);
    expect(rounds).toHaveLength(1);
    const roundKey = rounds[0].roundKey;

    // 注入 ToolDiffService 的撤销服务：无 HEAD 也应成功，把文件还原为撤销前内容。
    const revert = new SessionRevertService(sessions, toolDiff);
    const res = await revert.revertRound(s.id, roundKey, ["app.ts"]);
    expect(res.ok).toBe(true);
    expect(readFileSync(file, "utf8")).toBe("const v = 1\n"); // 还原到撤销前
  });

  it("onModuleInit 清理过期快照目录，保留新鲜的", async () => {
    const root = join(homeDir, "revert-snapshots");
    // 造两个会话快照目录：old（mtime 设为 8 天前）、fresh（现在）
    const oldDir = join(root, "sess-old");
    const freshDir = join(root, "sess-fresh");
    mkdirSync(oldDir, { recursive: true });
    mkdirSync(freshDir, { recursive: true });
    writeFileSync(join(oldDir, "manifest.json"), "[]", "utf8");
    writeFileSync(join(freshDir, "manifest.json"), "[]", "utf8");
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    utimesSync(oldDir, eightDaysAgo, eightDaysAgo);

    svc.onModuleInit();
    expect(existsSync(oldDir)).toBe(false); // 过期 → 删
    expect(existsSync(freshDir)).toBe(true); // 新鲜 → 留
  });

  it("撤销/重新应用保留 CRLF 行尾（不改写编码）", async () => {
    initRepo(dir);
    git(dir, "config", "core.autocrlf", "false");
    const file = join(dir, "crlf.txt");
    writeFileSync(file, "a\r\nb\r\n", "utf8");
    git(dir, "add", "crlf.txt");
    git(dir, "commit", "-m", "crlf");
    writeFileSync(file, "a\r\nb\r\nMODIFIED\r\n", "utf8"); // 本轮改动

    const s = sessions.createSession({ title: "crlf", cwd: dir });
    const rev = await svc.revertRound(s.id, RK, ["crlf.txt"]);
    expect(rev.ok).toBe(true);
    expect(readFileSync(file, "utf8")).toBe("a\r\nb\r\n"); // 恢复 HEAD，CRLF 保留

    await svc.reapplyRound(s.id, RK);
    expect(readFileSync(file, "utf8")).toBe("a\r\nb\r\nMODIFIED\r\n"); // 重新应用也保留 CRLF
  });
});
