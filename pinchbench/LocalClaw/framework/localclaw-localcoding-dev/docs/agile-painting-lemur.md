# 为 local-claw 增加 spawn 底层通信模式

## Context

当前项目通过 `@anthropic-ai/claude-agent-sdk` 的 `query()` 函数与 Claude Code CLI 通信。`query()` 内部的工作原理是：

1. 使用 `child_process.spawn` 启动 Claude Code CLI 进程
2. 传递 `--output-format stream-json --input-format stream-json` 等参数
3. 通过 stdin/stdout 的 JSON-line 协议通信
4. 在 `ProcessTransport` 类中封装了进程管理、消息读写
5. 在 `Query` 类中封装了控制协议（initialize、permission 等）

用户希望增加一种 **直接 spawn** 的通信模式，绕过 SDK 的 `query()` 封装，直接用 `child_process.spawn` 启动 CLI 进程并通过 stdin/stdout JSON-line 协议通信。这样更底层、更灵活，可以自定义进程管理。

## 实现方案

### 1. 新建配置项 — 编辑 `src/claude-settings.ts`

在环境变量列表中增加 `CLAUDE_RUNNER_MODE`，支持两个值：
- `"query"` (默认) — 使用 SDK 的 `query()` 函数
- `"spawn"` — 直接 spawn CLI 进程

### 2. 新建 spawn runner — 创建 `src/libs/runner-spawn.ts`

直接使用 `child_process.spawn` 启动 Claude Code CLI，实现与 `runner.ts` 相同的 `RunnerHandle` 接口。核心逻辑：

- **启动进程**: `spawn(executable, [pathToClaudeCode, ...args])` ，参数包括 `--output-format stream-json --input-format stream-json --verbose --permission-mode bypassPermissions --allow-dangerously-skip-permissions --include-partial-messages`
- **发送 prompt**: 写入 stdin，格式为 `SDKUserMessage` JSON + 换行
- **读取输出**: 逐行解析 stdout JSON，识别 `SDKMessage`、`SDKControlRequest`（权限请求）等
- **处理权限**: 当收到 `control_request` 中的 `can_use_tool` 时，对 `AskUserQuestion` 走前端审批，其他自动 allow，通过 stdin 写回 `control_response`
- **处理 init**: 发送 `control_response` 回应 `initialize` 请求
- **提取 session_id**: 从 `system.init` 消息中获取
- **中止**: 通过 `process.kill('SIGTERM')` 实现 abort

### 3. 新建统一入口 — 创建 `src/libs/runner-factory.ts`

根据 `CLAUDE_RUNNER_MODE` 配置选择使用 `runClaude`（query 模式）还是 `runClaudeSpawn`（spawn 模式）。

### 4. 更新调用方 — 编辑 `src/index.tsx`

将 `import { runClaude }` 改为从 `runner-factory` 导入。

### 5. 更新类型 — 编辑 `src/types.ts`

在 `ClaudeSettingsEnv` 中增加 `CLAUDE_RUNNER_MODE` 字段。

## 关键文件

| 文件 | 操作 |
|------|------|
| `src/libs/runner-spawn.ts` | 新建 — spawn 模式 runner |
| `src/libs/runner-factory.ts` | 新建 — runner 工厂 |
| `src/claude-settings.ts` | 编辑 — 增加 CLAUDE_RUNNER_MODE |
| `src/types.ts` | 编辑 — 增加类型 |
| `src/index.tsx` | 编辑 — 切换导入源 |

## 验证

1. 默认 `CLAUDE_RUNNER_MODE=query`，行为与当前一致
2. 设置 `CLAUDE_RUNNER_MODE=spawn`，启动项目，创建会话，验证消息流正常
3. 验证权限请求（AskUserQuestion）在两种模式下都能工作
4. 验证 abort/stop 功能在两种模式下都能工作
