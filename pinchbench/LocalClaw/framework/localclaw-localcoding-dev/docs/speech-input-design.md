# 语音输入功能设计方案

## 概述

在对话输入框中添加语音输入功能（类似豆包）。默认显示麦克风按钮，点击后录音并通过 WebSocket 传输到后端，后端调用本地 Ollama gemma4:e4b 模型进行语音识别，将文字返回前端填入输入框。

**关键技术点**：Ollama 的 `/api/chat` 通过 `images` 字段传递音频（WAV 16kHz 单声道 base64），通过 RIFF 魔数自动区分图片/音频。gemma4:e4b 内置约 300M 参数的音频编码器，原生支持音频理解，单次最长 60 秒。

## 架构

```
浏览器 AudioContext → WAV 16kHz mono → base64 → JSON WebSocket
  → 后端 WebSocket Gateway → SpeechService → Ollama /api/chat (gemma4:e4b)
  → 识别文字 → WebSocket 返回前端 → 填入 textarea
```

## 变更清单

### 1. 共享类型 `packages/shared/src/types.ts`

- ClientEvent 新增: `{ type: "speech.recognize"; payload: { audio: string } }` (base64 WAV)
- ServerEvent 新增:
  - `{ type: "speech.result"; payload: { text: string } }`
  - `{ type: "speech.error"; payload: { message: string } }`

### 2. 后端语音服务 `packages/server/src/modules/speech/speech.service.ts`

- `SpeechService` 注入 `OllamaService`
- `recognize(audioBase64: string): Promise<string>` 方法:
  - 确保 Ollama 运行 (`ollamaService.ensureRunning()`)
  - POST `http://localhost:11434/api/chat`:
    ```json
    {
      "model": "gemma4:e4b",
      "messages": [{
        "role": "user",
        "content": "请将这段语音转录为文字，只输出转录内容，不要加任何解释或标点说明。",
        "images": ["<base64_wav>"]
      }],
      "stream": false
    }
    ```
  - 返回 `response.message.content`

### 3. 后端语音模块 `packages/server/src/modules/speech/speech.module.ts`

- 导入 `RoutingModule`（获取 OllamaService）
- 导出 `SpeechService`

### 4. 注册模块 `packages/server/src/app.module.ts`

- imports 数组添加 `SpeechModule`

### 5. WebSocket 网关 `packages/server/src/modules/websocket/websocket.gateway.ts`

- 注入 `SpeechService`
- `handleClientEvent` switch 新增 `case "speech.recognize"` 分支
- 调用 `speechService.recognize(payload.audio)` 后 emit `speech.result` 或 `speech.error`

### 6. WebSocket 模块 `packages/server/src/modules/websocket/websocket.module.ts`

- imports 添加 `SpeechModule`

### 7. 前端录音 hook `packages/client/src/hooks/useAudioRecorder.ts`

- 封装浏览器音频录制 API
- `startRecording()`: 请求麦克风权限，创建 AudioContext (16kHz)，通过 ScriptProcessorNode 采集 PCM 数据
- `stopRecording()`: 停止录音，合并 Float32 PCM → 降采样至 16kHz → 编码 WAV (RIFF header + 16-bit PCM) → base64
- 状态: `idle | recording | processing`
- 最长录音 55 秒自动停止（留 5 秒余量）

### 8. 前端 PromptInput `packages/client/src/components/PromptInput.tsx`

按钮逻辑：

| 条件 | 按钮样式 |
|------|---------|
| 输入框为空 + 空闲 | 麦克风图标 |
| 输入框为空 + 录音中 | 波浪动画 + 红色脉冲（点击停止） |
| 输入框为空 + 识别中 | 旋转加载动画（禁用） |
| 输入框有文字 | 发送按钮 |
| 会话运行中 | 停止按钮 |

录音流程：
1. 点击麦克风 → `startRecording()`，浏览器弹出权限请求
2. 录音中显示波浪动画
3. 点击停止 → `stopRecording()` → 获取 base64 WAV
4. 通过 `sendEvent({ type: "speech.recognize", payload: { audio } })` 发送
5. 按钮变为 loading 状态，等待后端返回

### 9. 前端 Store `packages/client/src/store/useAppStore.ts`

- 新增状态: `speechStatus: "idle" | "recording" | "processing"`
- 新增 action: `setSpeechStatus`
- `handleServerEvent` 新增:
  - `speech.result`: 将识别文字追加到 prompt，重置 speechStatus 为 idle
  - `speech.error`: 重置 speechStatus 为 idle

### 10. App.tsx 事件处理

- `onEvent` 回调中处理 `speech.error`，通过 Toast 提示用户

### 11. i18n `packages/client/src/i18n/locales.ts`

| Key | 中文 | English |
|-----|------|---------|
| `speech.recording` | 录音中... | Recording... |
| `speech.processing` | 识别中... | Recognizing... |
| `speech.error` | 语音识别失败 | Speech recognition failed |
| `speech.maxDuration` | 已达最大录音时长 | Max recording duration reached |

### 12. CSS 动画 `packages/client/src/index.css`

- `.voice-wave` 容器 + 3 个 `<span>` 子元素
- `@keyframes voice-wave`: 3 条竖线高低交替动画，错开 0.15s

## 关键文件

| 文件 | 职责 |
|------|------|
| `packages/shared/src/types.ts` | WebSocket 事件类型定义 |
| `packages/server/src/modules/speech/speech.service.ts` | 核心语音识别逻辑 |
| `packages/server/src/modules/speech/speech.module.ts` | NestJS 模块 |
| `packages/server/src/modules/websocket/websocket.gateway.ts` | 网关路由分发 |
| `packages/client/src/hooks/useAudioRecorder.ts` | 浏览器录音封装 |
| `packages/client/src/components/PromptInput.tsx` | UI 交互 |
| `packages/client/src/store/useAppStore.ts` | 状态管理 |

## 验证清单

1. `node scripts/build-frontend.cjs` 构建成功
2. `node scripts/build-server.cjs` 后端构建成功
3. 输入框为空时显示麦克风按钮
4. 输入文字后麦克风变为发送按钮
5. 点击麦克风 → 浏览器弹出权限请求 → 显示波浪动画
6. 点击停止 → 音频发送到后端 → 后端调用 Ollama → 文字返回输入框
7. 录音超过 55 秒自动停止
8. 语音识别失败时弹出 Toast 错误提示

## 已知限制

- WebSocket 断连时若正处于 `processing` 状态，按钮可能卡在加载中，需刷新页面恢复
- gemma4:e4b 单次音频最长 60 秒，hook 设置 55 秒自动截断
- 依赖本地 Ollama 服务运行，且需已安装 gemma4:e4b 模型
