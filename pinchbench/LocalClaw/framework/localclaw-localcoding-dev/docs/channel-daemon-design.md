# Channel Daemon 设计方案

## Context

当前 channel（飞书/微信/钉钉等）的消息收发依赖 CLI 子进程：每次用户发送 prompt 时启动 CLI（带 `--channels` 参数），CLI 处理完后退出，MCP server 随之关闭。这导致 channel 只在 prompt 处理期间可用，用户打开历史会话或处于空闲状态时，外部平台的消息无法被接收和回复。

## 目标

1. Channel 常驻可用：无论用户是否在操作 UI，外部平台消息都能被接收和回复
2. UI 可见：channel 对话在前端有独立的展示入口，用户可以查看和介入
3. 资源可控：只有一个常驻 CLI 进程，不会随会话数量膨胀
4. 生命周期可管理：自动启动、异常重启、配置变更后重启

## 架构概览

```
┌─────────────────────────────────────────────────────┐
│                   NestJS Backend                     │
│                                                      │
│  ChannelDaemonService (新增)                         │
│  ├─ 管理一个常驻 CLI 子进程 (spawn mode)              │
│  ├─ 持有 RunnerHandle (abort/restart)                │
│  ├─ 将 CLI 输出事件路由到 WebSocket                   │
│  └─ 接收前端用户输入，写入 CLI stdin                   │
│                                                      │
│  CLI 子进程 (常驻)                                    │
│  ├─ --channels server:feishu-channel,...              │
│  ├─ MCP servers (飞书/微信/钉钉) 作为子进程            │
│  └─ Claude 处理 channel 消息并通过 MCP tool 回复       │
│                                                      │
│  WebSocketGateway                                    │
│  ├─ 转发 daemon 事件到前端                            │
│  └─ 转发前端输入到 daemon stdin                       │
└─────────────────────────────────────────────────────┘
         ↕ WebSocket
┌─────────────────────────────────────────────────────┐
│                   Frontend                           │
│  Sidebar: 显示 "Channel" 特殊会话（置顶，特殊图标）    │
│  MainContent: 复用现有消息渲染逻辑展示 daemon 对话     │
│  PromptInput: 用户可在 Channel 会话中输入补充指令      │
└─────────────────────────────────────────────────────┘
```

## 详细设计

### 1. ChannelDaemonService（新增）

**文件**: `packages/server/src/modules/channel/channel-daemon.service.ts`

**职责**: 管理常驻 CLI 进程的完整生命周期。

**核心逻辑**:

- **启动时机**: NestJS 模块初始化时（`OnModuleInit`），检查是否有 enabled 的 channel，有则自动启动 daemon
- **进程启动**: 复用 `RunnerSpawnService` 的 spawn 逻辑，但有以下区别：
  - 不传用户 prompt，发送一条系统初始化消息（如 "You are a channel assistant. Listen for incoming channel messages and respond."）
  - CLI 进程保持运行，不因 `result` 消息退出
  - stdin 保持开放，后续可持续写入用户消息
- **daemon 会话**: 在 SessionService 中创建一个特殊 session（`type: "channel-daemon"`），用于存储 daemon 的消息历史
- **事件路由**: daemon CLI 的 stdout 事件（stream.message、permission.request 等）通过 WebSocketGateway 推送到前端，sessionId 指向 daemon session
- **用户输入**: 前端在 Channel 会话中发送消息时，通过 WebSocket 传到 gateway，gateway 调用 daemon 的 `writeStdin` 将消息注入 CLI
- **进程保活**: 监听子进程 `exit` 事件，非主动停止时自动延迟重启（指数退避，最大 30s）
- **配置变更**: channel 增删或启停时，重启 daemon 进程使新的 `--channels` 参数生效

**接口设计**:

```typescript
class ChannelDaemonService implements OnModuleInit, OnModuleDestroy {
  private child: ChildProcess | null;
  private daemonSessionId: string | null;
  private restartAttempts: number;

  start(): void;           // 启动 daemon CLI 进程
  stop(): void;            // 停止 daemon
  restart(): void;         // 重启（配置变更时调用）
  sendMessage(text: string): void;  // 用户输入写入 stdin
  isRunning(): boolean;
}
```

### 2. Runner 改造

**文件**: `packages/server/src/modules/runner/runner.service.ts`

**改动**: `createRunner` 中去掉 channel 注入逻辑。普通用户会话不再带 `--channels` 参数。

```diff
  async createRunner(options: RunnerOptions) {
-   const channels = this.channelService.getEnabledChannelArgs();
-   if (channels.length) {
-     options = { ...options, channels };
-   }
    ...
  }
```

channel 的职责完全交给 daemon。

### 3. Session 改造

**文件**: `packages/server/src/modules/session/session.service.ts`

**改动**:

- Session 表新增 `type` 字段（`"normal" | "channel-daemon"`），默认 `"normal"`
- `createDaemonSession()` 方法：创建 daemon 专用 session，title 固定为 "Channel"
- `getDaemonSession()` 方法：查询 daemon session（最多一个）
- `listSessions()` 中 daemon session 正常返回，前端通过 type 字段区分展示

### 4. WebSocketGateway 改造

**文件**: `packages/server/src/modules/websocket/websocket.gateway.ts`

**改动**:

- 注入 `ChannelDaemonService`
- 新增事件处理：
  - `channel-daemon.send`：前端在 Channel 会话中发消息 → 调用 `daemonService.sendMessage()`
  - `channel-daemon.status`：前端查询 daemon 状态
- Daemon 的事件输出统一通过现有的 `emit()` → `broadcast()` 推送到前端
- channel 增删/启停后调用 `daemonService.restart()`

### 5. 前端改造

#### 5.1 类型扩展

**文件**: `packages/shared/src/types.ts`

- `SessionInfo` 和 `SessionView` 新增 `type?: "normal" | "channel-daemon"` 字段
- `ClientEvent` 新增 `"channel-daemon.send"` 类型
- `ServerEvent` 新增 `"channel-daemon.status"` 类型

#### 5.2 Sidebar

**文件**: `packages/client/src/components/Sidebar.tsx`

- Daemon session 置顶显示，使用特殊图标（如消息气泡图标）和标签
- 标题显示 "Channel"，副标题显示活跃 channel 数量
- 状态指示器：daemon 运行中显示绿色圆点，停止时灰色

#### 5.3 AppStore

**文件**: `packages/client/src/store/useAppStore.ts`

- `session.list` 事件处理中识别 daemon session（通过 type 字段）
- `channel-daemon.send` 事件：当 activeSession 是 daemon session 时，发送消息走 `channel-daemon.send` 而不是 `session.continue`

#### 5.4 App.tsx / PromptInput

**文件**: `packages/client/src/App.tsx`, `packages/client/src/components/PromptInput.tsx`

- `PromptInput.onSubmit`：判断当前 session type，如果是 `channel-daemon` 则发送 `channel-daemon.send` 事件
- 消息渲染复用现有 MessageCard / EventCard 逻辑，无需额外改动

### 6. Daemon 进程保活与重启

```
启动 daemon → 监听 child.on("exit")
                    ↓
              是否主动停止？
              ├─ 是 → 不重启
              └─ 否 → 延迟重启
                       delay = min(1000 * 2^attempts, 30000)
                       attempts++
                       重新 start()
                       
连续成功运行 60s 后 → attempts 重置为 0
```

### 7. Channel 配置变更联动

用户在 ChannelManager 中：
- 新增/删除/启停 channel → `ChannelService` 更新 DB 和 `~/.localclaw/settings.json`
- `WebSocketGateway` 在处理完 `channel.save` / `channel.delete` / `channel.toggle` 后调用 `daemonService.restart()`
- Daemon 重启时读取最新的 `~/.localclaw/settings.json`，加载新的 MCP server 配置

如果没有任何 enabled 的 channel，daemon 不启动或自动停止。

## 涉及文件清单

| 文件 | 改动类型 |
|------|---------|
| `packages/server/src/modules/channel/channel-daemon.service.ts` | 新增 |
| `packages/server/src/modules/channel/channel.module.ts` | 修改：注册 DaemonService |
| `packages/server/src/modules/runner/runner.service.ts` | 修改：移除 channel 注入 |
| `packages/server/src/modules/session/session.service.ts` | 修改：支持 daemon session |
| `packages/server/src/modules/websocket/websocket.gateway.ts` | 修改：daemon 事件路由 |
| `packages/shared/src/types.ts` | 修改：新增 type 字段和事件类型 |
| `packages/client/src/components/Sidebar.tsx` | 修改：daemon session 置顶 |
| `packages/client/src/store/useAppStore.ts` | 修改：daemon 消息发送逻辑 |
| `packages/client/src/App.tsx` | 修改：daemon session 判断 |
| `packages/client/src/components/PromptInput.tsx` | 修改：daemon 发送走不同事件 |

## 验证方案

1. 启动应用，确认至少一个 channel 启用后 daemon 自动启动
2. 在飞书发消息，确认 daemon CLI 收到通知并回复（日志 + 飞书客户端验证）
3. 前端 Sidebar 可见 "Channel" 会话，点击可看到 channel 对话内容
4. 在 Channel 会话中输入文字，确认消息写入 daemon CLI stdin
5. 禁用所有 channel，确认 daemon 自动停止
6. 重新启用 channel，确认 daemon 自动重启
7. 模拟 daemon 进程崩溃（kill），确认自动重启
8. 普通用户会话不再带 `--channels` 参数（检查 spawn 日志）
