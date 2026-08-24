# AI Coding 右侧结果面板 技术方案

基于需求文档 `right-panel-design.md`，本文描述实现细节、改动范围和接口约定。

---

## 一、整体架构变化

### 布局重构（App.tsx）

现有布局：`Sidebar(280px) | main(flex-1)`

目标布局：`Sidebar(280px) | conversation(flex-1) | RightResultPanel(420px, 可收起)`

```
<div class="h-screen flex flex-col">
  <TitleBar />
  <div class="flex flex-1 min-h-0">
    <Sidebar />
    <div class="flex flex-1 min-h-0 lg:ml-[280px]">
      <!-- 对话区 -->
      <div class="flex flex-col flex-1 min-w-0 relative">
        <main>...</main>
        <PromptInput />
      </div>
      <!-- 右侧面板（动画推出） -->
      <RightResultPanel />
    </div>
  </div>
</div>
```

右侧面板以 CSS transition 控制宽度：
- 收起：`width: 0; overflow: hidden`
- 展开：`width: 420px; border-left: 1px solid border`
- 动画：`transition: width 250ms ease-out`

---

## 二、State 变更（useAppStore）

在 `AppState` 新增：

```ts
// 右侧面板
rightPanelOpen: boolean;
rightPanelTab: "resources" | "files" | "changes" | "deploy";
setRightPanelOpen: (open: boolean) => void;
setRightPanelTab: (tab: AppState["rightPanelTab"]) => void;
```

初始值：`rightPanelOpen: false`，`rightPanelTab: "resources"`

触发时机：当 `activeSession.status` 变为 `"completed"` 或 `"error"` 时，不自动打开（由用户点击「查看结果」按钮触发）。

---

## 三、App.tsx 改动

### 3.1 删除 SessionFilesCard 渲染

删除如下代码块（约 App.tsx:456-462）：
```tsx
{(activeSession.status === "completed" || ...) &&
  activeSession.generatedFiles && ... && (
  <SessionFilesCard ... />
)}
```

### 3.2 新增「查看结果」按钮

在 `streamEndRef` 上方，当 `status === "completed" || "error"` 时显示：

```tsx
{(activeSession.status === "completed" || activeSession.status === "error") && (
  <div className="flex justify-end mt-4 mb-2">
    <button
      onClick={() => {
        setRightPanelOpen(!rightPanelOpen);
        if (!rightPanelOpen) setRightPanelTab("resources");
      }}
      className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full
                 bg-accent-brand text-white hover:bg-accent-hover"
    >
      <span>{rightPanelOpen ? "收起结果" : "查看结果"}</span>
      <span>{rightPanelOpen ? "→" : "←"}</span>
    </button>
  </div>
)}
```

### 3.3 对话区右上角收起/展开按钮

在 `<main>` 右上角固定位置（绝对定位于对话区内）：

```tsx
{activeSession && (activeSession.status === "completed" || ...) && (
  <button
    onClick={() => setRightPanelOpen(!rightPanelOpen)}
    className="absolute top-3 right-3 z-10 p-1.5 rounded-md
               text-text-400 hover:bg-bg-200 hover:text-text-200"
    title={rightPanelOpen ? "收起结果面板" : "展开结果面板"}
  >
    {/* 左右箭头 SVG */}
  </button>
)}
```

### 3.4 保留内联卡片（SessionSummary 等不删）

`SessionSummary`、`SessionDiffCard`、`PostApplyPanel` 在对话流中的渲染**保留不动**（右侧面板是附加展示，不是替代）。只删除 `SessionFilesCard` 的触发。

---

## 四、新增组件

### 4.1 RightResultPanel.tsx（主容器）

```
packages/client/src/components/right-panel/
├── RightResultPanel.tsx      # 容器 + Tab 切换
├── ResourceUsageTab.tsx      # Tab A
├── FileBrowserTab.tsx        # Tab B
├── ChangesTab.tsx            # Tab C
└── DeployTab.tsx             # Tab D
```

`RightResultPanel` 职责：
- 读取 `rightPanelOpen`、`rightPanelTab`、`activeSession`、`subagentTrees`
- 渲染 4 个 Tab header（图标 + 文字，激活态下划线）
- 渲染对应 Tab 内容区（`overflow-y-auto`）
- 面板顶部显示当前会话工作目录（缩略显示）

Tab 标签：
| 值 | 标签 | 图标 |
|----|------|------|
| `resources` | 资源使用 | ⚡ |
| `files` | 全部文件 | 📁 |
| `changes` | 变更 | ± |
| `deploy` | 部署 | 🚀 |

---

### 4.2 ResourceUsageTab.tsx（Tab A）

**规划任务列表**（subagent 模式才显示）：
- 数据源：`Object.values(subagentTrees)` 中与 `activeSessionId` 匹配的 tree
- 渲染 `tree.tasks` 列表，每项：状态图标 + title
- 状态图标（SVG/emoji）：
  - `pending` → `○`（灰圈，text-text-400）
  - `running` → 旋转 spinner（animate-spin，text-blue-500）
  - `completed` → `✓`（text-green-600）
  - `failed` → `✗`（text-red-500）
  - `cancelled` → `⊘`（text-text-400）

**资源摘要**：
- 直接复用 `SessionSummary` 组件，但强制传入 `expanded=true`（通过 props 或局部状态）
- 去掉 SessionSummary 的折叠 header，只保留内容区

实现方式：提取 `SessionSummary` 中的内容部分为 `SessionSummaryContent` 子组件，在 Tab A 直接使用。

---

### 4.3 FileBrowserTab.tsx（Tab B）

**数据来源**：`activeSession.cwd` 或 `activeSession.generatedFilesDir`

**目录树结构**（客户端 state）：
```ts
type FileTreeNode = {
  name: string;
  path: string;
  isDir: boolean;
  children?: FileTreeNode[];  // undefined = 未加载
  expanded: boolean;
};
```

**交互**：
- 初始加载根目录（depth=1）
- 点击目录：若 `children === undefined` 则请求 `GET /api/workspace/tree?path=xxx&depth=1`，然后展开
- 点击文件：请求 `GET /api/workspace/file-content?path=xxx`，在面板下半部展示内容
- 文件预览区：`<pre>` 包裹，`overflow-auto max-h-60`，等宽字体，文字 xs
- 顶部「刷新」按钮：重置 tree state，重新加载根目录

**后端接口**（新增）：

```
GET /api/workspace/tree?path={dir}&depth={n}
Response: {
  nodes: Array<{
    name: string;
    path: string;
    isDir: boolean;
    size?: number;    // 文件才有
  }>
}
```

```
GET /api/workspace/file-content?path={file}
Response: {
  content: string;
  encoding: "utf8" | "binary";
  size: number;
}
```
（二进制文件返回 `encoding: "binary"`，前端显示「二进制文件，无法预览」）

---

### 4.4 ChangesTab.tsx（Tab C）

**数据来源**：
- 普通 session：`activeSession.diffs`
- subagent 模式：找对应 tree 的 `tree.mergedDiffs`

**布局**：
- 上半部：文件列表（`max-h-48 overflow-y-auto`），每行可点击
- 下半部：被选中文件的 side-by-side diff

**Side-by-Side Diff 实现**：

当前 `FileDiff.hunks[].lines` 是混合的 add/remove/context 行，需要转为左右两列：

```ts
function toSideBySide(hunk: DiffHunk): { left: SideLine[]; right: SideLine[] } {
  // left 含 context + remove 行（remove 标红，context 正常，add 位置留空占位）
  // right 含 context + add 行（add 标绿，context 正常，remove 位置留空占位）
  // 行号对齐：remove 和 add 成对时占同一行号行
}
type SideLine = { lineNo: number | null; content: string; type: "context"|"add"|"remove"|"empty" };
```

渲染：两列等宽 flex，左右各自 `overflow-x-auto`，行高 `leading-5`，字体 `text-[11px] font-mono`

**Git 操作区**（固定在 Tab 底部）：

状态判断：进入 Tab C 时请求 `GET /api/git/repo-info?path={cwd}`

```ts
// 响应结构
{ isRepo: boolean; suggestedCommitMsg?: string; currentBranch?: string }
```

- **非 git 仓库**：
  ```
  [💡 此目录尚未初始化 git 仓库]
  [ 初始化 git 仓库 ]
  ```
  点击初始化：调用 `POST /api/git/init { path }` → 成功后刷新状态，显示提交区

- **已是 git 仓库**：
  ```
  commit message: [__________________________]
  [ 提交 ]
  // 提交成功后
  ✓ 已提交 abc1234   [ 推送到远端 ]
  ```

接口复用现有 WebSocket 事件：`subagent.postapply.git.commit` / `subagent.postapply.git.push`

新增 HTTP 接口：

```
GET  /api/git/repo-info?path={cwd}
POST /api/git/init  { path: string }
```

`repo-info` 实现：
1. 调用 `GitService.isGitRepo(path)`
2. 若是 repo，调用 `GitService.generateCommitMessage(path, diffs)` 生成建议信息
3. 返回 `{ isRepo, suggestedCommitMsg, currentBranch }`

---

### 4.5 DeployTab.tsx（Tab D）

分两个区块：本地运行 + 远程部署

#### D.1 本地运行（复用）

直接复用 `PostApplyPanel` 的「本地运行」区块 JSX（建议提取为独立的 `LocalRunSection` 组件）。
数据源：`activeSession.postApply` 或 `tree.postApply`

#### D.2 远程部署（新）

**配置区**（折叠 `<details>`，点击展开）：

```
[⚙ 远程服务器配置]
  Host: [_______________]  Port: [22]
  User: [_______________]
  SSH Key: [~/...] 或 密码模式
  [测试连接]  ○ 未测试 / ✓ 连接成功 / ✗ 连接失败
```

配置持久化：`GET/PUT /api/remote-deploy/config`，存入 settings（加密存储密码）

**部署区**（状态机 UI）：

| 状态 | 显示 |
|------|------|
| idle | 端口 [3000]，`[🚀 部署到远程服务器]` 按钮 |
| uploading | `上传中 ██████ 67%` 进度条 |
| building | docker build 日志滚动区（SSE 流） |
| running | `▶ 运行中` + `http://host:port` 链接 + `[在浏览器中打开]` + `[停止]` |
| error | 红色错误文本 |

**「在浏览器中打开」**：
```ts
// Electron renderer 调用
window.electron?.shell?.openExternal(url)
// 降级：window.open(url, "_blank")
```

**后端实现（新增 remote-deploy 模块）**：

```
packages/server/src/modules/remote-deploy/
├── remote-deploy.module.ts
├── remote-deploy.controller.ts
└── remote-deploy.service.ts
```

`RemoteDeployService` 依赖 `ssh2` 包（需 `pnpm add ssh2 @types/ssh2`）。

主要方法：

```ts
async testConnection(config: SshConfig): Promise<{ ok: boolean; error?: string }>

async deploy(
  config: SshConfig,
  localDir: string,
  sessionId: string,
  port: number,
  onLog: (line: string) => void,
): Promise<{ url: string }>
// 内部步骤：
// 1. ssh2 连接
// 2. sftp 上传（或 rsync via exec）到 ~/localclaw-deploy/{sessionId}/
// 3. exec: docker build -t lc-{sessionId} .
// 4. exec: docker run -d -p {port}:{containerPort} --name lc-{sessionId} lc-{sessionId}
// 5. 返回 url = http://{host}:{port}

async stopDeploy(config: SshConfig, sessionId: string): Promise<void>
```

Controller 接口：

```
GET  /api/remote-deploy/config
PUT  /api/remote-deploy/config   { host, port, user, keyPath?, password? }
POST /api/remote-deploy/test     { host, port, user, keyPath?, password? }
POST /api/remote-deploy/deploy   { sessionId, localDir, exposePort }  → SSE stream
POST /api/remote-deploy/stop     { sessionId }
```

SSE 流格式：
```
data: {"type":"log","line":"Step 1/5 : FROM node:18"}
data: {"type":"log","line":"Successfully built abc123"}
data: {"type":"done","url":"http://192.168.1.10:3000"}
data: {"type":"error","message":"Connection refused"}
```

前端用 `EventSource` 或 `fetch` + `ReadableStream` 读取 SSE 日志行。

---

## 五、后端新增接口汇总

| 接口 | 方法 | 模块 | 优先级 |
|------|------|------|--------|
| `/api/workspace/tree` | GET | workspace | P0 |
| `/api/workspace/file-content` | GET | workspace | P0 |
| `/api/git/repo-info` | GET | workspace/git | P0 |
| `/api/git/init` | POST | workspace/git | P1 |
| `/api/remote-deploy/config` | GET/PUT | remote-deploy | P1 |
| `/api/remote-deploy/test` | POST | remote-deploy | P1 |
| `/api/remote-deploy/deploy` | POST (SSE) | remote-deploy | P1 |
| `/api/remote-deploy/stop` | POST | remote-deploy | P1 |

---

## 六、改动文件清单

### 前端

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/App.tsx` | 修改 | 删 SessionFilesCard 渲染；加「查看结果」按钮；加右上角收起按钮；加 RightResultPanel；布局三栏 |
| `src/store/useAppStore.ts` | 修改 | 新增 rightPanelOpen/Tab 状态和 setter |
| `src/components/SessionSummary.tsx` | 修改 | 提取 `SessionSummaryContent`（无折叠 header）供 Tab A 复用 |
| `src/components/PostApplyPanel.tsx` | 修改 | 提取 `LocalRunSection` 组件供 Tab D 复用 |
| `src/components/right-panel/RightResultPanel.tsx` | 新增 | 主容器 |
| `src/components/right-panel/ResourceUsageTab.tsx` | 新增 | Tab A |
| `src/components/right-panel/FileBrowserTab.tsx` | 新增 | Tab B |
| `src/components/right-panel/ChangesTab.tsx` | 新增 | Tab C |
| `src/components/right-panel/DeployTab.tsx` | 新增 | Tab D |

### 后端

| 文件 | 操作 | 说明 |
|------|------|------|
| `workspace.controller.ts` | 修改 | 新增 tree、file-content、repo-info、git-init 接口 |
| `workspace.service.ts` | 修改 | 新增 readTree、readFileContent 方法 |
| `remote-deploy/` | 新增 | 4 个文件（module/controller/service + 类型） |
| `app.module.ts` | 修改 | 注册 RemoteDeployModule |

---

## 七、实施顺序建议

1. **P0 核心骨架**：store 状态 + App.tsx 布局 + RightResultPanel 空壳 + Tab 切换
2. **P0 Tab A**：ResourceUsageTab（复用 SessionSummary 内容，工作量最小）
3. **P0 Tab B**：FileBrowserTab + 后端 tree/file-content 接口
4. **P0 Tab C**：ChangesTab（side-by-side diff + 复用现有 git 操作）+ 后端 repo-info/git-init 接口
5. **P0 Tab D 本地运行**：提取 LocalRunSection，嵌入 DeployTab
6. **P1 Tab D 远程部署**：RemoteDeployService + SSE 流 + 配置表单
