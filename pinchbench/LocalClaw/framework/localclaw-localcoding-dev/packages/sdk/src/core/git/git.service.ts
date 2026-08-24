import { logger } from "../../util/logger";
import { Injectable } from "@nestjs/common";
import { execFile } from "child_process";
import { promisify } from "util";
import { join, relative, dirname } from "path";
import { existsSync, readdirSync, statSync, readFileSync, mkdirSync, copyFileSync } from "fs";
import * as diff from "diff";
import type { FileDiff, DiffHunk, DiffLine } from "@lenovo/agent-protocol";

const execFileAsync = promisify(execFile);
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next", "coverage", "__pycache__", ".turbo"]);

// diff 计算上限：工作区文件极多（如测试产物目录）时，逐文件读全文 + 算 structuredPatch 会拖到数秒。
// 超过数量上限的文件只记 status/文件名（不算逐行 hunks）；单文件超过体积阈值也跳过逐行 diff。
const MAX_DIFF_FILES = 300;
const MAX_DIFF_FILE_BYTES = 512 * 1024;

/** 文件是否过大，过大则跳过逐行 diff（只记文件名）。读不到大小时保守视为不过大。 */
function isTooLarge(filePath: string): boolean {
  try { return statSync(filePath).size > MAX_DIFF_FILE_BYTES; } catch { return false; }
}

/** 解码 git 输出的八进制转义路径，如 "hello\344\270\226\347\225\214.txt" → "hello世界.txt" */
function decodeGitPath(raw: string): string {
  if (raw.startsWith('"') && raw.endsWith('"')) {
    const inner = raw.slice(1, -1);
    const bytes: number[] = [];
    let i = 0;
    while (i < inner.length) {
      if (inner[i] === '\\' && i + 3 < inner.length && /^[0-7]{3}$/.test(inner.slice(i + 1, i + 4))) {
        bytes.push(parseInt(inner.slice(i + 1, i + 4), 8));
        i += 4;
      } else {
        bytes.push(inner.charCodeAt(i));
        i++;
      }
    }
    return Buffer.from(bytes).toString("utf8");
  }
  return raw;
}

function isBinary(filePath: string): boolean {
  try {
    const buf = Buffer.alloc(512);
    const fd = require("fs").openSync(filePath, "r");
    const bytesRead = require("fs").readSync(fd, buf, 0, 512, 0);
    require("fs").closeSync(fd);
    // UTF-16 LE/BE BOM → text file, not binary
    if (bytesRead >= 2 && ((buf[0] === 0xFF && buf[1] === 0xFE) || (buf[0] === 0xFE && buf[1] === 0xFF))) {
      return false;
    }
    for (let i = 0; i < bytesRead; i++) {
      if (buf[i] === 0) return true;
    }
    return false;
  } catch { return true; }
}

function readTextFile(filePath: string): string {
  const buf = readFileSync(filePath);
  let text: string;
  if (buf.length >= 2 && buf[0] === 0xFF && buf[1] === 0xFE) text = buf.toString("utf16le");
  else if (buf.length >= 2 && buf[0] === 0xFE && buf[1] === 0xFF) text = buf.swap16().toString("utf16le");
  else text = buf.toString("utf8");
  return text.replace(/\r\n/g, "\n");
}

function listFilesRecursive(dir: string, base: string, result: Set<string>): void {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    const rel = relative(base, full);
    if (entry.isDirectory()) listFilesRecursive(full, base, result);
    else if (entry.isFile()) result.add(rel);
  }
}

/**
 * GIT_SERVICE —— IGitService 的 NestJS 注入令牌（@public）。
 * 对外接入方用 `@Inject(GIT_SERVICE) svc: IGitService` 注入。
 */
export const GIT_SERVICE = Symbol("GIT_SERVICE");

/**
 * IGitService —— 对外稳定的 Git 能力接口（@public）。
 */
export interface IGitService {
  isGitRepo(cwd: string): Promise<boolean>;
  getCurrentBranch(cwd: string): Promise<string>;
  getWorkingDiff(cwd: string): Promise<FileDiff[]>;
  hasRemote(cwd: string): Promise<boolean>;
  aheadBehind(cwd: string): Promise<{ ahead: number; behind: number; hasUpstream: boolean }>;
  getCommitCount(cwd: string): Promise<number>;
  generateCommitMessage(cwd: string, diffs: FileDiff[]): Promise<string>;
  commitChanges(cwd: string, message: string, paths: string[]): Promise<string>;
  pushToRemote(cwd: string): Promise<void>;
  addRemoteAndPush(cwd: string, remoteUrl: string): Promise<void>;
}

@Injectable()
export class GitService implements IGitService {
  async isGitRepo(cwd: string): Promise<boolean> {
    try {
      await execFileAsync("git", ["rev-parse", "--is-inside-work-tree"], { cwd });
      return true;
    } catch { return false; }
  }

  async listTrackedFiles(cwd: string): Promise<string[]> {
    try {
      const { stdout } = await execFileAsync("git", ["ls-files"], { cwd });
      return stdout.trim().split("\n").filter(Boolean);
    } catch { return []; }
  }

  async getCurrentBranch(cwd: string): Promise<string> {
    try {
      const { stdout } = await execFileAsync("git", ["branch", "--show-current"], { cwd });
      return stdout.trim();
    } catch { return ""; }
  }

  async getRepoRoot(cwd: string): Promise<string> {
    const { stdout } = await execFileAsync("git", ["rev-parse", "--show-toplevel"], { cwd });
    return stdout.trim().replace(/\//g, require("path").sep);
  }

  async diffWorktree(worktreeRoot: string): Promise<FileDiff[]> {
    const { join: pjoin } = await import("path");
    const results: FileDiff[] = [];

    // 短路非 git 目录：避免对非仓库盲目 spawn 一串 git 子进程（Windows 上每次 spawn ~100-300ms）。
    // 守卫下沉到此处，所有调用方（history diff / workspace git-diff）共享，无需各自判断。
    if (!(await this.isGitRepo(worktreeRoot))) return results;

    // 检测是否有 HEAD（即是否有任何 commit）
    let hasHead = true;
    try {
      await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: worktreeRoot });
    } catch { hasHead = false; }

    if (hasHead) {
      // 有 commit：diff HEAD（含 staged + unstaged 相对于最新 commit 的变更）
      try {
        const { stdout } = await execFileAsync("git", ["diff", "HEAD", "--name-status"], { cwd: worktreeRoot });
        for (const line of stdout.trim().split("\n").filter(Boolean)) {
          const tabIdx = line.indexOf("\t");
          if (tabIdx === -1) continue;
          const statusCode = line.slice(0, tabIdx).trim();
          const relPath = decodeGitPath(line.slice(tabIdx + 1).trim());

          if (statusCode.startsWith("D")) {
            results.push({ path: relPath, status: "deleted", hunks: [], linesAdded: 0, linesRemoved: 0 });
            continue;
          }
          const isNew = statusCode.startsWith("A");
          const fullPath = pjoin(worktreeRoot, ...relPath.split("/"));
          if (!existsSync(fullPath)) continue;
          if (isBinary(fullPath) || results.length >= MAX_DIFF_FILES || isTooLarge(fullPath)) {
            results.push({ path: relPath, status: isNew ? "added" : "modified", hunks: [], linesAdded: 0, linesRemoved: 0 });
            continue;
          }
          let oldContent = "";
          if (!isNew) {
            try {
              const gitPath = relPath.replace(/\\/g, "/");
              const r = await execFileAsync("git", ["show", `HEAD:${gitPath}`], { cwd: worktreeRoot, encoding: "buffer" } as any);
              const buf: Buffer = (r as any).stdout;
              if (buf.length >= 2 && buf[0] === 0xFF && buf[1] === 0xFE) oldContent = buf.toString("utf16le");
              else if (buf.length >= 2 && buf[0] === 0xFE && buf[1] === 0xFF) oldContent = buf.swap16().toString("utf16le");
              else oldContent = buf.toString("utf8");
              oldContent = oldContent.replace(/\r\n/g, "\n");
            } catch { /* new file or encoding issue */ }
          }
          const newContent = readTextFile(fullPath);
          if (oldContent === newContent) continue;
          const patch = diff.structuredPatch(relPath, relPath, oldContent, newContent, "", "");
          const hunks = convertHunks(patch.hunks);
          const linesAdded = hunks.reduce((s, h) => s + h.lines.filter(l => l.type === "add").length, 0);
          const linesRemoved = hunks.reduce((s, h) => s + h.lines.filter(l => l.type === "remove").length, 0);
          results.push({ path: relPath, status: isNew ? "added" : "modified", oldContent, newContent, hunks, linesAdded, linesRemoved });
        }
      } catch { /* git diff HEAD failed */ }
    } else {
      // 无 commit：用 git diff --cached 列出所有 staged 文件（全部视为新增）
      try {
        const { stdout } = await execFileAsync("git", ["diff", "--cached", "--name-only"], { cwd: worktreeRoot });
        for (const rawPath of stdout.trim().split("\n").filter(Boolean)) {
          const relPath = decodeGitPath(rawPath.trim());
          const fullPath = pjoin(worktreeRoot, ...relPath.split("/"));
          if (!existsSync(fullPath)) continue;
          if (isBinary(fullPath) || results.length >= MAX_DIFF_FILES || isTooLarge(fullPath)) {
            results.push({ path: relPath, status: "added", hunks: [], linesAdded: 0, linesRemoved: 0 });
            continue;
          }
          const newContent = readTextFile(fullPath);
          const patch = diff.structuredPatch(relPath, relPath, "", newContent, "", "");
          const hunks = convertHunks(patch.hunks);
          const linesAdded = hunks.reduce((s, h) => s + h.lines.filter(l => l.type === "add").length, 0);
          results.push({ path: relPath, status: "added", newContent, hunks, linesAdded, linesRemoved: 0 });
        }
      } catch { /* git diff --cached failed */ }
    }

    // untracked 文件（有无 commit 都需要）
    try {
      const { stdout } = await execFileAsync("git", ["ls-files", "--others", "--exclude-standard"], { cwd: worktreeRoot });
      for (const rawPath of stdout.trim().split("\n").filter(Boolean)) {
        const relPath = decodeGitPath(rawPath.trim());
        const fullPath = pjoin(worktreeRoot, ...relPath.split("/"));
        if (!existsSync(fullPath)) continue;
        // 超过文件数上限 / 单文件过大：只记 status+文件名，跳过读全文与逐行 diff（防几秒级耗时）
        if (isBinary(fullPath) || results.length >= MAX_DIFF_FILES || isTooLarge(fullPath)) {
          results.push({ path: relPath, status: "added", hunks: [], linesAdded: 0, linesRemoved: 0 });
          continue;
        }
        const newContent = readTextFile(fullPath);
        const patch = diff.structuredPatch(relPath, relPath, "", newContent, "", "");
        const hunks = convertHunks(patch.hunks);
        const linesAdded = hunks.reduce((s, h) => s + h.lines.filter(l => l.type === "add").length, 0);
        results.push({ path: relPath, status: "added", newContent, hunks, linesAdded, linesRemoved: 0 });
      }
    } catch { /* ls-files failed */ }

    return results;
  }

  /** 获取工作区相对于 HEAD 的完整 diff（含 unstaged、staged、untracked） */
  async getWorkingDiff(cwd: string): Promise<FileDiff[]> {
    return this.diffWorktree(cwd);
  }

  /** 检测是否有关联远程仓库 */
  async hasRemote(cwd: string): Promise<boolean> {
    try {
      const { stdout } = await execFileAsync("git", ["remote"], { cwd });
      return stdout.trim().length > 0;
    } catch { return false; }
  }

  /** 检测本地领先远程几个提交（fetch-less，仅基于本地已知的远程追踪分支） */
  async aheadBehind(cwd: string): Promise<{ ahead: number; behind: number; hasUpstream: boolean }> {
    try {
      const { stdout: upstream } = await execFileAsync(
        "git", ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], { cwd }
      );
      if (!upstream.trim()) return { ahead: 0, behind: 0, hasUpstream: false };
      const { stdout } = await execFileAsync(
        "git", ["rev-list", "--left-right", "--count", "HEAD...@{u}"], { cwd }
      );
      const parts = stdout.trim().split(/\s+/);
      return { ahead: parseInt(parts[0] ?? "0", 10), behind: parseInt(parts[1] ?? "0", 10), hasUpstream: true };
    } catch { return { ahead: 0, behind: 0, hasUpstream: false }; }
  }

  /** 获取本地 commit 总数（用于判断是否有待推送的提交） */
  async getCommitCount(cwd: string): Promise<number> {
    try {
      const { stdout } = await execFileAsync("git", ["rev-list", "--count", "HEAD"], { cwd });
      return parseInt(stdout.trim(), 10) || 0;
    } catch { return 0; }
  }

  async generateCommitMessage(cwd: string, diffs: import("@lenovo/agent-protocol").FileDiff[]): Promise<string> {
    const summary = diffs.map(d => `${d.status}: ${d.path} (+${d.linesAdded}/-${d.linesRemoved})`).join("\n");
    const { unstable_v2_prompt } = await import("@anthropic-ai/claude-agent-sdk");
    const { claudeCodeEnv } = await import("../../config/claude-settings");
    try {
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), 6000)
      );
      const result = await Promise.race([
        unstable_v2_prompt(
          `Generate a concise git commit message (one line, imperative mood, max 72 chars) for these changes:\n${summary}\nReturn ONLY the commit message, no quotes or explanation.`,
          { model: claudeCodeEnv.ANTHROPIC_MODEL }
        ),
        timeout,
      ]);
      return ((result as any).result as string).trim().replace(/^["']|["']$/g, "");
    } catch {
      const added = diffs.filter(d => d.status === "added").length;
      const modified = diffs.filter(d => d.status === "modified").length;
      const deleted = diffs.filter(d => d.status === "deleted").length;
      const parts = [];
      if (added) parts.push(`add ${added} file${added > 1 ? "s" : ""}`);
      if (modified) parts.push(`update ${modified} file${modified > 1 ? "s" : ""}`);
      if (deleted) parts.push(`delete ${deleted} file${deleted > 1 ? "s" : ""}`);
      return `feat: ${parts.join(", ")}`;
    }
  }

  async commitChanges(cwd: string, message: string, paths: string[]): Promise<string> {
    if (paths.length > 0) {
      await execFileAsync("git", ["add", "--", ...paths], { cwd });
    } else {
      await execFileAsync("git", ["add", "-A"], { cwd });
    }
    try {
      await execFileAsync("git", ["commit", "-m", message], { cwd });
    } catch (e: any) {
      logger.error("[git.commit] commit failed:", e.message, e.stderr);
      throw Object.assign(new Error(e.message ?? "commit failed"), { _stderr: e.stderr });
    }
    const { stdout: hashOut } = await execFileAsync("git", ["rev-parse", "--short", "HEAD"], { cwd });
    return hashOut.trim();
  }

  async pushToRemote(cwd: string): Promise<void> {
    const branch = await this.getCurrentBranch(cwd);
    await execFileAsync("git", ["push", "origin", branch], { cwd });
  }

  async addRemoteAndPush(cwd: string, remoteUrl: string): Promise<void> {
    await execFileAsync("git", ["remote", "add", "origin", remoteUrl], { cwd });
    const branch = await this.getCurrentBranch(cwd);
    await execFileAsync("git", ["push", "-u", "origin", branch], { cwd });
  }

  async hasUncommittedChanges(cwd: string): Promise<boolean> {
    try {
      const { stdout } = await execFileAsync("git", ["status", "--porcelain"], { cwd });
      return stdout.trim().length > 0;
    } catch { return false; }
  }

  async diffDirectories(originalDir: string, modifiedDir: string): Promise<FileDiff[]> {
    const origFiles = new Set<string>();
    const modFiles = new Set<string>();
    listFilesRecursive(originalDir, originalDir, origFiles);
    listFilesRecursive(modifiedDir, modifiedDir, modFiles);

    const allPaths = new Set([...origFiles, ...modFiles]);
    const results: FileDiff[] = [];

    for (const relPath of allPaths) {
      const origPath = join(originalDir, relPath);
      const modPath = join(modifiedDir, relPath);
      const inOrig = origFiles.has(relPath);
      const inMod = modFiles.has(relPath);

      if (inOrig && !inMod) {
        results.push({ path: relPath, status: "deleted", hunks: [], linesAdded: 0, linesRemoved: 0 });
        continue;
      }
      if (!inOrig && inMod) {
        if (isBinary(modPath)) {
          results.push({ path: relPath, status: "added", hunks: [], linesAdded: 0, linesRemoved: 0 });
          continue;
        }
        const newContent = readTextFile(modPath);
        const patch = diff.structuredPatch(relPath, relPath, "", newContent, "", "");
        const hunks = convertHunks(patch.hunks);
        const linesAdded = hunks.reduce((s, h) => s + h.lines.filter(l => l.type === "add").length, 0);
        results.push({ path: relPath, status: "added", newContent, hunks, linesAdded, linesRemoved: 0 });
        continue;
      }
      if (isBinary(origPath) || isBinary(modPath)) {
        results.push({ path: relPath, status: "modified", hunks: [], linesAdded: 0, linesRemoved: 0 });
        continue;
      }
      const oldContent = readTextFile(origPath);
      const newContent = readTextFile(modPath);
      if (oldContent === newContent) continue;
      const patch = diff.structuredPatch(relPath, relPath, oldContent, newContent, "", "");
      const hunks = convertHunks(patch.hunks);
      const linesAdded = hunks.reduce((s, h) => s + h.lines.filter(l => l.type === "add").length, 0);
      const linesRemoved = hunks.reduce((s, h) => s + h.lines.filter(l => l.type === "remove").length, 0);
      results.push({ path: relPath, status: "modified", oldContent, newContent, hunks, linesAdded, linesRemoved });
    }
    return results;
  }

  async applyFiles(sourceDir: string, targetDir: string, paths: string[]): Promise<void> {
    for (const relPath of paths) {
      const src = join(sourceDir, relPath);
      const dst = join(targetDir, relPath);
      if (!existsSync(src)) continue;
      const dstDir = dirname(dst);
      if (!existsSync(dstDir)) mkdirSync(dstDir, { recursive: true });
      copyFileSync(src, dst);
    }
  }
}

function convertHunks(rawHunks: Array<{ oldStart: number; oldLines: number; newStart: number; newLines: number; lines: string[] }>): DiffHunk[] {
  return rawHunks.map(h => {
    const lines: DiffLine[] = [];
    let oldLine = h.oldStart;
    let newLine = h.newStart;
    for (const line of h.lines) {
      if (line.startsWith("+")) {
        lines.push({ type: "add", content: line.slice(1), newLineNumber: newLine++ });
      } else if (line.startsWith("-")) {
        lines.push({ type: "remove", content: line.slice(1), oldLineNumber: oldLine++ });
      } else {
        lines.push({ type: "context", content: line.slice(1), oldLineNumber: oldLine++, newLineNumber: newLine++ });
      }
    }
    return { oldStart: h.oldStart, oldLines: h.oldLines, newStart: h.newStart, newLines: h.newLines, lines };
  });
}
