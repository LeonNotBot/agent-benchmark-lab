# Post-Apply Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 aicoding (subagent) 代码应用后，提供一键 Git 提交和本地运行部署的完整后处理流程。

**Architecture:** 应用变更后在 SubagentService 触发后处理阶段，新增 DeployService 负责进程管理和项目类型检测，扩展 GitService 支持提交/推送，通过 WebSocket 流式传输部署日志。前端在 TaskTreeCard 底部展示 PostApplyPanel 组件，引导用户完成 Git 提交和本地运行。

**Tech Stack:** NestJS (后端), React + TypeScript (前端), child_process (进程管理), WebSocket (流式日志), git CLI

---

## 文件变更清单

### 新建文件
- `packages/server/src/modules/deploy/deploy.service.ts` — 项目类型检测、进程启动/停止、日志流
- `packages/server/src/modules/deploy/deploy.module.ts` — NestJS 模块声明
- `packages/client/src/components/PostApplyPanel.tsx` — Git提交 + 本地运行 UI 组件

### 修改文件
- `packages/shared/src/types.ts` — 新增 PostApply 相关类型和事件
- `packages/server/src/modules/git/git.service.ts` — 新增 generateCommitMessage / commitChanges / pushToRemote
- `packages/server/src/modules/subagent/subagent.service.ts` — applyMerged 后触发 postApplyReady
- `packages/server/src/modules/websocket/websocket.gateway.ts` — 注入 DeployService，处理新事件
- `packages/server/src/app.module.ts` — 注册 DeployModule
- `packages/client/src/components/TaskTreeCard.tsx` — 引入并渲染 PostApplyPanel
- `packages/client/src/store/useAppStore.ts` — 处理新 ServerEvent 类型

---

## Task 1: 扩展共享类型

**Files:**
- Modify: `packages/shared/src/types.ts`

- [ ] **Step 1: 在 types.ts 末尾追加 PostApply 类型**

在 `SubagentTaskTree` 类型定义（约 L348）后追加：

```typescript
// ── Post-Apply Workflow ──

export type PostApplyGitStatus = "idle" | "committing" | "committed" | "pushing" | "pushed" | "error";
export type PostApplyDeployStatus = "idle" | "running" | "stopped" | "error";

export type DetectedCommand = {
  label: string;
  command: string;
};

export type PostApplyState = {
  managerSessionId: string;
  gitStatus: PostApplyGitStatus;
  suggestedCommitMsg: string;
  committedHash?: string;
  gitError?: string;
  deployStatus: PostApplyDeployStatus;
  detectedCommands: DetectedCommand[];
  deployLogs: string[];
  deployError?: string;
};
```

- [ ] **Step 2: 扩展 SubagentTaskTree 类型，加入 postApply 字段**

找到：
```typescript
export type SubagentTaskTree = {
  managerSessionId: string;
  originalPrompt: string;
  cwd?: string;
  tasks: SubagentTask[];
  status: SubagentTreeStatus;
  mergedDiffs?: FileDiff[];
  conflicts?: DiffConflict[];
};
```

替换为：
```typescript
export type SubagentTaskTree = {
  managerSessionId: string;
  originalPrompt: string;
  cwd?: string;
  tasks: SubagentTask[];
  status: SubagentTreeStatus;
  mergedDiffs?: FileDiff[];
  conflicts?: DiffConflict[];
  postApply?: PostApplyState;
};
```

- [ ] **Step 3: 提交**

```bash
git add packages/shared/src/types.ts
git commit -m "feat: add PostApply types for git commit and deploy workflow"
```

---

## Task 2: 扩展 GitService

**Files:**
- Modify: `packages/server/src/modules/git/git.service.ts`

- [ ] **Step 1: 新增 generateCommitMessage 方法**

在 `getCurrentBranch` 方法后追加（约 L57 之后）：

```typescript
async generateCommitMessage(cwd: string, diffs: import("@local-claw/shared/src/types").FileDiff[]): Promise<string> {
  const summary = diffs.map(d => `${d.status}: ${d.path} (+${d.linesAdded}/-${d.linesRemoved})`).join("\n");
  const { unstable_v2_prompt } = await import("@anthropic-ai/claude-agent-sdk");
  const { claudeCodeEnv } = await import("../../config/claude-settings");
  try {
    const result = await unstable_v2_prompt(
      `Generate a concise git commit message (one line, imperative mood, max 72 chars) for these changes:\n${summary}\nReturn ONLY the commit message, no quotes or explanation.`,
      { model: claudeCodeEnv.ANTHROPIC_MODEL }
    );
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
```

- [ ] **Step 2: 新增 commitChanges 方法**

紧接上一个方法后追加：

```typescript
async commitChanges(cwd: string, message: string, paths: string[]): Promise<string> {
  if (paths.length > 0) {
    await execFileAsync("git", ["add", "--", ...paths], { cwd });
  } else {
    await execFileAsync("git", ["add", "-A"], { cwd });
  }
  await execFileAsync("git", ["commit", "-m", message], { cwd });
  const { stdout } = await execFileAsync("git", ["rev-parse", "--short", "HEAD"], { cwd });
  return stdout.trim();
}
```

- [ ] **Step 3: 新增 pushToRemote 方法**

紧接上一个方法后追加：

```typescript
async pushToRemote(cwd: string): Promise<void> {
  const branch = await this.getCurrentBranch(cwd);
  await execFileAsync("git", ["push", "origin", branch], { cwd });
}

async hasUncommittedChanges(cwd: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync("git", ["status", "--porcelain"], { cwd });
    return stdout.trim().length > 0;
  } catch { return false; }
}
```

- [ ] **Step 4: 提交**

```bash
git add packages/server/src/modules/git/git.service.ts
git commit -m "feat: add git commit/push/generateCommitMessage to GitService"
```

---

## Task 3: 新建 DeployService

**Files:**
- Create: `packages/server/src/modules/deploy/deploy.service.ts`
- Create: `packages/server/src/modules/deploy/deploy.module.ts`

- [ ] **Step 1: 新建 deploy.service.ts 基础框架**

```typescript
import { Injectable } from "@nestjs/common";
import { spawn, ChildProcess } from "child_process";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import type { DetectedCommand, ServerEvent } from "@local-claw/shared/src/types";

@Injectable()
export class DeployService {
  private processes = new Map<string, ChildProcess>();
  private emitter: ((event: ServerEvent) => void) | null = null;

  setEmitter(emitter: (event: ServerEvent) => void): void {
    this.emitter = emitter;
  }

  private emit(event: ServerEvent): void {
    this.emitter?.(event);
  }
}
```

- [ ] **Step 2: 添加 detectCommands 方法**

在 `emit` 方法后追加：

```typescript
detectCommands(cwd: string): DetectedCommand[] {
  const commands: DetectedCommand[] = [];

  // package.json scripts
  const pkgPath = join(cwd, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
      const scripts = pkg.scripts ?? {};
      const preferred = ["dev", "start", "serve", "preview"];
      for (const name of preferred) {
        if (scripts[name]) {
          const pm = existsSync(join(cwd, "pnpm-lock.yaml")) ? "pnpm" :
                     existsSync(join(cwd, "yarn.lock")) ? "yarn" : "npm";
          commands.push({ label: `${pm} run ${name}`, command: `${pm} run ${name}` });
        }
      }
    } catch { /* skip */ }
  }

  // docker-compose
  if (existsSync(join(cwd, "docker-compose.yml")) || existsSync(join(cwd, "docker-compose.yaml"))) {
    commands.push({ label: "docker-compose up", command: "docker-compose up" });
  }

  // Makefile
  if (existsSync(join(cwd, "Makefile"))) {
    commands.push({ label: "make", command: "make" });
  }

  // Python
  if (existsSync(join(cwd, "main.py"))) {
    commands.push({ label: "python main.py", command: "python main.py" });
  } else if (existsSync(join(cwd, "app.py"))) {
    commands.push({ label: "python app.py", command: "python app.py" });
  }

  return commands;
}
```

- [ ] **Step 3: 添加 startProcess / stopProcess 方法**

在 `detectCommands` 方法后追加：

```typescript
startProcess(managerSessionId: string, cwd: string, command: string): void {
  this.stopProcess(managerSessionId);

  const [cmd, ...args] = command.split(" ");
  const proc = spawn(cmd, args, { cwd, shell: true });
  this.processes.set(managerSessionId, proc);

  this.emit({ type: "subagent.deploy.status", payload: { managerSessionId, status: "running" } } as any);

  const onData = (stream: "stdout" | "stderr") => (chunk: Buffer) => {
    this.emit({ type: "subagent.deploy.output", payload: { managerSessionId, data: chunk.toString(), stream } } as any);
  };

  proc.stdout?.on("data", onData("stdout"));
  proc.stderr?.on("data", onData("stderr"));

  proc.on("close", (exitCode) => {
    this.processes.delete(managerSessionId);
    const status = exitCode === 0 ? "stopped" : "error";
    this.emit({ type: "subagent.deploy.status", payload: { managerSessionId, status, exitCode: exitCode ?? -1 } } as any);
  });

  proc.on("error", (err) => {
    this.processes.delete(managerSessionId);
    this.emit({ type: "subagent.deploy.status", payload: { managerSessionId, status: "error", error: err.message } } as any);
  });
}

stopProcess(managerSessionId: string): void {
  const proc = this.processes.get(managerSessionId);
  if (proc) {
    proc.kill("SIGTERM");
    this.processes.delete(managerSessionId);
  }
}
```

- [ ] **Step 4: 新建 deploy.module.ts**

```typescript
import { Module } from "@nestjs/common";
import { DeployService } from "./deploy.service";

@Module({
  providers: [DeployService],
  exports: [DeployService],
})
export class DeployModule {}
```

- [ ] **Step 5: 提交**

```bash
git add packages/server/src/modules/deploy/
git commit -m "feat: add DeployService for project detection and process management"
```

---

## Task 4: SubagentService 触发后处理

**Files:**
- Modify: `packages/server/src/modules/subagent/subagent.service.ts`
- Modify: `packages/server/src/modules/subagent/subagent.module.ts`

- [ ] **Step 1: 注入 GitService 和 DeployService，修改 applyMerged**

将 `applyMerged` 方法（L97-L105）替换为：

```typescript
async applyMerged(managerSessionId: string, selectedPaths?: string[]): Promise<void> {
  const tree = this.trees.get(managerSessionId);
  if (!tree?.mergedDiffs || !tree.cwd) return;
  const diffs = selectedPaths
    ? tree.mergedDiffs.filter(d => selectedPaths.includes(d.path))
    : tree.mergedDiffs;
  await this.applyDiffsDirectly(diffs, tree.cwd);
  this.emit({ type: "sandbox.applied", payload: { sessionId: managerSessionId, appliedPaths: diffs.map(d => d.path) } } as any);

  // Trigger post-apply workflow
  await this.initPostApply(managerSessionId, diffs);
}
```

- [ ] **Step 2: 新增 initPostApply 方法**

在 `applyMerged` 后追加：

```typescript
private async initPostApply(
  managerSessionId: string,
  appliedDiffs: import("@local-claw/shared/src/types").FileDiff[]
): Promise<void> {
  const tree = this.trees.get(managerSessionId);
  if (!tree?.cwd) return;

  const isGit = await this.gitService.isGitRepo(tree.cwd);
  let suggestedCommitMsg = "";
  if (isGit) {
    suggestedCommitMsg = await this.gitService.generateCommitMessage(tree.cwd, appliedDiffs);
  }

  this.emit({
    type: "subagent.postapply.ready",
    payload: {
      managerSessionId,
      suggestedCommitMsg,
      isGitRepo: isGit,
    }
  } as any);
}
```

- [ ] **Step 3: 新增 gitCommit / gitPush 方法**

追加：

```typescript
async gitCommit(managerSessionId: string, message: string): Promise<void> {
  const tree = this.trees.get(managerSessionId);
  if (!tree?.cwd) return;
  try {
    const hash = await this.gitService.commitChanges(tree.cwd, message, []);
    this.emit({ type: "subagent.postapply.git.committed", payload: { managerSessionId, hash } } as any);
  } catch (e) {
    this.emit({ type: "subagent.postapply.git.error", payload: { managerSessionId, error: String(e) } } as any);
  }
}

async gitPush(managerSessionId: string): Promise<void> {
  const tree = this.trees.get(managerSessionId);
  if (!tree?.cwd) return;
  try {
    await this.gitService.pushToRemote(tree.cwd);
    this.emit({ type: "subagent.postapply.git.pushed", payload: { managerSessionId } } as any);
  } catch (e) {
    this.emit({ type: "subagent.postapply.git.error", payload: { managerSessionId, error: String(e) } } as any);
  }
}

getCwd(managerSessionId: string): string | undefined {
  return this.trees.get(managerSessionId)?.cwd;
}
```

- [ ] **Step 4: 提交**

```bash
git add packages/server/src/modules/subagent/
git commit -m "feat: trigger post-apply workflow after applying diffs in SubagentService"
```

---

## Task 5: 注册 DeployModule 并更新 WebSocket 网关

**Files:**
- Modify: `packages/server/src/app.module.ts`
- Modify: `packages/server/src/modules/websocket/websocket.gateway.ts`

- [ ] **Step 1: 在 app.module.ts 注册 DeployModule**

读取 app.module.ts，找到 imports 数组，加入 `DeployModule`，并在顶部加上对应 import 语句：

```typescript
import { DeployModule } from "./modules/deploy/deploy.module";
```

在 imports 数组中加入：
```typescript
DeployModule,
```

- [ ] **Step 2: 在 websocket.gateway.ts 注入 DeployService**

在构造函数中加入：
```typescript
@Inject(DeployService) private readonly deployService: DeployService,
```

在类顶部加上 import：
```typescript
import { DeployService } from "../deploy/deploy.service";
```

在构造函数体内（`this.subagentService.setEmitter` 之后）加上：
```typescript
this.deployService.setEmitter((event) => this.emit(event));
```

- [ ] **Step 3: 在 handleClientEvent 方法中添加新事件分发**

找到处理 `subagent.conflict.resolve` 的 case，在其后添加：

```typescript
case "subagent.postapply.git.commit":
  this.subagentService.gitCommit(
    (event as any).payload.managerSessionId,
    (event as any).payload.message
  ).catch(() => {});
  break;
case "subagent.postapply.git.push":
  this.subagentService.gitPush((event as any).payload.managerSessionId).catch(() => {});
  break;
case "subagent.postapply.deploy.start": {
  const { managerSessionId, command } = (event as any).payload;
  const cwd = this.subagentService.getCwd(managerSessionId);
  if (cwd) this.deployService.startProcess(managerSessionId, cwd, command);
  break;
}
case "subagent.postapply.deploy.stop":
  this.deployService.stopProcess((event as any).payload.managerSessionId);
  break;
```

- [ ] **Step 4: 提交**

```bash
git add packages/server/src/app.module.ts packages/server/src/modules/websocket/websocket.gateway.ts
git commit -m "feat: register DeployModule and wire post-apply events in WebSocket gateway"
```

---

## Task 6: 前端 PostApplyPanel 组件

**Files:**
- Create: `packages/client/src/components/PostApplyPanel.tsx`

- [ ] **Step 1: 新建 PostApplyPanel.tsx 基础框架**

```typescript
import { useState, useRef, useEffect } from "react";
import type { ClientEvent, PostApplyState, DetectedCommand } from "@local-claw/shared/src/types";

interface PostApplyPanelProps {
  state: PostApplyState;
  sendEvent: (event: ClientEvent) => void;
}

export function PostApplyPanel({ state, sendEvent }: PostApplyPanelProps) {
  const { managerSessionId, gitStatus, suggestedCommitMsg, committedHash,
          gitError, deployStatus, detectedCommands, deployLogs, deployError } = state;
  const [commitMsg, setCommitMsg] = useState(suggestedCommitMsg);
  const [customCmd, setCustomCmd] = useState("");
  const [selectedCmd, setSelectedCmd] = useState(detectedCommands[0]?.command ?? "");
  const logsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setCommitMsg(suggestedCommitMsg); }, [suggestedCommitMsg]);
  useEffect(() => { logsEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [deployLogs]);

  return (
    <div className="border-t border-border-200 px-4 py-3 space-y-3">
      <GitSection />
      <DeploySection />
    </div>
  );

  function GitSection() { return null; }
  function DeploySection() { return null; }
}
```

- [ ] **Step 2: 实现 GitSection**

将 `function GitSection() { return null; }` 替换为：

```typescript
function GitSection() {
  if (!suggestedCommitMsg && gitStatus === "idle") return null;
  const isGitRepo = suggestedCommitMsg !== "" || gitStatus !== "idle";
  if (!isGitRepo) return null;

  return (
    <div className="space-y-2">
      <div className="text-xs font-medium text-text-300">Git 提交</div>
      {(gitStatus === "idle" || gitStatus === "error") && (
        <div className="flex gap-2">
          <input
            value={commitMsg}
            onChange={e => setCommitMsg(e.target.value)}
            className="flex-1 text-xs border border-border-200 rounded px-2 py-1 bg-bg-50 text-text-200"
            placeholder="commit message..."
          />
          <button
            onClick={() => sendEvent({ type: "subagent.postapply.git.commit", payload: { managerSessionId, message: commitMsg } } as any)}
            disabled={!commitMsg.trim()}
            className="text-xs bg-accent-brand text-white px-3 py-1 rounded hover:opacity-90 disabled:opacity-40"
          >提交</button>
        </div>
      )}
      {gitStatus === "committing" && <div className="text-xs text-text-400 animate-pulse">提交中...</div>}
      {gitStatus === "committed" && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-green-600">已提交 {committedHash}</span>
          <button
            onClick={() => sendEvent({ type: "subagent.postapply.git.push", payload: { managerSessionId } } as any)}
            className="text-xs border border-border-200 px-2 py-0.5 rounded hover:bg-bg-100"
          >推送到远端</button>
        </div>
      )}
      {gitStatus === "pushing" && <div className="text-xs text-text-400 animate-pulse">推送中...</div>}
      {gitStatus === "pushed" && <div className="text-xs text-green-600">已推送到远端</div>}
      {gitStatus === "error" && <div className="text-xs text-red-500">{gitError}</div>}
    </div>
  );
}
```

- [ ] **Step 3: 实现 DeploySection**

将 `function DeploySection() { return null; }` 替换为：

```typescript
function DeploySection() {
  const effectiveCmd = customCmd || selectedCmd;
  return (
    <div className="space-y-2">
      <div className="text-xs font-medium text-text-300">本地运行</div>
      {detectedCommands.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {detectedCommands.map(c => (
            <button key={c.command}
              onClick={() => setSelectedCmd(c.command)}
              className={`text-xs px-2 py-0.5 rounded border ${selectedCmd === c.command && !customCmd ? "bg-accent-brand text-white border-accent-brand" : "border-border-200 hover:bg-bg-100"}`}
            >{c.label}</button>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <input
          value={customCmd}
          onChange={e => setCustomCmd(e.target.value)}
          placeholder={selectedCmd || "输入运行命令..."}
          className="flex-1 text-xs font-mono border border-border-200 rounded px-2 py-1 bg-bg-50 text-text-200"
        />
        {deployStatus !== "running" ? (
          <button
            onClick={() => sendEvent({ type: "subagent.postapply.deploy.start", payload: { managerSessionId, command: effectiveCmd } } as any)}
            disabled={!effectiveCmd.trim()}
            className="text-xs bg-green-600 text-white px-3 py-1 rounded hover:opacity-90 disabled:opacity-40"
          >运行</button>
        ) : (
          <button
            onClick={() => sendEvent({ type: "subagent.postapply.deploy.stop", payload: { managerSessionId } } as any)}
            className="text-xs bg-red-500 text-white px-3 py-1 rounded hover:opacity-90"
          >停止</button>
        )}
      </div>
      {deployLogs.length > 0 && (
        <div className="font-mono text-[10px] bg-gray-950 text-green-400 rounded p-2 max-h-40 overflow-y-auto leading-5">
          {deployLogs.map((line, i) => <div key={i}>{line}</div>)}
          <div ref={logsEndRef} />
        </div>
      )}
      {deployStatus === "error" && <div className="text-xs text-red-500">{deployError}</div>}
    </div>
  );
}
```

- [ ] **Step 4: 提交**

```bash
git add packages/client/src/components/PostApplyPanel.tsx
git commit -m "feat: add PostApplyPanel component with git commit and deploy sections"
```

---

## Task 7: 前端状态管理和 TaskTreeCard 集成

**Files:**
- Modify: `packages/client/src/store/useAppStore.ts`
- Modify: `packages/client/src/components/TaskTreeCard.tsx`

- [ ] **Step 1: 在 useAppStore.ts 中处理新事件**

在 useAppStore.ts 中找到处理 `subagent.merged` 的 case，在其后添加以下 case：

```typescript
case "subagent.postapply.ready": {
  const { managerSessionId, suggestedCommitMsg, isGitRepo } = (event as any).payload;
  set(state => ({
    subagentTrees: state.subagentTrees.map(t =>
      t.managerSessionId === managerSessionId
        ? { ...t, postApply: {
            managerSessionId,
            gitStatus: isGitRepo ? "idle" : "idle",
            suggestedCommitMsg: isGitRepo ? suggestedCommitMsg : "",
            deployStatus: "idle",
            detectedCommands: [],
            deployLogs: [],
          }}
        : t
    )
  }));
  // 请求检测命令（通过 deploy.start 获取列表，这里先通过 ready 事件携带）
  break;
}
case "subagent.postapply.git.committed": {
  const { managerSessionId, hash } = (event as any).payload;
  set(state => ({
    subagentTrees: state.subagentTrees.map(t =>
      t.managerSessionId === managerSessionId && t.postApply
        ? { ...t, postApply: { ...t.postApply, gitStatus: "committed", committedHash: hash } }
        : t
    )
  }));
  break;
}
case "subagent.postapply.git.pushed": {
  const { managerSessionId } = (event as any).payload;
  set(state => ({
    subagentTrees: state.subagentTrees.map(t =>
      t.managerSessionId === managerSessionId && t.postApply
        ? { ...t, postApply: { ...t.postApply, gitStatus: "pushed" } }
        : t
    )
  }));
  break;
}
case "subagent.postapply.git.error": {
  const { managerSessionId, error } = (event as any).payload;
  set(state => ({
    subagentTrees: state.subagentTrees.map(t =>
      t.managerSessionId === managerSessionId && t.postApply
        ? { ...t, postApply: { ...t.postApply, gitStatus: "error", gitError: error } }
        : t
    )
  }));
  break;
}
case "subagent.deploy.output": {
  const { managerSessionId, data } = (event as any).payload;
  set(state => ({
    subagentTrees: state.subagentTrees.map(t =>
      t.managerSessionId === managerSessionId && t.postApply
        ? { ...t, postApply: { ...t.postApply, deployLogs: [...t.postApply.deployLogs, ...data.split("\n").filter(Boolean)] } }
        : t
    )
  }));
  break;
}
case "subagent.deploy.status": {
  const { managerSessionId, status, error } = (event as any).payload;
  set(state => ({
    subagentTrees: state.subagentTrees.map(t =>
      t.managerSessionId === managerSessionId && t.postApply
        ? { ...t, postApply: { ...t.postApply, deployStatus: status, deployError: error } }
        : t
    )
  }));
  break;
}
```

同时，当用户点击提交时需要先把 gitStatus 设为 "committing"。在 case `subagent.postapply.git.commit` 发送之前，可以在 PostApplyPanel 组件里用乐观更新处理，或者在这里监听 client 事件。最简单的方式是在 PostApplyPanel 的 commit 按钮 onClick 里额外 dispatch 一个本地状态更新（通过 useAppStore 的 action）。在 useAppStore 中额外暴露：

```typescript
setPostApplyGitStatus: (managerSessionId: string, status: import("@local-claw/shared/src/types").PostApplyGitStatus) => {
  set(state => ({
    subagentTrees: state.subagentTrees.map(t =>
      t.managerSessionId === managerSessionId && t.postApply
        ? { ...t, postApply: { ...t.postApply, gitStatus: status } }
        : t
    )
  }));
},
setPostApplyDetectedCommands: (managerSessionId: string, commands: import("@local-claw/shared/src/types").DetectedCommand[]) => {
  set(state => ({
    subagentTrees: state.subagentTrees.map(t =>
      t.managerSessionId === managerSessionId && t.postApply
        ? { ...t, postApply: { ...t.postApply, detectedCommands: commands } }
        : t
    )
  }));
},
```

- [ ] **Step 2: 在 TaskTreeCard.tsx 中渲染 PostApplyPanel**

在文件顶部 import 中加上：
```typescript
import { PostApplyPanel } from "./PostApplyPanel";
```

找到 TaskTreeCard 组件 return 最外层 div 的结束位置（`</div>` 前），在 conflicts section 之后加上：

```typescript
{tree.postApply && (
  <PostApplyPanel state={tree.postApply} sendEvent={sendEvent} />
)}
```

同时更新 PostApplyPanel 的 commit 按钮，加入乐观 gitStatus 更新（使用 useAppStore 的 setPostApplyGitStatus）：

在 PostApplyPanel.tsx 顶部加 import：
```typescript
import { useAppStore } from "../store/useAppStore";
```

在组件内加：
```typescript
const setGitStatus = useAppStore(s => s.setPostApplyGitStatus);
```

提交按钮 onClick 修改为：
```typescript
onClick={() => {
  setGitStatus(managerSessionId, "committing");
  sendEvent({ type: "subagent.postapply.git.commit", payload: { managerSessionId, message: commitMsg } } as any);
}}
```

- [ ] **Step 3: 同步处理 deploy 检测命令**

需要在 `subagent.postapply.ready` 事件中一并携带 `detectedCommands`，修改 subagent.service.ts 的 `initPostApply` 发出事件，加入 deploy 信息。

在 `subagent.service.ts` 的 `initPostApply` 方法中（Task 4 Step 2 写的代码），替换 emit 部分，引入 DeployService：

在构造函数注入 DeployService（同时更新 subagent.module.ts imports）：
```typescript
@Inject(DeployService) private readonly deployService: DeployService,
```

subagent.module.ts imports 加入 DeployModule：
```typescript
import { DeployModule } from "../deploy/deploy.module";
// imports: [..., DeployModule]
```

`initPostApply` 的 emit 替换为：
```typescript
const detectedCommands = this.deployService.detectCommands(tree.cwd);
this.emit({
  type: "subagent.postapply.ready",
  payload: {
    managerSessionId,
    suggestedCommitMsg,
    isGitRepo: isGit,
    detectedCommands,
  }
} as any);
```

对应的前端 `subagent.postapply.ready` case 里补充 detectedCommands：
```typescript
detectedCommands: (event as any).payload.detectedCommands ?? [],
```

- [ ] **Step 4: 提交**

```bash
git add packages/client/src/store/useAppStore.ts packages/client/src/components/TaskTreeCard.tsx packages/client/src/components/PostApplyPanel.tsx packages/server/src/modules/subagent/
git commit -m "feat: integrate PostApplyPanel into TaskTreeCard with state management"
```

---

## 自检

- [x] Git 提交流程（生成消息 → 提交 → 推送）覆盖完整
- [x] 本地运行流程（检测命令 → 启动 → 流式日志 → 停止）覆盖完整
- [x] 非 Git 仓库场景：isGitRepo=false 时 suggestedCommitMsg 为空，Git section 不显示
- [x] 所有新 WebSocket 事件在 gateway 中有对应处理
- [x] DeployService 进程 map 防止同一 managerSessionId 重复启动
- [x] 类型名称一致：`PostApplyGitStatus`、`PostApplyDeployStatus`、`PostApplyState`、`DetectedCommand`
