import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { SessionService } from "../session.service";
import { ToolDiffService } from "../tool-diff.service";
import { runSdkMigrations } from "../../../database/database.migrations";

/**
 * ToolDiffService.buildSessionDiff 单测：真实内存 DB + SessionService 喂消息流，
 * 在临时目录建真实文件作为「当前磁盘内容」，验证从工具调用重建 diff 的逻辑。
 */
let dir: string;
let db: Database.Database;
let sessions: SessionService;
let svc: ToolDiffService;

function asstToolUse(name: string, input: any, id = "tu1") {
  return { type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", name, input, id }] } };
}
function toolResult(id: string, text: string) {
  return { type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content: text }] } };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "diff-test-"));
  db = new Database(":memory:");
  runSdkMigrations(db);
  sessions = new SessionService(db);
  svc = new ToolDiffService(sessions);
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("ToolDiffService.buildSessionDiff", () => {
  it("无 cwd 的会话返回空", () => {
    const s = sessions.createSession({ title: "无cwd" });
    expect(svc.buildSessionDiff(s.id)).toEqual([]);
  });

  it("Write 新建文件 → status=added，原内容为空", () => {
    const s = sessions.createSession({ title: "新建", cwd: dir });
    const file = join(dir, "new.txt");
    writeFileSync(file, "line1\nline2\n", "utf8");
    sessions.recordMessage(s.id, asstToolUse("Write", { file_path: file, content: "line1\nline2\n" }) as any);
    sessions.recordMessage(s.id, toolResult("tu1", "File created successfully at: " + file) as any);

    const diffs = svc.buildSessionDiff(s.id);
    expect(diffs).toHaveLength(1);
    expect(diffs[0].status).toBe("added");
    expect(diffs[0].linesAdded).toBeGreaterThan(0);
  });

  it("Edit 修改已存在文件 → status=modified，能逆推原内容", () => {
    const s = sessions.createSession({ title: "改", cwd: dir });
    const file = join(dir, "edit.txt");
    // 磁盘当前内容（Edit 之后的状态）
    writeFileSync(file, "hello WORLD\n", "utf8");
    sessions.recordMessage(s.id, asstToolUse("Edit", { file_path: file, old_string: "world", new_string: "WORLD" }) as any);

    const diffs = svc.buildSessionDiff(s.id);
    expect(diffs).toHaveLength(1);
    expect(diffs[0].status).toBe("modified");
  });

  it("文件被删除（磁盘读不到）→ status=deleted", () => {
    const s = sessions.createSession({ title: "删", cwd: dir });
    const file = join(dir, "gone.txt");
    sessions.recordMessage(s.id, asstToolUse("Write", { file_path: file, content: "x" }) as any);
    // 不创建该文件，模拟已删除
    const diffs = svc.buildSessionDiff(s.id);
    expect(diffs).toHaveLength(1);
    expect(diffs[0].status).toBe("deleted");
  });

  it("无文件操作的会话返回空 diff", () => {
    const s = sessions.createSession({ title: "纯聊天", cwd: dir });
    sessions.recordMessage(s.id, { type: "user_prompt", prompt: "hi" } as any);
    expect(svc.buildSessionDiff(s.id)).toEqual([]);
  });

  it("同一文件用不同分隔符编辑两次 → 聚合成一条 diff（去重）", () => {
    const s = sessions.createSession({ title: "去重", cwd: dir });
    // 用子目录构造能体现分隔符差异的路径
    const sub = join(dir, "src");
    require("fs").mkdirSync(sub, { recursive: true });
    const file = join(sub, "config.ts");
    writeFileSync(file, "a=2\nb=2\n", "utf8"); // Edit 之后的磁盘内容

    // 第一次 Edit 用正斜杠路径，第二次用反斜杠路径（模拟模型两次 file_path 写法不一致）
    const fwd = file.replace(/\\/g, "/");
    const bwd = file.replace(/\//g, "\\");
    sessions.recordMessage(s.id, asstToolUse("Edit", { file_path: fwd, old_string: "a=1", new_string: "a=2" }, "e1") as any);
    sessions.recordMessage(s.id, asstToolUse("Edit", { file_path: bwd, old_string: "b=1", new_string: "b=2" }, "e2") as any);

    const diffs = svc.buildSessionDiff(s.id);
    // 关键：两次编辑同一文件，只应产出一条 diff（此前会因 file_path 写法不同拆成两条）
    expect(diffs).toHaveLength(1);
    expect(diffs[0].path).toBe("src/config.ts");
  });

  it("同一文件 Edit 两次（完全相同路径）→ collectOps 归一化聚合为一条 diff", () => {
    const s = sessions.createSession({ title: "路径聚合", cwd: dir });
    const file = join(dir, "app.ts");
    writeFileSync(file, "hello WORLD BIG\n", "utf8"); // Edit 后的最终磁盘状态
    // 两次 Edit 使用完全相同的绝对路径
    sessions.recordMessage(s.id, asstToolUse("Edit", { file_path: file, old_string: "world", new_string: "WORLD" }, "e1") as any);
    sessions.recordMessage(s.id, asstToolUse("Edit", { file_path: file, old_string: "big", new_string: "BIG" }, "e2") as any);

    const diffs = svc.buildSessionDiff(s.id);
    // collectOps 按 normPathKey 聚合，同一文件必只一条
    expect(diffs).toHaveLength(1);
    expect(diffs[0].path).toBe("app.ts");
  });
});
