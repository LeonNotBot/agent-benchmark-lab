# 链接点击右侧浏览器预览方案设计

## 概述

当用户在聊天消息中点击 AI 生成的 HTML 页面链接时，不再在系统浏览器中打开，而是在右侧 Workbench 的浏览器标签页（`<webview>`）中加载预览。

## 背景

- 右侧 **Workbench** 已有完整的 `BrowserTab` 组件（基于 Electron `<webview>`）
- 包含 `AddressBar`、前进/后退/刷新功能
- Store 已有 `openWorkbenchTab("browser")` 方法
- 当前 Markdown 中的链接均使用 `target="_blank"` 在系统浏览器中打开
- AI 生成的 HTML 文件位于本地工作目录

## 数据流

```
用户点击 Markdown 中的 HTML 链接
  → 阻止默认行为（不打开系统浏览器）
  → 判断：href 为本地 HTML 文件路径
  → 转为 HTTP 可访问 URL（/api/workspace/serve-file?path=...）
  → 调用 store.openInBrowser(url)
  → store：openWorkbenchTab("browser") + 设置导航 URL
  → BrowserTab 监听 URL 变化 → navigate(url)
  → <webview src="..."> 加载并渲染页面
```

## 修改清单

### 1. Store（uiSlice.ts）

- 新增 `workbenchUrl: string` 字段，默认 `""`
- 新增 `openInBrowser(url: string)` action：
  - 展开右侧面板
  - 打开/切换到 "browser" 标签
  - 设置 `workbenchUrl` 为目标 URL
- 新增 `clearWorkbenchUrl()` action：导航完成后清除，避免重复导航

### 2. BrowserTab（BrowserTab.tsx）

- 从 store 订阅 `workbenchUrl`
- 通过 `useEffect` 监听变化，当有值时调用 `navigate(pendingUrl)`
- 导航后调用 `clearWorkbenchUrl()`

### 3. MarkdownView（thread/messages/MarkdownView.tsx）

- 修改 `<a>` 组件的 `onClick` 逻辑：
  - 若 href 以 `.html`/`.htm` 结尾且不是 HTTP 开头的绝对 URL → 视为本地 HTML 文件
  - 基于当前会话的 `workDir` 解析相对路径
  - 调用 `useAppStore.getState().openInBrowser(url)`
  - `e.preventDefault()` 阻止系统浏览器打开
  - 外部链接保持现有行为

### 4. Markdown 渲染器（render/markdown.tsx）

- 与 MarkdownView 相同逻辑，保持新旧两套渲染器行为一致
- 第 90 行的 `<a>` 组件添加 `onClick` 拦截

### 5. 服务端新增 serve-file 路由

- **Controller**：`GET /api/workspace/serve-file?path=...`
- **逻辑**：读取本地文件 → 根据扩展名设置正确 MIME type → 返回文件内容流
- **安全**：
  - 继承 `isSafePath` 检查，禁止访问系统危险路径
  - 限制文件大小（默认 10MB）
  - 只允许静态文件扩展名（HTML/HTM/CSS/JS/PNG/JPG 等）
- **MIME 类型映射**：`.html` → `text/html`，`.css` → `text/css`，`.js` → `application/javascript`，`.png` → `image/png` 等

### 6. wkdir 解析

- 当前会话的 `workDir` 从 `activeSession?.cwd || activeSession?.generatedFilesDir` 获取
- 链接的相对路径基于此目录解析为绝对路径
- 通过 `Workbench` 组件的 props 传递或直接从 store 获取

## 安全考虑

- `isSafePath` 检查继承现有逻辑，禁止访问系统路径
- MIME 类型白名单：只允许网页内容常用类型
- 文件大小上限 10MB
- `<webview>` 已配置 `partition="persist:webview"` 隔离存储
- 外部 HTTP 链接不受影响，仍走系统浏览器

## 技术细节

- `WebviewHandle` 接口已有 `loadURL(url)` 方法，可直接使用
- `BrowserTab.navigate` 已处理 URL 规范化（`normalizeUrl`）
- 浏览器标签已打开时不重复添加（`openWorkbenchTab` 已处理去重）
- 服务端 `WorkspaceService` 已有 `readFileContent` 和 `readFileBase64` 方法，可复用
