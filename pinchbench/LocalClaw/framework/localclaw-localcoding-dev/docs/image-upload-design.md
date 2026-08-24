# 图片上传与多模态识别

## 概述

在对话输入框中添加图片上传功能，让用户可以附加图片随 prompt 一起发送。图片数据通过完整链路传递到模型，利用 gemma4:e4b 的原生图片理解能力直接处理，无需额外工具调用。

**背景**：用户尝试输入"上传fapiao.png图片，识别提取内容"时，模型因收不到实际图片数据，尝试调用不存在的 `google:analyze_image` 工具报错。

## 数据链路

```
前端: 用户选择图片 → FileReader → base64
  → WebSocket: session.start / session.continue payload 携带 images[]
  → WebSocket Gateway: 传递 images 到 runner
  → Runner Service: 路由决策
    ├─ 本地模型 + 有图片 → RunnerOllamaService: 直接调用 Ollama /api/chat
    └─ 云端模型 / 无图片 → Runner (spawn/query): 通过 CLI 发送
```

> **修正说明**：Claude Code CLI 在 OpenAI 兼容模式（`CLAUDE_CODE_USE_OPENAI=1`）下，
> 不会将 Anthropic 格式的 image content block 转换为 OpenAI 格式，图片会被静默丢弃。
> 因此本地模型 + 图片场景必须绕过 CLI，直接调用 Ollama `/api/chat`。

## 变更清单

### 1. 共享类型 `packages/shared/src/types.ts`

- `session.start` payload 新增 `images?: string[]`（base64 数组）
- `session.continue` payload 新增 `images?: string[]`

### 2. WebSocket 网关 `packages/server/src/modules/websocket/websocket.gateway.ts`

- `onSessionStart` 和 `onSessionContinue` 接收 `images` 参数
- `startRunner` 方法新增 `images` 参数，传递给 `createRunner`

### 3. Runner 类型 `packages/server/src/modules/runner/runner-query.service.ts`

- `RunnerOptions` 新增 `images?: string[]`
- Query 模式：当有图片时，构建 `AsyncIterable<SDKUserMessage>` 替代纯字符串 prompt
- content 数组包含 text block + image blocks（仅云端模型使用此路径）

### 3b. Runner Ollama `packages/server/src/modules/runner/runner-ollama.service.ts`（新增）

当路由决策为**本地模型 + 有图片**时，绕过 CLI 直接调用 Ollama `/api/chat`：

```typescript
// Ollama 原生图片格式（images 字段传 base64 数组）
const body = {
  model: "gemma4:e4b",
  messages: [{ role: "user", content: prompt, images: [base64...] }],
  stream: true,
};
const res = await fetch(`${BASE_URL}/api/chat`, { method: "POST", body: JSON.stringify(body) });
```

**流式输出协议**：
- 发送 `stream_event` 消息驱动前端实时显示（`content_block_start` → `content_block_delta` → `content_block_stop`）
- 流结束后发送完整 `assistant` 消息用于持久化
- 支持 abort 取消

### 3c. Runner Service `packages/server/src/modules/runner/runner.service.ts`

在 `createRunner` 中增加分支判断：

```typescript
// Local model + images: bypass CLI and call Ollama directly
if (decision.target === "local" && options.images?.length) {
  const handle = await this.ollamaService.run(augmentedOptions);
  return { handle, envOverrides };
}
```

### 4. Runner Spawn `packages/server/src/modules/runner/runner-spawn.service.ts`

- `sendUserMessage(child, prompt, images?)` 支持图片
- 当 images 存在时，content 数组中添加 image content blocks（格式同上）

### 5. 前端 Store `packages/client/src/store/useAppStore.ts`

- 新增状态：`attachedImages: string[]`（base64 数组）
- 新增 actions：
  - `addImage(base64)` — 添加图片，最多 4 张
  - `removeImage(index)` — 删除指定位置图片
  - `clearImages()` — 清空所有图片

### 6. 前端 PromptInput `packages/client/src/components/PromptInput.tsx`

**图片选择**：
- `handleImageSelect()` — 创建 file input（accept="image/*", multiple）
- FileReader 读取为 data URL → 提取 base64 部分 → `addImage()`

**UI 布局**：
- 输入框底栏 WorkspaceIndicator 旁添加 `ImageButton` 组件（图片图标）
- 选中图片后，textarea 上方显示缩略图栏（横向滚动）
- 缩略图 48x48px，圆角，右上角 x 删除按钮

**发送逻辑**：
- `usePromptActions` 中将 `attachedImages` 作为 `images` 字段传入 `session.start` / `session.continue` payload
- 发送后自动 `clearImages()`
- 允许仅发送图片（无文字）

**按钮状态**：

| 条件 | 图片按钮 |
|------|---------|
| 已附加 < 4 张 | 可点击 |
| 已附加 4 张 | 禁用（opacity 降低） |

## 关键文件

| 文件 | 职责 |
|------|------|
| `packages/shared/src/types.ts` | 事件类型定义（images 字段） |
| `packages/server/src/modules/websocket/websocket.gateway.ts` | 网关传递 images |
| `packages/server/src/modules/runner/runner.service.ts` | 路由分支：本地+图片走 Ollama 直连 |
| `packages/server/src/modules/runner/runner-ollama.service.ts` | 直接调用 Ollama /api/chat 流式处理图片 |
| `packages/server/src/modules/runner/runner-query.service.ts` | Query 模式构建图片消息（云端） |
| `packages/server/src/modules/runner/runner-spawn.service.ts` | Spawn 模式构建图片消息（云端） |
| `packages/client/src/store/useAppStore.ts` | attachedImages 状态管理 |
| `packages/client/src/components/PromptInput.tsx` | 图片选择 UI + 缩略图预览 |

## 验证清单

1. `node scripts/build-frontend.cjs` 构建成功
2. `node scripts/build-server.cjs` 构建成功
3. 输入框底栏出现图片按钮
4. 选择图片后 textarea 上方出现缩略图预览
5. 点击缩略图 x 按钮可删除
6. 发送包含图片的消息，模型直接处理图片内容（不调用工具）
7. 发送后图片自动清空
8. 最多附加 4 张图片，超过后按钮禁用

## 已知限制

- `media_type` 当前硬编码为 `image/png`，未根据实际格式检测（仅影响云端 CLI 路径）
- 不支持剪贴板粘贴或拖拽上传（仅文件选择器）
- 大图片 base64 编码后体积较大，可能影响 WebSocket 传输性能
- gemma4:e4b 对图片分辨率和复杂度有处理限制
- 本地模型 + 图片走直连 Ollama，不经过 CLI，因此不支持工具调用（仅纯文本回复）
- Claude Code CLI 的 OpenAI 兼容模式不转换 Anthropic 图片格式，本地模型必须走直连路径
