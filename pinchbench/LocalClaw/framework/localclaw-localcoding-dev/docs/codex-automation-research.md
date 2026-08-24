# Codex 自动化（Automations）功能调研报告

> 调研日期：2026-06-15（已据 OpenAI 官方文档原文校正）
> 对象：OpenAI Codex App 的「自动化 / Automations」能力
> 参考界面：`docs/images/1.png`（Codex 桌面端「自动化」入口）
> 主要依据：[Automations – Codex app 官方文档](https://developers.openai.com/codex/app/automations/)（已成功抓取原文）

## 目录

1. [一句话结论](#1-一句话结论)
2. [图1 界面解读](#2-图1-界面解读)
3. [核心功能清单](#3-核心功能清单)
4. [技术原理](#4-技术原理)
5. [安全与可控性机制](#5-安全与可控性机制)
6. [典型使用场景](#6-典型使用场景)
7. [对 LocalClaw 的启发](#7-对-localclaw-的启发)
8. [参考资料](#8-参考资料)

---

## 1. 一句话结论

Codex 的「自动化」把原本「人发起一次 → Agent 跑一次」的交互，升级为「**按计划 / 按需自动触发 → Agent 在后台执行 → 有价值的结果进入 Triage 收件箱，无事则自动归档**」的循环。本质是 **调度器（含 cron 自定义） + 沙箱化 Agent 运行环境 + Triage 收件箱（人在回路验收）** 三者的组合。

核心理念的转变：从「等你回来问我进展」变成「**到点了我自己去做，有发现才进收件箱提醒你，没事就悄悄归档**」。开发者的角色从「写每一行代码的人」逐渐变为「**描述任务、设定约束、审查结果的操作者（operator）**」。

> ⚠️ 关键澄清（官方文档明确）：**Codex App 的自动化运行在本地机器的后台**，并非纯云端服务。对 project 级自动化，要求「运行 Codex App 的机器处于开机状态、Codex 正在运行、且所选项目仍在磁盘上」时才会按计划执行。（这与 Codex 的另一形态「云端任务」不同；本报告聚焦图1 所示的 Codex App 自动化。）

---

## 2. 图1 界面解读

图1 是 Codex 桌面端的「自动化」页面（侧边栏 `自动化` 入口），处于「尚未创建任何自动化」的空状态，可见以下要素：

- **左侧导航**：快速对话、搜索、插件、**自动化**（当前选中）、Codex 移动版；下方是「置顶 / 项目 / 对话」的会话与项目列表（CoPaw、test-1、feigao1 等项目）。
- **页面标题区**：「自动化 — 按计划或按需运行聊天。」配「了解更多」链接。一句话点明了两种触发模式：**按计划（scheduled）** 与 **按需（on-demand）**。
- **右上角创建入口**：「查看模板」+「通过聊天创建 ▾」下拉，含两个选项：
  - **通过聊天创建**：用自然语言对话描述要自动化的任务，由 Codex 帮你生成自动化配置。
  - **手动创建**：手动填写指令、调度周期等字段。
- **空状态引导**：一个时钟图标 +「创建首个自动化」，并给出三个预置模板按钮：
  - **每日简报（Daily Briefing）**
  - **每周回顾（Weekly Review）**
  - **项目监控（Project Monitoring）**

> 这几个模板正好对应自动化最高频的三类用途：定时汇总、周期复盘、持续监控——都是「读多写少、产出报告」型任务，与下文「安全的自动化模式」相印证。

---

## 3. 核心功能清单

| 功能 | 说明（依据官方文档） |
|------|------|
| **三种自动化类型** | Standalone（独立）、Project（项目级）、Thread（线程级）——见 3.1 |
| **两种触发方式** | ① 按计划（每日/每周等预设，或自定义 cron 表达式）；② 在常规对话里按需创建/触发 |
| **自定义 cron** | 需要特殊节奏时可「choose a custom schedule and enter cron syntax」，直接填 cron |
| **自然语言创建/修改** | 可在普通对话里描述任务+节奏，让 Codex 起草自动化 prompt、选类型、后续按需更新 |
| **Skill 可创建自动化** | 不只是被自动化调用——一个 Skill 本身可以去创建/更新自动化（如「看护 PR」的 skill 设置一个周期检查 PR 状态的自动化） |
| **绑定技能（Skills）** | 自动化可用 Codex 现有的全部插件与 Skill；用 `$skill-name` 在 prompt 里显式触发某 Skill |
| **Triage 收件箱** | 有发现的运行进 Triage（即 inbox），可筛「全部/仅未读」；无可报告内容则自动归档 |
| **运行位置可选** | Git 仓库下每个自动化可选「在本地项目里跑」或「在专用后台 worktree 里跑」；非版本控制项目直接在目录里跑 |
| **模型/推理力度可选** | 可用默认模型与 reasoning effort，也可显式指定以更精细控制 |
| **沙箱权限** | 沿用你的默认沙箱设置：read-only / workspace-write / full access，配合 rules 白名单 |
| **一个自动化跨多项目** | 同一个自动化可在多个项目上运行 |

### 3.1 三种自动化类型（官方区分）

| 类型 | 含义 | 何时用 |
|------|------|--------|
| **Standalone（独立）** | 按计划发起**全新**的运行，结果报告进 Triage | 每次运行相互独立、或要跨一个/多个项目运行时 |
| **Project（项目级）** | 绑定到某项目运行（要求机器开机、Codex 在跑、项目在磁盘上） | 针对某个项目周期性检查 |
| **Thread（线程级）** | **心跳式**的定时唤醒，附着在**当前对话线程**上，保留上下文 | 需要 Codex 回到同一对话继续推进时（见下） |

**Thread automations（线程自动化）细节**：
- 是「附着在当前线程的、心跳式重复唤醒」，每次唤醒**保留线程上下文**，而非每次从新 prompt 开始。
- 支持**分钟级间隔**（用于活跃的跟进轮询循环），也支持每日/每周定点签到。
- 典型用途：盯一个长跑命令直到结束；轮询 Slack/GitHub 等连接源且结果要留在同一线程；按固定节奏提醒 Codex 继续 review 循环；跑用插件的 skill 工作流（如检查 PR 状态并处理新反馈）；让一个对话持续聚焦某项研究/分诊任务。
- 官方建议：创建线程自动化时 prompt 要「durable（耐久）」——说清每次唤醒该做什么、如何判断有没有值得上报的东西、何时停止或回头问你。

> 与社区文章的差异更正：社区把验收环节叫「Review Queue / `review_queue: true`」，官方实际术语是 **Triage 收件箱**，且「无可报告内容则自动归档」是官方明确行为。

### Skills 与 Automations 的区别

| 维度 | Skills（技能） | Automations（自动化） |
|------|---------------|----------------------|
| 本质 | 可复用的工作流模式（指令+脚本+上下文） | 带调度的后台任务 |
| 何时用 | 同一类任务、不同上下文反复用 | 周期性、需定时跑的任务 |
| 关系 | 可被自动化引用（`$skill-name`），也能反过来创建/更新自动化 | 用 Skill 定义动作、提供工具与上下文，以便可维护、可团队共享 |
| 例子 | 「按我们的配置部署到 Vercel」 | 「每天产出某目录近 24h 的 commit 简报」 |

---

## 4. 技术原理

整体可拆为四层：**调度层 → 任务定义层 → 执行层（本地后台沙箱 Agent / worktree）→ 验收层（Triage 收件箱）**。

### 4.1 调度层（Scheduler）

- 提供预设节奏（每日/每周等），需要特殊节奏时**可填自定义 cron 表达式**（官方原文：choose a custom schedule and enter cron syntax）。
- Thread 类型还支持**分钟级间隔**做活跃跟进循环。
- 触发后由本地 Codex App 在后台拉起一次 Agent 运行；也可在对话中按需创建/触发。
- 调度运行的前提（project 级）：**机器开机 + Codex App 在运行 + 项目仍在磁盘上**。

### 4.2 任务定义层（Prompt + Skills）

一个自动化 = **指令 prompt + 类型(standalone/project/thread) + 调度 + 运行位置(local/worktree) + 沙箱权限 + 可选 Skill/插件**。

- **prompt** 是自然语言指令，描述「到点做什么、如何判断有无可上报内容、何时停止或回头问你」（线程自动化尤其要求 prompt「耐久」）。
- **skills**：用 `$skill-name` 在 prompt 中显式触发；用 Skill 承载动作定义+工具+上下文，使自动化可维护、可跨团队共享。
- 创建方式：① 在普通对话里用自然语言让 Codex 起草；② 由 Skill 程序化创建/更新；③ 图1 的模板与「手动创建」。

> 注：社区文章流传的 `.codex/automations/*.yaml`（含 `schedule/instructions/skills/review_queue` 字段）与 `config.toml`（`read_only/allowed_commands/elevated_permissions`）属于**第三方还原/示意**，官方文档未给出这种声明式文件 schema。官方明确的可配置项是：类型、调度(可 cron)、运行位置(local/worktree)、模型与 reasoning effort、沙箱模式、rules 白名单。下面保留社区示例**仅作概念示意**，勿当作官方配置格式。

<details>
<summary>社区还原的声明式配置示例（非官方格式，仅示意）</summary>

```yaml
# 第三方博客还原，非 OpenAI 官方 schema
schedule: "*/15 * * * *"
instructions: |
  Run npm test and npm run lint; summarize failures.
skills:
  - test-runner
review_queue: true   # 官方对应概念是 Triage 收件箱
```
</details>

### 4.3 执行层（本地后台沙箱 Agent / worktree）

- 自动化**在本地机器后台运行**（不是云端离线托管）。Git 仓库下每个自动化可选两种运行位置：
  - **local 模式**：直接在你的主 checkout 上工作——**可能改动你正在编辑的文件**。
  - **worktree 模式**：在专用后台 git worktree 上跑，把自动化改动与你未完成的本地工作隔离开。频繁调度会累积大量 worktree，需归档不再需要的运行、谨慎 pin。
  - 非版本控制项目：直接在项目目录里跑。
- **沙箱权限**沿用默认设置，三档（官方原文）：
  - `read-only`：需要改文件/联网/操作本机 App 的工具调用都会失败。
  - `workspace-write`：可改工作区内文件；改工作区外文件/联网/操作 App 会失败；可用 **rules 白名单**放行特定命令到沙箱外。
  - `full access`：后台自动化**风险高**，Codex 可不经询问改文件、跑命令、联网；官方建议改回 workspace-write 并用 rules 精细放行。
- **审批策略**：组织策略允许时，自动化使用 `approval_policy = "never"`（无人值守不弹审批）；若管理员通过 `requirements.toml` 禁止 `approval_policy = "never"`，则回退到所选模式的审批行为。企业管理员可限制可用沙箱模式等。
- 模型与 reasoning effort 可用默认或显式指定。

### 4.4 验收层（Triage 收件箱，人在回路）

- 所有自动化及其历次运行集中在 Codex App 侧边栏的 **automations 面板**。
- **Triage 区 = 收件箱**：有发现（findings）的运行出现在这里，可筛「全部运行 / 仅未读」。
- **无可报告内容 → 自动归档**（automatically archives），不打扰你。
- 这一层把 Agent 的自主性与人的最终控制权解耦——你只在「有事」时被打断。

### 4.5 数据流（一次自动化运行）

```
[到点(可cron) / 对话中按需触发]
      ↓  （project级需：机器开机 + Codex在跑 + 项目在磁盘）
[本地 Codex App 后台拉起] → [加载 prompt + 类型 + skills + 沙箱/审批策略]
      ↓
[选运行位置] —— local(改主checkout) 或 worktree(隔离) 或 项目目录
      ↓
[沙箱 Agent 执行] —— 按 read-only / workspace-write / full access 受限
      ↓                  （approval_policy=never 时不弹审批）
   有发现? ──否──→ [自动归档]
      │是
      ↓
[进 Triage 收件箱(可筛未读)] → [人验收 / 继续推进]
```

---

## 5. 安全与可控性机制

### 5.1 官方权限与安全模型

自动化**无人值守运行**，沿用你的默认沙箱设置，三档行为（官方原文）：

- **read-only**：要改文件 / 联网 / 操作本机 App 的工具调用都会失败——最安全，适合纯汇总分诊。
- **workspace-write**：能改工作区内文件；改工作区外、联网、操作 App 会失败；可用 **rules** 选择性放行特定命令到沙箱外。官方对自动化的推荐基线。
- **full access**：后台自动化**风险显著升高**，Codex 可不经询问改文件、跑命令、联网；官方建议改回 workspace-write 并用 rules 精细放行。
- **审批策略**：策略允许时用 `approval_policy = "never"`；管理员可经 `requirements.toml` 禁止该值或限制可用沙箱模式，此时回退到所选模式的审批行为。

### 5.2 官方建议的实践

1. **先在普通对话里手动测试 prompt**，确认：prompt 清晰且范围正确；模型/推理力度/工具行为符合预期；产出的 diff 可审。
2. **头几次运行逐一复核**：开始排程后，review 前几次输出，按需调整 prompt 或节奏。
3. **用 worktree 隔离**有写操作的自动化，避免动到你正在编辑的文件。
4. **worktree 清理**：频繁调度会累积大量 worktree，及时归档不再需要的运行，非必要不要 pin（pin 会保留其 worktree）。
5. **用 Skill 固化动作**：让自动化可维护、跨团队共享，并减少多次运行间的漂移。

### 5.3 社区实测补充（第三方经验，非官方）

某实测者连跑三周真实仓库总结的模式 **Schedule → Run → Triage**：从只读任务起步、最小权限、在「写生产/main、花钱的外部 API 调用、新自动化前几次运行」处设人工审查闸门。其观察：既见过生成干净报告的自动化，也见过试图删整个目录的——差别就在审批闸门设没设对地方。

---

## 6. 典型使用场景

### 6.1 官方文档给出的示例 prompt

- **自动创建/优化技能**：扫描过去一天的 `~/.codex/sessions` 文件，若发现某些 skill 用得不顺就改进它（仅个人 skill，不动仓库 skill）；若有高频且吃力、值得沉淀为 skill 的操作就沉淀；有改动则告知。
- **项目动态简报**：查看最新 `origin/master`/`origin/main`，对触及 `<某目录>` 的最近 24h commit 产出一份高管简报——要求富 Markdown（H1 按工作流分组、斜体副标题、分隔线）、按工作流叙事而非逐条列 commit、内联 PR 链接、按人分点并加粗人名。

### 6.2 高频用途归纳（结合图1 模板与社区实践）

| 场景 | 描述 | 适配类型/沙箱 |
|------|------|--------------|
| **每日简报 / 每周回顾** | 定时汇总目录近 24h/一周进展，产出结构化简报 | standalone + read-only |
| **项目监控** | 持续盯仓库/issue，有发现进 Triage，无事自动归档 | project + read-only |
| **看护 PR** | 周期检查 PR 状态（GitHub 插件），处理新的 review 反馈 | thread + workspace-write |
| **盯长跑命令** | 在同一线程里反复唤醒，直到某命令/部署完成 | thread（分钟级） |
| **轮询连接源** | 轮询 Slack/GitHub，结果留在同一对话上下文 | thread |
| **自维护技能** | 定期回看会话、沉淀/优化个人 skill | standalone |

通用规律：**只读汇总/分诊** 最适合 standalone+read-only；**需保留上下文、持续跟进** 用 thread；**有写操作** 优先 worktree 隔离 + workspace-write。

---

## 7. 对 LocalClaw 的启发

LocalClaw 已有定时任务体系（MCP `cron_*` 工具 + `scheduled_tasks.json`），对照 Codex 官方设计有几点值得借鉴：

1. **「Triage 收件箱 + 无事自动归档」**：当前定时任务多是「触发即执行/直接产生副作用」。可借鉴 Codex——运行结果先进一个收件箱，**有发现才提醒、无事自动归档**，尤其针对写文件、发飞书消息这类有外部副作用的无人值守任务，避免噪声与不可逆影响。
2. **沙箱三档 + rules 白名单**：把任务按 `read-only / workspace-write / full access` 分级，配命令白名单，与本项目「安全护栏按可逆性分级」理念一致；无人值守任务默认应偏向 read-only/workspace-write。
3. **运行位置隔离（worktree）**：有写操作的定时任务在独立 git worktree 跑，避免动到用户正在编辑的文件——这是 LocalClaw 当前缺的隔离维度。
4. **线程级「心跳自动化」**：Codex 的 thread automation 能在**保留对话上下文**的前提下分钟级唤醒，对应 LocalClaw 里「盯长跑任务/轮询飞书消息并留在同一会话」的场景，比无状态 cron 更自然。
5. **自然语言创建 + 让 Skill 反向创建自动化**：图1 的「通过聊天创建」「手动创建」「模板」三入口，以及「Skill 可以去创建/更新自动化」的能力，是降低上手门槛、让自动化可编排的好范式。
6. **无人值守的审批回退**：Codex 用 `approval_policy=never` 但允许管理员经 `requirements.toml` 强制收紧。LocalClaw 的定时任务也应有「默认不弹审批、但可被策略强制要求审批」的回退机制。

---

## 8. 参考资料

- **[Automations – Codex app（OpenAI 官方文档，本报告主依据，已抓取原文）](https://developers.openai.com/codex/app/automations/)** — 三种自动化类型、Triage 收件箱、worktree、沙箱三档、approval_policy、官方示例 prompt 均出自此页。
- [Codex App Skills & Automations: Safe Setup & Examples 2026（Macaron，第三方实测）](https://macaron.im/en/blog/codex-app-skills-automations)
- [ChatGPT Codex Automations + Gmail Plugin（MindStudio，调度+插件组合实操）](https://www.mindstudio.ai/blog/chatgpt-codex-automations-gmail-plugin-scheduled-tasks)
- [Scheduled Task Automation with Codex（Developer Toolkit）](https://developertoolkit.ai/en/codex/lessons/automation/)
- [What Is Codex app Automation? How It Differs from Notifications（Smartscope）](http://smartscope.blog/en/generative-ai/chatgpt/codex-app-automation-guide/)
- [How I'm using OpenAI Codex automations to improve my code（Substack）](https://substack.com/home/post/p-188714826)

> 校正说明：本版已据 OpenAI 官方文档原文重写关键事实。需特别注意两处与社区文章的出入——① 验收环节官方术语是 **Triage 收件箱**（有发现才进、无事自动归档），社区所称 `review_queue` 字段并非官方 schema；② Codex App 自动化**在本地机器后台运行**（需机器开机、Codex 在跑、项目在磁盘），并非纯云端托管。社区流传的 `.codex/automations/*.yaml` 与 `config.toml` 字段为第三方还原，仅作概念示意。


---

