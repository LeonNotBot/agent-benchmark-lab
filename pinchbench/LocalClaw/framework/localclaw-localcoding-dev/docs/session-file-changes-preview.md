# 会话变更文件汇总与预览功能方案

## Context
用户希望在会话完成后，在现有的 SessionSummary 区域追加展示项目目录（cwd）下所有有变动的文件（增删改），点击文件后在右侧滑入一个预览面板，根据文件格式选择合适的预览方式。

---

## 整体架构

```
[左侧Sidebar] | [消息区域 + SessionSummary含变更文件列表] | [右侧预览面板（滑入）]
```

预览面板通过 `selectedPreviewFile`（Zustand 中的 SessionView 字段）控制，以 CSS `translate-x` 动画从右侧滑入，不破坏现有 DOM 结构。

---

## 一、数据类型扩展

**修改文件：`packages/shared/src/types.ts`**

在文件末尾追加：

```typescript
// ── File Changes types ──
export type FileChangeStatus = "added" | "modified" | "deleted";
export type ChangedFile = {
  path: string;         // 相对于 cwd 的路径
  status: FileChangeStatus;
};
export type FileChangesResult = {
  files: ChangedFile[];
};
```

---

## 二、后端变更

### 2.1 新建 FileChangeService

**新建文件：`packages/server/src/modules/session/file-change.service.ts`**

#### 变更检测策略

由于用户工作目录不一定是 git 仓库，采用**文件系统快照比对**方案：

- 会话启动时（`session.start`），对 cwd 做一次快照：扫描所有文件记录 `path → mtime`（修改时间），存入内存 `Map<sessionId, FileSnapshot>`
- 会话完成时，重新扫描 cwd，与快照对比，计算出增删改文件列表
- 扫描时跳过常见大目录：`node_modules`, `.git`, `dist`, `build`, `.next`, `out`, `__pycache__`, `.cache`, `coverage`, `.turbo`, `.vite`
- 文件数量上限：10,000 个文件；路径深度上限：10 层（防止无限递归）

核心方法：
- `takeSnapshot(sessionId, cwd)` — 会话开始时调用，记录初始快照
- `getChangedFiles(sessionId, cwd): FileChangesResult` — 会话完成时或按需调用，返回变更列表
- `getFileContent(cwd, relativePath)` — 读取文件内容，含路径穿越防护（path traversal guard）和大小限制（10MB）
- `getFilePath(cwd, relativePath)` — 返回绝对路径，含同等路径穿越防护

> **注意（Windows 兼容）**：路径穿越防护同时检查 `path.sep`（`\`）和 `/`，确保在 Windows 下正常工作。

### 2.2 触发快照的时机

**修改文件：`packages/server/src/modules/websocket/websocket.gateway.ts`**

在 `onSessionStart` 和 `onSessionContinue` 处理中，在 runner 启动前调用 `fileChangeService.takeSnapshot(sessionId, cwd)`，确保每次会话执行都有基线快照。

### 2.3 扩展 SessionController

**修改文件：`packages/server/src/modules/session/session.controller.ts`**

新增三个端点：

| 端点 | 说明 |
|------|------|
| `GET /api/sessions/:id/changed-files` | 返回 `{ files }`，调用 `fileChangeService.getChangedFiles(sessionId, cwd)` |
| `GET /api/sessions/:id/file-content?path=` | 返回 `{ content, encoding, mimeType, tooLarge? }`，文本 utf8，图片/PDF base64 |
| `GET /api/sessions/:id/file-raw?path=` | 直接流式返回文件内容（NestJS `@Res()`），供 iframe/embed/img src 使用 |

**修改文件：`packages/server/src/modules/session/session.module.ts`**

将 `FileChangeService` 加入 `providers` 和 `exports` 数组。

---

## 三、前端状态管理

### 3.1 扩展 SessionView

**修改文件：`packages/client/src/store/useAppStore.ts`**

在 `SessionView` 类型中增加：
```typescript
changedFiles?: ChangedFile[];
changedFilesLoaded?: boolean;
selectedPreviewFile?: string | null;
```

新增 action：`setSelectedPreviewFile(sessionId: string, path: string | null) => void`

### 3.2 在会话完成时自动加载

在 `handleServerEvent` 的 `session.usage` case 处理末尾，并行 fetch 变更文件列表并存入 store：
```typescript
fetch(`/api/sessions/${sessionId}/changed-files`)
  .then(r => r.json())
  .then(({ files }) => set((state) => {
    const s = state.sessions[sessionId];
    if (!s) return state;
    return { sessions: { ...state.sessions, [sessionId]: { ...s, changedFiles: files, changedFilesLoaded: true } } };
  }))
  .catch(() => {});
```

---

## 四、前端组件

### 4.1 新建 ChangedFilesList

**新建文件：`packages/client/src/components/ChangedFilesList.tsx`**

Props：`{ files: ChangedFile[], selectedFile: string | null, onSelectFile: (p: string) => void }`

UI 细节：
- 状态徽标颜色：`A`=绿色、`M`=黄色、`D`=红色（含删除线）
- 文件名显示 basename，完整路径作为 `title` tooltip
- 选中项加 `bg-accent/10 border border-accent/20` 高亮
- 已删除文件（`D`）显示但点击不触发预览

### 4.2 修改 SessionSummary

**修改文件：`packages/client/src/components/SessionSummary.tsx`**

新增 Props：`sessionId?: string`、`changedFiles?: ChangedFile[]`、`selectedPreviewFile?: string | null`、`onSelectFile?: (p: string) => void`

在展开区域末尾追加 ChangedFilesList Section（有文件时才渲染）；在折叠状态的徽标行也追加一个文件数量徽标。

### 4.3 新建 FilePreviewPanel

**新建文件：`packages/client/src/components/FilePreviewPanel.tsx`**

Props：`{ sessionId: string, filePath: string | null, onClose: () => void }`

定位：`fixed top-10 right-0 bottom-0 w-full lg:w-[480px] z-30`，`translate-x-full → translate-x-0` 滑入动画。

文件格式判断（基于扩展名）：

| 类型 | 扩展名示例 | 渲染方式 |
|------|-----------|---------|
| HTML | .html .htm | `<iframe sandbox="allow-same-origin" src="/api/sessions/:id/file-raw?path=...">` |
| PDF | .pdf | `<embed type="application/pdf" src="/api/sessions/:id/file-raw?path=...">` |
| 图片 | .png .jpg .gif .svg 等 | fetch JSON content → `<img src="data:...;base64,...">` |
| 代码/文本 | 其他 | fetch JSON content → `hljs.highlight()` → `<pre><code dangerouslySetInnerHTML>` |

加载态：骨架屏；错误态：友好提示；文件过大：提示无法预览。

---

## 五、布局调整

**修改文件：`packages/client/src/App.tsx`**

1. 引入 `FilePreviewPanel` 组件
2. 从 store 获取 `setSelectedPreviewFile` action
3. 更新 `<SessionSummary>` 调用，传入文件相关 props
4. 在 `<ToastContainer>` 前添加 `<FilePreviewPanel>` 渲染

```tsx
<SessionSummary
  summary={activeSession.usageSummary}
  sessionId={activeSessionId ?? undefined}
  changedFiles={activeSession.changedFiles}
  selectedPreviewFile={activeSession.selectedPreviewFile}
  onSelectFile={(path) => activeSessionId && setSelectedPreviewFile(activeSessionId, path)}
/>

{activeSessionId && activeSession && (
  <FilePreviewPanel
    sessionId={activeSessionId}
    filePath={activeSession.selectedPreviewFile ?? null}
    onClose={() => setSelectedPreviewFile(activeSessionId, null)}
  />
)}
```

---

## 六、国际化

**修改文件：`packages/client/src/i18n/locales.ts`**

新增翻译键（中/英）：

| Key | 中文 | English |
|-----|------|---------|
| `files.changed` | 变更文件 | Changed Files |
| `files.empty` | 无变更文件 | No changed files |
| `files.loading` | 加载中... | Loading... |
| `files.close` | 关闭预览 | Close preview |
| `files.tooLarge` | 文件过大，无法预览 | File too large to preview |
| `files.loadError` | 加载失败 | Failed to load |

---

## 七、修改/新建文件清单

| 操作 | 路径 |
|------|------|
| 新建 | `packages/server/src/modules/session/file-change.service.ts` |
| 修改 | `packages/server/src/modules/session/session.module.ts` |
| 修改 | `packages/server/src/modules/session/session.controller.ts` |
| 修改 | `packages/server/src/modules/websocket/websocket.gateway.ts` |
| 修改 | `packages/shared/src/types.ts` |
| 修改 | `packages/client/src/store/useAppStore.ts` |
| 新建 | `packages/client/src/components/ChangedFilesList.tsx` |
| 新建 | `packages/client/src/components/FilePreviewPanel.tsx` |
| 修改 | `packages/client/src/components/SessionSummary.tsx` |
| 修改 | `packages/client/src/App.tsx` |
| 修改 | `packages/client/src/i18n/locales.ts` |

---

## 八、验证方式

1. **后端**：完成一个会话（让 AI 修改几个文件），调用 `GET /api/sessions/:id/changed-files`，验证返回正确的增删改列表；尝试 `?path=../../etc/passwd` 应返回 403
2. **前端文件列表**：会话完成后展开 SessionSummary，确认"变更文件"区域出现
3. **代码预览**：点击一个 `.ts` 文件，右侧滑入面板，确认语法高亮正确
4. **HTML 预览**：点击 `.html` 文件，确认 iframe 渲染，无 JS 执行
5. **图片预览**：点击 `.png` 文件，确认图片显示
6. **关闭面板**：点击 × 按钮，面板滑出
