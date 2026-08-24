# 设计文档：用 GolemBot 替换 Local Claw IM 通道

**日期**：2026-05-26
**状态**：已确认，待实施
**决策路径**：路线 1 — 深度集成（In-process 嵌入 SDK）

---

## 1. 背景与目标

Local Claw 现有 IM 通道（飞书、钉钉、Telegram、Discord）通过 5 个自研 MCP server（stdio 长轮询）实现。目标：
- 接入 GolemBot SDK，用其成熟的 channel adapter 替代自研 MCP server
- 用户在 ChannelManager UI 配置 IM → 手机 IM 发指令 → Local Claw Claude Code 执行
- Local Claw 保留 ClaudeRunner、会话管理、UI，不被 GolemBot 接管
- wechat（个人微信）保留 legacy 方案（不接入 GolemBot）

---

## 2. 整体架构

### 2.1 数据流

```
[飞书/钉钉/Telegram/Discord/企业微信]
           ↓ onMessage(ChannelMessage)
      FeishuAdapter / TelegramAdapter / ...
           ↓
      handleMessage(msg, config, localClawAssistant, adapter)
           ↓
      localClawAssistant.chat(text)
           ↓
      Local Claw ClaudeRunner (已有 SSE 会话逻辑)
           ↓ streaming SSE
      handleMessage 调用 adapter.typing() / adapter.reply()
           ↓
      [IM 消息: typing indicator → Claude 回复]
```

### 2.2 关键设计原则

- Local Claw Agent（大脑）不换，GolemBot 只做 IM 网关（身体）
- 每个 IM chat_id 独占一个常驻 session，绑定固定工作目录
- 同一 channel 下不同 chat_id 可绑定不同 workspaceDir
- wechat 走 legacy 路径，不参与 GolemBot

### 2.3 GolemBot SDK 导出确认

- `ChannelAdapter` 接口：`golembot` 主入口导出
- `FeishuAdapter`、`TelegramAdapter`、`DiscordAdapter`、`DingtalkAdapter`、`WecomAdapter`：从 `golembot/dist/channels/*.js` 深度导入（dist 子路径，.d.ts 声明存在，视为稳定 API）
- `handleMessage(msg, config, assistant, adapter, ...)`：从 `golembot/dist/gateway.js` 导出，完整封装 group 路由、@mention 解析、消息分片、typing 反馈
- `startGateway()`：**不使用**，避免引入独立 HTTP 进程和 dashboard

---

## 3. 数据模型

### 3.1 ChannelConfig 扩字段

`packages/shared/src/channel-types.ts`：

```typescript
export type ChannelEngine = "golembot" | "legacy";

export type ChannelConfig = {
  // ... 现有字段不变 ...
  engine?: ChannelEngine;     // 默认 "golembot"
  workspaceDir?: string;       // chat_id 首次发消息时的默认工作目录
};
```

### 3.2 数据库

`channels` 表新增列：
```sql
ALTER TABLE channels ADD COLUMN engine TEXT DEFAULT 'golembot';
ALTER TABLE channels ADD COLUMN workspace_dir TEXT DEFAULT '';
```

### 3.3 chat_sessions 表

```sql
CREATE TABLE IF NOT EXISTS chat_sessions (
  chat_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  workspace_dir TEXT NOT NULL,
  session_key TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (chat_id, channel_id)
);
```

---

## 4. 核心组件

### 4.1 文件清单

| 操作 | 文件 |
|------|------|
| **新增** | `packages/server/src/modules/channel/golem-channel-manager.ts` |
| **新增** | `packages/server/src/modules/channel/local-claw-assistant.ts` |
| **新增** | `packages/server/src/modules/channel/chat-session.service.ts` |
| **新增** | `packages/server/src/modules/channel/migration.ts` |
| **修改** | `packages/shared/src/channel-types.ts` |
| **修改** | `packages/server/src/modules/channel/channel.service.ts` |
| **修改** | `packages/server/src/modules/channel/channel-rest.controller.ts` |
| **修改** | `packages/client/src/components/ChannelManager.tsx` |
| **修改** | `packages/client/src/store/slices/channelSlice.ts` |
| **删除** | `feishu/telegram/discord/dingtalk-channel-server.mjs`（wechat 保留） |

### 4.2 GolemChannelManager

全局单例，持有所有已启动 adapter 实例。

**职责**：
- `onModuleInit()`：加载所有 `engine = "golembot"` 且 `enabled = true` 的 channel，按类型 `new` adapter 并调用 `start(onMessage)`
- `saveChannel()`：新建/更新时同步 adapter（增/改/停）
- `deleteChannel()` / `toggleChannel()`：对应 adapter 启停
- `getAdapter(type)`：按 channel type 返回 adapter 实例

### 4.3 LocalClawAssistant

实现 GolemBot `Assistant` 接口子集，桥接到 Local Claw ClaudeRunner。

**`chat()` 核心逻辑**：
```typescript
async *chat(
  message: string,
  opts?: { sessionKey?: string; images?: ImageAttachment[]; files?: FileAttachment[] }
): AsyncIterable<StreamEvent> {
  const sessionKey = opts?.sessionKey ?? this.resolveOrCreateSession(msg);
  // 1. 把 images/files 保存到临时磁盘路径
  // 2. 调用 Local Claw ClaudeRunner.startSession(sessionKey, workspaceDir, message, attachments)
  // 3. for await (const event of stream) yield event
}
```

### 4.4 ChatSessionService

管理 chat_id → workspaceDir 映射，惰性创建 session。

**核心方法**：
- `resolveSession(chatId, channelId, text)`：查找已有 session 或创建新 session（首次 `/bind` 或默认 workspaceDir）
- `bindWorkspace(chatId, channelId, workspaceDir)`：用户在 IM 里发 `/bind /path/to/project` 时调用
- `getWorkspaceDir(chatId, channelId)`：返回该 chat 绑定的工作目录

### 4.5 handleMessage 调用点

```typescript
async function onIMMessage(msg: ChannelMessage) {
  const channel = chatSessionService.resolveChannel(msg.chatId, msg.channelType);
  const assistant = localClawAssistant; // 单例
  const adapter = golemChannelManager.getAdapter(channel.type)!;
  await handleMessage(msg, golemConfig, assistant, adapter, channel.type, verbose, dir);
}
```

`golemConfig` 从 `readLocalClawSettings()` 中 `settings` 读取（用于 group/maxTurns 等策略），`dir` 指向 `~/.localclaw`。

---

## 5. typing + 最终汇总策略

- `handleMessage` 内部调用 `adapter.typing()` 提供即时反馈
- stream 结束后，wrapper 检测是否有实质输出 → 调用 `adapter.reply()` 发送最终汇总
- 出错时调用 `adapter.reply()` 发送错误信息

---

## 6. 迁移脚本

`migration.ts` 为一次性迁移：

1. 读取 SQLite `channels` 表所有非 `wechat` 的记录
2. 对每条记录：更新 `engine = "golembot"`，保留原 `credentials`（字段名与 GolemBot config 一致）
3. `workspaceDir` 设为 `""`，用户可在 IM 里用 `/bind` 动态绑定
4. wechat 记录：`engine = "legacy"`，跳过 GolemBot 初始化
5. 迁移入口：`POST /api/channel/migrate`

---

## 7. 前端改动

**ChannelManager UI**：
- 添加 channel 时，表单新增两个字段：
  - `Engine`：下拉选 `golembot`（默认）/ `legacy`（仅 wechat）
  - `工作目录`：文本框，输入绝对路径（默认留空 = 用户动态绑定）
- wechat 类型只能选 `legacy`

**现有 REST API**：无需变化（API 操作 SQLite，`ChannelConfig` 扩字段对 API 透明）。

---

## 8. WeChat（个人微信）保留策略

`ChannelService` 内加分支：
- `engine = "legacy"`：走旧 .mjs 逻辑（保留），不参与 GolemBot 初始化
- `engine = "golembot"`：走 GolemChannelManager 内存管理

---

## 9. 错误处理

- **Adapter 断连**：每个 adapter `try/catch`，失败时 `updateStatus(id, "error", errMsg)`，ChannelManager UI 实时显示
- **ClaudeRunner 崩溃**：`LocalClawAssistant.chat()` 捕获异常，发送错误信息给用户
- **并发限制**：超过 `maxConcurrent` 时回复"排队中，请稍候"

---

## 10. 关键设计决策汇总

| # | 问题 | 选择 |
|---|------|------|
| 1 | GolemBot 与 Agent 关系 | Local Claw 接管 Agent，GolemBot 只做 IM 网关 |
| 2 | 部署形态 | In-process 嵌入 SDK |
| 3 | 会话策略 | 每 chat_id 独占常驻 session + 固定工作目录 |
| 4 | 工作目录绑定层级 | Channel + chat_id 两级绑定 |
| 5 | 输出回写方式 | 混合模式（typing 反馈 + 完成后汇总） |
| 6 | 旧 MCP server 处理 | 全部删除 + 迁移脚本 |
| 7 | WeChat 处理 | 保留 legacy，其余走 GolemBot |
| 8 | 飞书专属链接 | 不做特殊处理 |
