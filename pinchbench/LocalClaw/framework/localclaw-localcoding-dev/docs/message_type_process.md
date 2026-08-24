# SDK 消息类型处理清单

前端 `EventCard.tsx` 对 Claude Agent SDK 所有消息类型的处理方式。

## 消息类型总览

| type | subtype | 处理方式 | 组件/逻辑 |
|------|---------|---------|-----------|
| `system` | `init` | 紧凑横条（模型/时间/目录），可展开详情 | `SystemInfoCard` |
| `system` | `task_progress` | 进度行：旋转图标 + 工具名 + 描述 + 耗时 | 内联渲染 |
| `system` | `compact_boundary` | 静默忽略 | `return null` |
| `system` | `status` | 静默忽略 | `return null` |
| `system` | `hook_response` | 静默忽略 | `return null` |
| `assistant` | text | 无标题，直接渲染 markdown | `AssistantBlockCard` |
| `assistant` | thinking | 默认折叠，点击展开 | `ThinkingBlock` |
| `assistant` | tool_use | 紧凑单行：图标 + 工具名 + 路径/命令 | `ToolUseCard` |
| `assistant` | tool_use (AskUserQuestion) | 问题面板，支持多选/单选 | `AskUserQuestionCard` |
| `assistant` | text (本地模型工具调用) | 紧凑行 + 可展开 JSON 详情 | `LocalModelToolCard` |
| `user` | tool_result | 默认折叠，显示行数 + 预览，可展开 | `ToolResult` |
| `user` | role=user | 右对齐气泡 | `UserMessageCard` |
| `user_prompt` | - | 右对齐气泡（local-claw 自定义类型） | 内联渲染 |
| `stream_event` | - | 静默忽略（流式事件由 App.tsx 处理） | `return null` |
| `tool_progress` | - | 紧凑进度点 + 工具名 + 耗时 | 内联渲染 |
| `auth_status` | - (authenticating) | 旋转图标 + "Authenticating..." | 内联渲染 |
| `auth_status` | - (error) | 错误图标 + 错误信息 | 内联渲染 |
| `result` | `success` | 单行统计条：耗时/API耗时/费用/tokens | `SessionResult` |
| `result` | `error_during_execution` | 同上 | `SessionResult` |
| `result` | `error_max_turns` | 同上 | `SessionResult` |
| `result` | `error_max_budget_usd` | 同上 | `SessionResult` |
| `result` | `error_max_structured_output_retries` | 同上 | `SessionResult` |
| 其他未知 | - | Fallback：显示 JSON 内容 | 内联渲染 |

## SDK 类型定义来源

- `@anthropic-ai/claude-agent-sdk` — `coreTypes.d.ts`
- `packages/shared/src/types.ts` — `StreamMessage` 扩展（含 `user_prompt`）

## 设计原则

- 用户内容（Assistant 文本、用户消息）为主要视觉焦点
- 工具/系统细节为次要信息，默认折叠或紧凑显示
- 参考 Perplexity Computer 交互风格，保持信息层级清晰
