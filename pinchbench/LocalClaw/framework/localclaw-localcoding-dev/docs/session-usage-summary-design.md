# 会话使用摘要功能设计

## 功能概述

每次会话任务完成后，自动统计并展示本次使用了哪些技能（Skills）、读取了哪些记忆文件、调用了哪些 MCP 工具、启动了哪些子智能体等信息，结果持久化到数据库，并在前端以可折叠卡片形式展示。

---

## 数据来源映射

通过解析会话消息流中每条 `assistant` 类型消息的 `content` 数组，提取其中所有 `tool_use` 块并按工具名分类统计。

| 类别 | 判断条件 | 取名方式 | 示例 |
|---|---|---|---|
| **技能（Skills）** | `tool_use.name === "Skill"` | `tool_use.input.skill` | `commit`、`brainstorming` |
| **记忆（Memories）** | `tool_use.name === "Read"` 且 `input.file_path` 包含 `/memory/` 或 `\memory\` | 取路径最后一段文件名 | `user_role.md`、`feedback_testing.md` |
| **MCP 工具** | `tool_use.name` 以 `mcp__` 开头 | 完整工具名 | `mcp__cron-tools__cron_create` |
| **子智能体（Agents）** | `tool_use.name === "Agent"` | `tool_use.input.description` | `Branch ship-readiness audit` |
| **其他工具** | 以上均不匹配 | 工具名本身 | `Bash`、`Grep`、`Read`、`Write` |

### 消息结构示例

```json
{
  "type": "assistant",
  "message": {
    "role": "assistant",
    "content": [
      {
        "type": "tool_use",
        "id": "toolu_01xxx",
        "name": "Skill",
        "input": { "skill": "commit" }
      },
      {
        "type": "tool_use",
        "id": "toolu_02xxx",
        "name": "Read",
        "input": { "file_path": "/home/user/.localclaw/projects/my-proj/memory/user_role.md" }
      }
    ]
  }
}
```

---

## 数据结构

### `UsageSummary` 类型（`shared/src/types.ts`）

```ts
export type UsageSummaryItem = {
  name: string;   // 工具/文件/技能名称
  count: number;  // 调用次数
  detail?: string;
};

export type UsageSummary = {
  skills: UsageSummaryItem[];       // 技能调用
  memories: UsageSummaryItem[];     // 记忆文件读取
  mcpTools: UsageSummaryItem[];     // MCP 工具调用
  agents: UsageSummaryItem[];       // 子智能体启动
  otherTools: Record<string, number>; // 其他工具调用次数
};
```

### 数据库表（`session_usage`）

```sql
CREATE TABLE session_usage (
  session_id TEXT PRIMARY KEY,
  summary    TEXT NOT NULL,     -- JSON 序列化的 UsageSummary
  created_at INTEGER NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);
```

---

## 数据流

```
会话运行中
   │
   ▼ (stream.message 事件)
messages 表 ← 所有消息实时写入
   │
   ▼ (session.status = completed/error)
SessionService.computeAndSaveUsageSummary(sessionId)
   │  读取 messages 表 → 解析 tool_use → 分类统计
   ▼
session_usage 表 ← 存储摘要 JSON
   │
   ▼ (WebSocket 推送)
前端 session.usage 事件 → useAppStore.usageSummary
   │
   ▼
SessionSummary 组件（会话底部可折叠卡片）
```

### 历史会话加载路径

历史会话（重新打开旧会话）通过 HTTP 接口获取摘要：

```
GET /api/sessions/:id/usage
→ { summary: UsageSummary | null }
```

触发时机：`session.history` 事件且 `status === "completed" | "error"` 时，前端自动请求该接口。

---

## 涉及文件

| 文件 | 改动说明 |
|---|---|
| `packages/shared/src/types.ts` | 新增 `UsageSummary`、`UsageSummaryItem` 类型，`ServerEvent` 新增 `session.usage` 事件 |
| `packages/server/src/modules/session/session.service.ts` | 新增 `session_usage` 表、`computeAndSaveUsageSummary()`、`getUsageSummary()` 方法 |
| `packages/server/src/modules/session/session.controller.ts` | 新增 `GET /api/sessions/:id/usage` 端点 |
| `packages/server/src/modules/websocket/websocket.gateway.ts` | 会话完成/错误时触发摘要计算并推送 `session.usage` 事件 |
| `packages/client/src/store/useAppStore.ts` | `SessionView` 新增 `usageSummary` 字段，处理 `session.usage` 和历史加载逻辑 |
| `packages/client/src/i18n/locales.ts` | 新增 `usage.*` 翻译词条 |
| `packages/client/src/components/SessionSummary.tsx` | 新建可折叠摘要卡片组件 |
| `packages/client/src/App.tsx` | 在会话完成后渲染 `SessionSummary` 组件 |
