# 自动化任务：项目类型 vs 会话类型 设计方案（暂不开发）

> 自动化任务分为两种**本质不同**的类型，执行逻辑与展示都不一样。本文定义两者的
> 区分方式、数据模型、执行流程与 UI 差异。两类并存，互不替换。

## 1. 两种类型定义

### 项目类型（project）—— 已实现的现状
- 绑定一个项目目录（cwd），到点在该目录下执行一段编码/操作类任务。
- 每次执行**新起一段独立会话**（kind=cron，无 resume），重点是"在项目里干活"。
- 展示：消息列表顶部的 `AutomationHeader` 元信息卡片（Automation / ID / Last run + prompt 正文）。
- 适用：定时跑测试、生成报表文件、批处理等"产出物在项目里"的任务。

### 会话类型（conversation）—— 本文新增，对应新版 1.png
- 绑定**一个长期对话**，到点往这个对话里**追加一条消息并续聊（resume）**，
  带着历史上下文继续。
- 展示：同一对话里多条消息累积，每条自动发送的用户消息上方带「🕐 通过自动化发送」徽标，
  **不显示**项目类型那种大卡片。
- 适用：晨间简报、定期提醒、"接着昨天聊"的持续性对话。

## 2. 类型区分：新增 taskType 字段

`packages/sdk/src/capability/scheduled-task/scheduled-task.service.ts` 的 `ScheduledTask`：

```ts
export interface ScheduledTask {
  // ...现有字段...
  /** 任务类型：project=每次独立会话在项目里执行；conversation=绑定长期对话续聊。 */
  taskType?: "project" | "conversation";   // 缺省视为 "project"（兼容存量）
  /** 仅 conversation 类型：绑定的长期会话 id。可在创建时由用户指定（绑到已置顶会话），
   *  或留空 → 首次执行时新建并回填。 */
  boundSessionId?: string;
  /** 仅 conversation 类型：自上次绑定以来的执行轮次，达 30 触发滚动重置（见 §8）。 */
  runsSinceBind?: number;
}
```

- 缺省 / 老数据无该字段 → 按 `project` 处理（存量任务行为完全不变，不提供转换入口）。
- `boundSessionId` 仅 conversation 类型使用。

## 3. 已定决策（2026-06-18）

- **D1 类型如何确定**：
  - 手动创建：「运行环境」下拉 `local`(本地) → **project**；`chat`(对话) → **conversation**。
    （该下拉已存在，见 §7.1。）
  - 聊天创建：用户在输入框下方**选了项目** → project；**没选项目** → conversation。
- **D2 上下文上限**：conversation 续聊上下文过大时，**新起一个会话**并重绑
  `boundSessionId`（滚动重置，见 §8）。阈值用**执行轮次**：任务上存 `runsSinceBind`
  计数器，每次 conversation 执行 +1，达到 **30 轮**即新建会话并归零（旧会话保留在左栏）。
- **D3 存量任务**：一律按 project 处理，不提供"转 conversation"入口。
- **D4 徽标文案（Q3）**：「通过自动化发送」跟随应用语言（中/英）走 i18n，文案固定；
  位置同 1.png（气泡上方）。
- **D5 聊天创建的绑定（Q5）**：conversation 经聊天创建时 `boundSessionId` 留空，
  **首次执行才新建会话**并回填，不在创建时预建空会话。


## 4. 执行流程（runTask 按类型分流）

`ScheduledTaskRunnerService.runTask()` 顶部按 `taskType` 分流；超时/锁/disallowed-tools/
routingOverride 等公共逻辑两类共用。

### 4.1 project 类型（保持现状）
```
session = createSession({ kind:"cron", title:`[定时] ${task.name}`, cwd, routingOverride })
startExecution(...); createRunner({ prompt: CRON_SYSTEM_PREFIX + task.prompt, session, ... })
```
每次都是新 session、无 resume。与现在一致。

### 4.2 conversation 类型（新增，resume）
```
session = task.boundSessionId ? getSession(task.boundSessionId) : undefined
isFirstRun = !session
if (!session):
  session = createSession({ kind:"cron", title:`[定时] ${task.name}`, cwd, routingOverride })
  taskService.update(taskId, { boundSessionId: session.id })   // 绑定

// 追加本次自动消息（带"来源=自动化"标记，见 §5）
recordMessage(session.id, { type:"user_prompt", prompt: task.prompt, source:"automation" })
emit stream.user_prompt(..., source:"automation")

startExecution(taskId, task.name, session.id)
createRunner({
  prompt: CRON_SYSTEM_PREFIX + task.prompt,
  session,
  resumeSessionId: isFirstRun ? undefined : session.claudeSessionId,  // resume 续聊
  extraDisallowedTools: CRON_DISALLOWED_TOOLS,
  onEvent, onSessionUpdate,   // onSessionUpdate 写回 claudeSessionId，保证下次可 resume
})
```
- 发给模型的内容 = `CRON_SYSTEM_PREFIX + task.prompt`（**prompt 原文，不拼元信息头**）。
- resume 原语已存在（`createRunner` 支持 `resumeSessionId`，手动续聊用的就是它）。

## 5. 「通过自动化发送」徽标（会话类型 UI 核心）

### 5.1 数据：user_prompt 标记来源
`UserPromptMessage`（protocol/session-types.ts）增加可选来源标记：
```ts
export type UserPromptMessage = {
  type: "user_prompt";
  prompt: string;
  attachments?: Attachment[];
  source?: "user" | "automation";   // 缺省 user；automation 由 cron 续聊写入
};
```
- `recordMessage` 与 `stream.user_prompt` 事件透传 `source`。
- 前端 `buildThreadMessages.convertUserPrompt` 把 `source` 放进消息 metadata。

### 5.2 展示：UserMessage 顶部徽标
- `UserMessage` 渲染时，若 `source==="automation"`，气泡上方显示「🕐 通过自动化发送」小标
  （时钟图标 + 浅灰文字），样式参考新版 1.png。
- 普通用户消息（source=user / 无）不显示，行为不变。

## 6. UI 差异汇总（按类型）

| 维度 | project | conversation |
|---|---|---|
| 左栏 | 每次执行一个 `[定时]` 会话（多条） | 单个长期会话（一条） |
| 顶部卡片 AutomationHeader | 显示 | **不显示** |
| 消息徽标「通过自动化发送」 | 不显示 | 每条自动消息显示 |
| 续聊上下文 | 无（每次冷启动） | 有（resume 累积） |
| 运行历史点击跳转 | 各跳各自会话 | 多条都跳同一会话 |

实现上：`MessageList` 当前对 `kind==="cron"` 一律挂 `AutomationHeader`；改为仅
`taskType==="project"` 的 cron 会话挂卡片，conversation 类型不挂、改走徽标。

## 7. 创建入口与现状缺口

### 7.1 手动创建（已有 UI，需补后端透传）
- 「运行环境」下拉 `RunEnv` 已存在 `local`/`chat`（`ManualCreateFooter.tsx`）：
  - `local` → 显示 项目+计划+模型 → taskType=**project**，cwd=所选项目。
  - `chat` → 显示 **已置顶会话**(`PinnedConvoDropdown`)+计划 → taskType=**conversation**，
    boundSessionId=所选会话。
- **现状缺口**：`ManualCreateDialog.handleCreate` 在 chat 环境下**没有把所选会话 `convo`
  传给后端**（当前只传 cwd=undefined）。需要：
  - `apiCreateAutomation` 入参增加 `taskType` 与 `boundSessionId`。
  - chat 环境提交时带上 `taskType:"conversation"`、`boundSessionId: convo`。
  - `local` 环境带 `taskType:"project"`。

### 7.2 聊天创建
- 用户在输入框下方选了项目 → project（cron_create 带 cwd + taskType:"project"）。
- 没选项目 → conversation（cron_create 带 taskType:"conversation"，boundSessionId 可空，
  首次执行新建）。
- `CreateMenu` 的 chat/manual 是**创建方式**，与 taskType 正交。

## 8. 边界与风险（仅 conversation 类型）

1. **绑定会话被删除**：`getSession(boundSessionId)` 空 → 当首次执行重新建并重绑（自愈）。
2. **上下文无限增长（D2：滚动重置）**：每次 conversation 执行后 `runsSinceBind+1`；
   达到 **30 轮**时，下次执行新建会话替换 `boundSessionId` 并把计数归零，旧会话保留在
   左栏不动。常量 `CRON_CONV_MAX_RUNS = 30`，后续可调或改可配置。
3. **claudeSessionId 缺失**（首次失败未写回）→ 下次仍当首次跑，不阻塞。
4. **改模型**：conversation 任务改 model 后仍 resume 同一会话，需测 CLI 跨模型 resume 行为。

## 9. 待确认问题

无。D1~D5 已覆盖类型判定、上下文上限(30 轮)、存量任务、徽标文案、聊天创建绑定时机。
开发可按本文进行；§7.1 的后端透传缺口为实现第一步。
