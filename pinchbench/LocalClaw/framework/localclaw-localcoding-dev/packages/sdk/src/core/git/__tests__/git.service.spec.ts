import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { GitService } from "../git.service";

/**
 * GitService 集成测试。
 *
 * 重 I/O service:用真实 git(临时仓库)+ 真实 fs 测确定性方法,比 mock execFile 更可信。
 * 依赖系统 git(CI 必备)。generateCommitMessage 走 LLM + 6s 超时,不在此列。
 */

let dir: string;
let svc: GitService;

/** 在 dir 里跑一条 git 命令(同步,测试准备用)。 */
function git(args: string[], cwd = dir): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}
function initRepo(): void {
  git(["init", "-b", "main"]);
  git(["config", "user.email", "t@t.io"]);
  git(["config", "user.name", "tester"]);
  git(["config", "commit.gpgsign", "false"]);
}
function write(rel: string, content: string, cwd = dir): void {
  const full = join(cwd, rel);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content);
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "git-test-"));
  svc = new GitService();
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("GitService — 仓库状态查询", () => {
  it("git 仓库:isGitRepo=true,branch=main", async () => {
    initRepo();
    expect(await svc.isGitRepo(dir)).toBe(true);
    expect(await svc.getCurrentBranch(dir)).toBe("main");
  });

  it("非 git 目录:各查询安全降级,不抛错", async () => {
    expect(await svc.getCurrentBranch(dir)).toBe("");
    expect(await svc.getCommitCount(dir)).toBe(0);
    expect(await svc.hasRemote(dir)).toBe(false);
    expect(await svc.hasUncommittedChanges(dir)).toBe(false);
  });

  it("getCommitCount:无 commit=0,提交后=N", async () => {
    initRepo();
    expect(await svc.getCommitCount(dir)).toBe(0);
    write("a.txt", "hi");
    git(["add", "-A"]);
    git(["commit", "-m", "first"]);
    expect(await svc.getCommitCount(dir)).toBe(1);
  });

  it("hasRemote:无远程=false,加 origin 后=true", async () => {
    initRepo();
    expect(await svc.hasRemote(dir)).toBe(false);
    git(["remote", "add", "origin", "https://example.com/x.git"]);
    expect(await svc.hasRemote(dir)).toBe(true);
  });

  it("aheadBehind:无 upstream 时 hasUpstream=false", async () => {
    initRepo();
    write("a.txt", "hi");
    git(["add", "-A"]);
    git(["commit", "-m", "first"]);
    expect(await svc.aheadBehind(dir)).toEqual({
      ahead: 0,
      behind: 0,
      hasUpstream: false,
    });
  });

  it("hasUncommittedChanges:干净=false,有改动=true", async () => {
    initRepo();
    write("a.txt", "hi");
    git(["add", "-A"]);
    git(["commit", "-m", "first"]);
    expect(await svc.hasUncommittedChanges(dir)).toBe(false);
    write("a.txt", "changed");
    expect(await svc.hasUncommittedChanges(dir)).toBe(true);
  });
});

describe("GitService — getWorkingDiff 变更分类", () => {
  it("untracked 新文件归类为 added,带行数统计", async () => {
    initRepo();
    write("new.txt", "line1\nline2\n");
    const diffs = await svc.getWorkingDiff(dir);
    const f = diffs.find((d) => d.path === "new.txt");
    expect(f?.status).toBe("added");
    expect(f?.linesAdded).toBe(2);
  });

  it("已提交文件被修改 → modified;删除 → deleted", async () => {
    initRepo();
    write("a.txt", "one\ntwo\n");
    write("b.txt", "keep\n");
    git(["add", "-A"]);
    git(["commit", "-m", "init"]);
    // 改 a,删 b
    write("a.txt", "one\ntwo\nthree\n");
    git(["rm", "b.txt"]);
    const diffs = await svc.getWorkingDiff(dir);
    expect(diffs.find((d) => d.path === "a.txt")?.status).toBe("modified");
    expect(diffs.find((d) => d.path === "a.txt")?.linesAdded).toBe(1);
    expect(diffs.find((d) => d.path === "b.txt")?.status).toBe("deleted");
  });
});

describe("GitService — commitChanges", () => {
  it("提交指定文件,返回 7 位 short hash", async () => {
    initRepo();
    write("a.txt", "hi");
    const hash = await svc.commitChanges(dir, "add a", ["a.txt"]);
    expect(hash).toMatch(/^[0-9a-f]{7,}$/);
    expect(await svc.getCommitCount(dir)).toBe(1);
  });
});

describe("GitService — 纯 fs:diffDirectories / applyFiles", () => {
  it("diffDirectories:对比两目录得出 added/modified/deleted", async () => {
    const orig = join(dir, "orig");
    const mod = join(dir, "mod");
    write("same.txt", "x\n", orig);
    write("same.txt", "x\n", mod);
    write("gone.txt", "bye\n", orig); // 仅 orig → deleted
    write("changed.txt", "old\n", orig);
    write("changed.txt", "new\n", mod); // 两边不同 → modified
    write("fresh.txt", "hi\n", mod); // 仅 mod → added
    const diffs = await svc.diffDirectories(orig, mod);
    const byPath = Object.fromEntries(diffs.map((d) => [d.path, d.status]));
    expect(byPath["gone.txt"]).toBe("deleted");
    expect(byPath["changed.txt"]).toBe("modified");
    expect(byPath["fresh.txt"]).toBe("added");
    expect(byPath["same.txt"]).toBeUndefined(); // 内容相同不进结果
  });

  it("applyFiles:把指定文件从源目录拷到目标(自动建子目录)", async () => {
    const src = join(dir, "src");
    const dst = join(dir, "dst");
    write("sub/x.txt", "content", src);
    await svc.applyFiles(src, dst, ["sub/x.txt"]);
    const { readFileSync } = await import("fs");
    expect(readFileSync(join(dst, "sub/x.txt"), "utf8")).toBe("content");
  });
});
