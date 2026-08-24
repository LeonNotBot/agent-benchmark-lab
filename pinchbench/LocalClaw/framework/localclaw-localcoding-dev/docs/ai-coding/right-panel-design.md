# AI Coding 右侧结果面板 需求文档

## 一、背景与目标

参考腾讯 WorkBuddy 的右侧面板交互设计，在 AI Coding 任务完成后，以右侧推出面板的方式展示任务产物、文件、变更和部署入口，替代现有的卡片堆叠方式，提升结果查阅体验。

**已确认设计决策（2026-05-12）：**
- 部署 Tab 中无需内置浏览器，仅需「在外部浏览器中打开」按钮（调用 `shell.openExternal`）
- Tab C 变更的 diff 视图采用**整文件 side-by-side 左右分割**布局（左栏旧版本，右栏新版本，行号对齐）

---

## 二、现有逻辑梳理（需清理）

| 现有组件 | 现有行为 | 新方案处置 |
|---------|---------|-----------|
| `SessionFilesCard` | 会话结束后弹出浮层显示生成文件 | **删除**此触发逻辑（组件本身可复用或重构） |
| `SessionSummary` | 内联渲染资源使用摘要卡片 | 迁移至右侧面板 Tab A |
| `SessionDiffCard` | 内联渲染文件变更 diff 卡片 | 迁移至右侧面板 Tab C |
| `PostApplyPanel` | 内联渲染 git 提交 + 本地运行 | 迁移至右侧面板 Tab D |

---

## 三、新增交互逻辑

### 3.1 面板打开时机

- 任务（session / subagent）完成（`status === "completed"` 或 `status === "error"`）时，在对话区底部显示「**查看结果**」按钮。
- 点击按钮后，右侧面板以向左推出动画（`transform: translateX(100%) → 0`，时长 250ms ease-out）展开。
- 面板打开后，「查看结果」按钮变为「收起结果」，再次点击收起面板（反向动画）。

### 3.2 面板收起/展开入口

- 中间对话区**右上角**固定一个图标按钮（⬅️ / ➡️ 箭头），控制右侧面板的收起/展开，与「查看结果」按钮状态同步。
- 面板收起时，中间对话区宽度回弹；面板展开时，中间对话区右移压缩（flex 布局，不遮挡内容）。

### 3.3 面板宽度

- 默认宽度：`420px`，最小宽度 `320px`，最大宽度 `600px`。
- 面板左侧边缘支持拖拽调整宽度（可选，作为后续迭代）。

---

## 四、右侧面板内容（4 个 Tab）

### Tab A：资源使用

**目标**：展示本次任务的规划任务列表 + 资源消耗。

**内容区块（从上到下）**：

1. **规划任务列表**（新增）
   - 仅在 subagent 模式下显示（数据来源：`SubagentTaskTree.tasks`）
   - 每条任务一行：左侧图标表示状态，右侧任务标题
   - 状态图标映射：
     - `pending`：灰色圆圈 ○
     - `running`：蓝色旋转动画 ⟳
     - `completed`：绿色对勾 ✓
     - `failed`：红色 ✗
     - `cancelled`：灰色斜线 ⊘
   - 任务可展开显示涉及的文件列表（复用 TaskTreeCard 中现有逻辑）

2. **资源使用摘要**（复用 `SessionSummary` 展开态内容）
   - Skills、记忆、MCP工具、Agent、其他工具
   - 以标签 pill 样式展示，沿用现有样式

---

### Tab B：全部文件

**目标**：类文件浏览器，以当前会话工作目录为根节点，递归展示目录和文件。

**交互细节**：

- 根目录路径显示在 Tab 顶部（可复制）
- 目录节点：左侧三角展开/收起图标（`▶` / `▼`），点击展开加载子项
- 文件节点：点击后在右侧面板内嵌代码查看器预览文件内容，支持语法高亮
- 文件图标根据扩展名区分（代码/图片/文档等）
- 支持刷新按钮（重新读取目录树）

**数据来源**：
- 工作目录：`session.cwd` 或 `generatedFilesDir`
- 目录树接口：新增后端 API `GET /api/workspace/tree?path=xxx&depth=2`
- 文件内容接口：复用现有 `GET /api/workspace/file?path=xxx`

---

### Tab C：变更

**目标**：展示本次会话产生的文件变更，支持左右对比 diff，支持 git 操作。

**内容布局**：

1. **文件变更列表**（左侧或上方）
   - 复用 `SessionDiffCard` / `TaskTreeCard.mergedDiffs` 的文件列表逻辑
   - 每行：状态标签（A/M/D）+ 文件路径 + +N -N 统计
   - 点击文件后，右侧（或下方）展示左右对比 diff 视图

2. **左右对比 Diff 视图**
   - 左栏：旧版本内容（红色标注删除行）
   - 右栏：新版本内容（绿色标注新增行）
   - 顶部展示文件路径
   - 行号对齐显示
   - 复用现有 `DiffHunk` / `DiffLine` 数据结构

3. **Git 操作区**（底部固定）
   - **已是 git 仓库**：
     - 显示 commit message 输入框（预填 AI 建议的提交信息）
     - 「提交」按钮 → 成功后显示 commit hash
     - 「推送到远端」按钮（提交成功后激活）
   - **不是 git 仓库**：
     - 显示「初始化 git 仓库」按钮
     - 初始化成功后切换为已是 git 仓库状态，显示提交流程
   - 状态判断：通过新增后端接口 `GET /api/workspace/git-status?path=xxx` 返回 `{ isRepo: boolean, suggestedCommitMsg?: string }`

---

### Tab D：部署

**目标**：本地运行预览 + 远程服务器部署。

#### D.1 本地运行（复用现有逻辑）

- 复用 `PostApplyPanel` 中的「本地运行」区块
- 显示检测到的启动命令按钮（`detectedCommands`）
- 支持自定义命令输入
- 运行状态 + 日志实时流式展示（`deployLogs`）
- 停止按钮

#### D.2 远程服务器部署（新功能）

**设计方案**：

用户在设置中配置一台安装了 Docker 的远程服务器，部署时将项目打包上传到远程服务器，通过 Docker 运行并返回可访问的 URL。

**交互流程**：

```
[配置远程服务器] → [选择部署配置] → [点击"部署到远程"] 
    → [打包 & 上传进度条] 
    → [Docker 构建日志流式输出]
    → [部署成功，显示访问地址]
    → [在外部浏览器中打开]
```

**UI 元素**：

1. **服务器配置区**（折叠展示，未配置时提示）
   - 服务器地址（host:port）
   - SSH 用户名
   - SSH 密钥路径 / 密码（敏感信息，打码显示）
   - 「测试连接」按钮 → 显示连接状态

2. **部署配置**
   - 暴露端口：默认 `3000`，可修改
   - Dockerfile 路径：默认 `./Dockerfile`，若不存在则自动生成（根据项目类型判断）
   - 容器名称：默认用会话 ID 生成

3. **部署按钮 + 状态**
   - `idle`：「部署到远程服务器」按钮
   - `uploading`：「上传中 N%」进度条
   - `building`：Docker 构建日志滚动区
   - `running`：绿色「运行中」标识 + 访问地址 + 「在浏览器中打开」按钮（调用 `shell.openExternal`）+ 「停止」按钮
   - `error`：红色错误信息

**后端 API**：

| 接口 | 方法 | 说明 |
|-----|------|------|
| `/api/remote-deploy/test` | POST | 测试 SSH 连接 |
| `/api/remote-deploy/deploy` | POST | 上传并触发 Docker 部署，返回 SSE 流 |
| `/api/remote-deploy/stop` | POST | 停止远程容器 |
| `/api/remote-deploy/config` | GET/PUT | 读写服务器配置（存入 settings） |

**远程执行逻辑（后端）**：

1. 通过 SSH（`ssh2` 库）连接远程服务器
2. 使用 `rsync` 或 `scp` 将本地项目目录同步到远程 `~/workbuddy-deploy/{sessionId}/`
3. 在远程执行 `docker build -t app-{sessionId} .`
4. 执行 `docker run -d -p {hostPort}:{containerPort} --name app-{sessionId} app-{sessionId}`
5. 返回 `http://{host}:{hostPort}` 作为访问地址
6. 客户端调用 Electron 的 `shell.openExternal(url)` 在外部浏览器打开

---

## 五、布局结构

```
┌──────────┬────────────────────────────┬──────────────────────┐
│          │                            │  右侧结果面板          │
│  Sidebar │  对话区（中间）              │  [资源使用][全部文件]   │
│          │           [⬅收起/展开➡]    │  [变更   ][部署    ]   │
│          │                            │                      │
│          │  PromptInput               │  Tab 内容区           │
└──────────┴────────────────────────────┴──────────────────────┘
```

- 面板收起：中间区域占满右侧空间
- 面板展开：中间区域 + 右侧面板 flex 分割，面板宽度 420px
- 动画：CSS transition on `width` / `transform`

---

## 六、需要新增的后端接口汇总

| 接口 | 说明 | 优先级 |
|-----|------|--------|
| `GET /api/workspace/tree` | 返回目录树（深度可配置） | P0 |
| `GET /api/workspace/file` | 返回文件内容（已有类似接口需确认） | P0 |
| `GET /api/workspace/git-status` | 判断是否 git 仓库 + 建议 commit message | P0 |
| `POST /api/workspace/git-init` | 初始化 git 仓库 | P1 |
| `POST /api/remote-deploy/test` | SSH 连接测试 | P1 |
| `POST /api/remote-deploy/deploy` | 上传 + Docker 构建 + 运行（SSE 流） | P1 |
| `POST /api/remote-deploy/stop` | 停止远程容器 | P1 |
| `GET/PUT /api/remote-deploy/config` | 服务器配置读写 | P1 |

---

## 七、需要修改的现有代码

| 文件 | 改动 | 说明 |
|-----|------|------|
| `App.tsx` | 删除 `SessionFilesCard` 的触发渲染逻辑 | 不再在会话结束时弹出文件浮层 |
| `App.tsx` | 添加右侧面板状态（`rightPanelOpen`）和布局切分 | flex 布局三栏结构 |
| `App.tsx` | 对话区右上角添加收起/展开按钮 | |
| `SessionSummary.tsx` | 内容可独立使用（props 解耦，供 Tab A 调用） | |
| `SessionDiffCard.tsx` | 支持左右对比 diff 布局 | 在宽度足够时启用左右排版 |
| `PostApplyPanel.tsx` | 逻辑迁移至 Tab D，同时扩展远程部署 UI | |
| `useAppStore.ts` | 添加 `rightPanelOpen`、`rightPanelTab` 状态 | |

---

## 八、新增组件清单

| 组件 | 说明 |
|-----|------|
| `RightResultPanel.tsx` | 右侧面板容器，含 4 tab 切换 |
| `ResourceUsageTab.tsx` | Tab A：规划任务列表 + 资源摘要 |
| `FileBrowserTab.tsx` | Tab B：文件浏览器 + 内嵌代码查看器 |
| `ChangesTab.tsx` | Tab C：变更文件列表 + 左右 diff + git 操作 |
| `DeployTab.tsx` | Tab D：本地运行 + 远程部署 |
| `RemoteDeployConfig.tsx` | 远程服务器配置表单（可复用于设置页） |
