# Git Worktree Sandbox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 git 仓库下用 `git worktree` 替代文件系统复制沙箱，解决 .gitignore 不生效、编码问题、大仓库性能差等问题。

**Architecture:** 在 `SandboxService.createSandbox()` 中检测 git 仓库，若是则调用 `git worktree add` 创建隔离分支工作目录；`computeDiff` 改为 `git diff HEAD` + `git ls-files --others` 获取精确差异；`discardSandbox` 改为 `git worktree remove`。非 git 目录保留现有文件系统复制方案。

**Tech Stack:** Node.js child_process (execFileAsync), git CLI (worktree/diff), 现有 diff npm 包用于 hunk 解析

---

## 文件变更清单

### 修改文件
- `packages/shared/src/types.ts` — SandboxContext 加 isWorktree/worktreeRoot/worktreeBranch 字段
- `packages/server/src/modules/git/git.service.ts` — 新增 getRepoRoot / createWorktree / removeWorktree / diffWorktree 方法
- `packages/server/src/modules/sandbox/sandbox.service.ts` — createSandbox/computeDiff/discardSandbox 分支处理 worktree

---

## Task 1: 扩展 SandboxContext 类型

**Files:**
- Modify: `packages/shared/src/types.ts`

- [ ] **Step 1: 在 SandboxContext 类型中加入 worktree 字段**

找到（约 L307）：
```typescript
export type SandboxContext = {
  sessionId: string;
  sandboxDir: string;
  originalCwd: string;
  createdAt: number;
  status: SandboxStatus;
};
```

替换为：
```typescript
export type SandboxContext = {
  sessionId: string;
  sandboxDir: string;
  originalCwd: string;
  createdAt: number;
  status: SandboxStatus;
  isWorktree?: boolean;
  worktreeRoot?: string;
  worktreeBranch?: string;
};
```

- [ ] **Step 2: 提交**

```bash
cd D:\lenovo-code\localclaw
git add packages/shared/src/types.ts
git commit -m "feat: add worktree fields to SandboxContext type"
```

---

## Task 2: GitService 新增 worktree 方法

**Files:**
- Modify: `packages/server/src/modules/git/git.service.ts`

- [ ] **Step 1: 新增 getRepoRoot 方法**

在 `getCurrentBranch` 方法之后插入：

```typescript
async getRepoRoot(cwd: string): Promise<string> {
  const { stdout } = await execFileAsync("git", ["rev-parse", "--show-toplevel"], { cwd });
  return stdout.trim().replace(/\//g, require("path").sep);
}
```

- [ ] **Step 2: 新增 createWorktree 方法**

紧接 `getRepoRoot` 之后插入：

```typescript
async createWorktree(repoRoot: string, sessionId: string): Promise<{ worktreeDir: string; branchName: string }> {
  const { join: pathJoin } = await import("path");
  const { tmpdir } = await import("os");
  const worktreeDir = pathJoin(tmpdir(), "localclaw-worktree", sessionId);
  const branchName = `ai-task-${sessionId.slice(0, 8)}`;
  await execFileAsync("git", ["worktree", "add", worktreeDir, "-b", branchName, "HEAD"], { cwd: repoRoot });
  return { worktreeDir, branchName };
}
```

- [ ] **Step 3: 新增 removeWorktree 方法**

紧接 `createWorktree` 之后插入：

```typescript
async removeWorktree(repoRoot: string, worktreeDir: string, branchName: string): Promise<void> {
  try { await execFileAsync("git", ["worktree", "remove", "--force", worktreeDir], { cwd: repoRoot }); } catch { /* skip */ }
  try { await execFileAsync("git", ["branch", "-D", branchName], { cwd: repoRoot }); } catch { /* skip */ }
}
```

- [ ] **Step 4: 新增 diffWorktree 方法**

紧接 `removeWorktree` 之后插入（完整实现）：

```typescript
async diffWorktree(worktreeRoot: string): Promise<FileDiff[]> {
  const { join: pjoin } = await import("path");
  const results: FileDiff[] = [];

  // 1. tracked changes vs HEAD (modified / added-to-index / deleted)
  try {
    const { stdout } = await execFileAsync("git", ["diff", "HEAD", "--name-status"], { cwd: worktreeRoot });
    for (const line of stdout.trim().split("\n").filter(Boolean)) {
      const tabIdx = line.indexOf("\t");
      if (tabIdx === -1) continue;
      const statusCode = line.slice(0, tabIdx).trim();
      const relPath = line.slice(tabIdx + 1).trim();

      if (statusCode.startsWith("D")) {
        results.push({ path: relPath, status: "deleted", hunks: [], linesAdded: 0, linesRemoved: 0 });
        continue;
      }
      const isNew = statusCode.startsWith("A");
      const fullPath = pjoin(worktreeRoot, ...relPath.split("/"));
      if (!existsSync(fullPath)) continue;
      if (isBinary(fullPath)) {
        results.push({ path: relPath, status: isNew ? "added" : "modified", hunks: [], linesAdded: 0, linesRemoved: 0 });
        continue;
      }
      let oldContent = "";
      if (!isNew) {
        try {
          const gitPath = relPath.replace(/\\/g, "/");
          const { stdout: old } = await execFileAsync("git", ["show", `HEAD:${gitPath}`], { cwd: worktreeRoot });
          oldContent = old;
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
  } catch { /* git diff HEAD failed, return empty */ }

  // 2. untracked files (never git-added)
  try {
    const { stdout } = await execFileAsync("git", ["ls-files", "--others", "--exclude-standard"], { cwd: worktreeRoot });
    for (const relPath of stdout.trim().split("\n").filter(Boolean)) {
      const fullPath = pjoin(worktreeRoot, ...relPath.split("/"));
      if (!existsSync(fullPath)) continue;
      if (isBinary(fullPath)) {
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
```

注意：`diffWorktree` 使用的是文件顶部已有的 `isBinary`、`readTextFile`、`convertHunks`，无需重复定义。

- [ ] **Step 5: 提交**

```bash
cd D:\lenovo-code\localclaw
git add packages/server/src/modules/git/git.service.ts
git commit -m "feat: add git worktree methods to GitService (getRepoRoot/createWorktree/removeWorktree/diffWorktree)"
```

---

## Task 3: SandboxService 使用 git worktree

**Files:**
- Modify: `packages/server/src/modules/sandbox/sandbox.service.ts`

- [ ] **Step 1: 替换 createSandbox 方法**

读取 `packages/server/src/modules/sandbox/sandbox.service.ts`，将 `createSandbox` 方法（L36-L86）整体替换为：

```typescript
async createSandbox(sessionId: string, cwd: string): Promise<SandboxContext> {
  const isGit = await this.gitService.isGitRepo(cwd);

  if (isGit) {
    try {
      const repoRoot = await this.gitService.getRepoRoot(cwd);
      const { worktreeDir, branchName } = await this.gitService.createWorktree(repoRoot, sessionId);

      // Tell Claude it's in a git worktree — no commits, just edit files
      try {
        const { join: pj } = await import("path");
        const { mkdirSync: mds, existsSync: es, readFileSync: rfs, writeFileSync: wfs } = await import("fs");
        const claudeDir = pj(worktreeDir, ".localclaw");
        mds(claudeDir, { recursive: true });
        const claudeMdPath = pj(claudeDir, "CLAUDE.md");
        const existing = es(claudeMdPath) ? rfs(claudeMdPath, "utf-8") + "\n\n" : "";
        wfs(claudeMdPath,
          existing +
          `# Git Worktree Environment\n\n` +
          `This directory is an isolated git worktree for safe AI editing.\n` +
          `- You CAN use read-only git commands (git status, git diff, git log, git blame)\n` +
          `- Do NOT run git add, git commit, git push, git checkout, or git reset\n` +
          `- Just edit files normally — changes are tracked automatically\n`
        );
      } catch { /* non-fatal */ }

      const context: SandboxContext = {
        sessionId,
        sandboxDir: worktreeDir,
        originalCwd: cwd,
        createdAt: Date.now(),
        status: "active",
        isWorktree: true,
        worktreeRoot: worktreeDir,
        worktreeBranch: branchName,
      };
      this.sandboxes.set(sessionId, context);
      return context;
    } catch {
      // Worktree creation failed — fall through to file-copy approach
    }
  }

  // Non-git or worktree failed: file-copy approach
  const sandboxDir = join(tmpdir(), "localclaw-sandbox", sessionId);
  if (!existsSync(sandboxDir)) mkdirSync(sandboxDir, { recursive: true });

  if (isGit) {
    const trackedFiles = await this.gitService.listTrackedFiles(cwd);
    const { copyFileSync: cp } = await import("fs");
    for (const relPath of trackedFiles) {
      const src = join(cwd, relPath);
      const dst = join(sandboxDir, relPath);
      if (!existsSync(src)) continue;
      const dstDir = dirname(dst);
      if (!existsSync(dstDir)) mkdirSync(dstDir, { recursive: true });
      try { cp(src, dst); } catch { /* skip */ }
    }
  } else {
    await copyDirExclude(cwd, sandboxDir);
  }

  try {
    const claudeDir = join(sandboxDir, ".localclaw");
    mkdirSync(claudeDir, { recursive: true });
    const claudeMdPath = join(claudeDir, "CLAUDE.md");
    const existing = existsSync(claudeMdPath) ? readFileSync(claudeMdPath, "utf-8") + "\n\n" : "";
    writeFileSync(claudeMdPath,
      existing +
      `# Sandbox Environment\n\n` +
      `This directory is a sandbox copy for safe AI editing.\n` +
      `The original project (with the git repository) is at: \`${cwd}\`\n\n` +
      `**IMPORTANT:** This is a sandbox — do NOT run git add, git commit, or git push. ` +
      `Git write operations are handled automatically after you finish editing.\n\n` +
      `For read-only git operations (git status, git log, git diff, git blame, etc.), ` +
      `run them inside the original directory:\n` +
      `\`\`\`\ncd "${cwd}" && git <command>\n\`\`\`\n` +
      `Do NOT run git commands in the current sandbox directory — it has no .git folder.\n`
    );
  } catch { /* non-fatal */ }

  const context: SandboxContext = {
    sessionId,
    sandboxDir,
    originalCwd: cwd,
    createdAt: Date.now(),
    status: "active",
  };
  this.sandboxes.set(sessionId, context);
  return context;
}
```

- [ ] **Step 2: 替换 computeDiff 方法**

找到（约 L92-L96）：
```typescript
async computeDiff(sessionId: string): Promise<FileDiff[]> {
  const ctx = this.sandboxes.get(sessionId);
  if (!ctx) return [];
  return this.gitService.diffDirectories(ctx.originalCwd, ctx.sandboxDir);
}
```

替换为：
```typescript
async computeDiff(sessionId: string): Promise<FileDiff[]> {
  const ctx = this.sandboxes.get(sessionId);
  if (!ctx) return [];
  if (ctx.isWorktree && ctx.worktreeRoot) {
    return this.gitService.diffWorktree(ctx.worktreeRoot);
  }
  return this.gitService.diffDirectories(ctx.originalCwd, ctx.sandboxDir);
}
```

- [ ] **Step 3: 替换 discardSandbox 方法**

找到（约 L108-L113）：
```typescript
async discardSandbox(sessionId: string): Promise<void> {
  const ctx = this.sandboxes.get(sessionId);
  if (!ctx) return;
  try { rmSync(ctx.sandboxDir, { recursive: true, force: true }); } catch { /* skip */ }
  this.sandboxes.delete(sessionId);
}
```

替换为：
```typescript
async discardSandbox(sessionId: string): Promise<void> {
  const ctx = this.sandboxes.get(sessionId);
  if (!ctx) return;
  if (ctx.isWorktree && ctx.worktreeRoot && ctx.worktreeBranch) {
    await this.gitService.removeWorktree(ctx.originalCwd, ctx.worktreeRoot, ctx.worktreeBranch);
  } else {
    try { rmSync(ctx.sandboxDir, { recursive: true, force: true }); } catch { /* skip */ }
  }
  this.sandboxes.delete(sessionId);
}
```

- [ ] **Step 4: 提交**

```bash
cd D:\lenovo-code\localclaw
git add packages/server/src/modules/sandbox/sandbox.service.ts
git commit -m "feat: use git worktree for sandbox isolation in git repos"
```

---

## 自检

- [x] git 仓库走 worktree 路径，非 git 保留文件复制路径
- [x] worktree 创建失败时 fallback 到文件复制（try-catch）
- [x] `diffWorktree` 覆盖三类场景：tracked modified/added/deleted + untracked new files
- [x] `diffWorktree` 使用 `git show HEAD:path` 获取旧内容，路径统一转换为 forward slash
- [x] `discardSandbox` 同时删除 worktree 目录和临时分支（`-D` force delete）
- [x] SandboxContext 新字段全部为 optional，不影响现有非 git 场景
- [x] CLAUDE.md 为 worktree 环境注入更准确的指令（可以用 git status/diff，禁止 commit/push）
- [x] `convertHunks` / `isBinary` / `readTextFile` 已在文件顶层，`diffWorktree` 可直接使用
