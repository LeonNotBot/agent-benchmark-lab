# 项目层（Project Layer）调研报告 + 设计方案

> 状态：调研完成（已据 claude-cli 源码与实际落盘修订），待落地
> 日期：2026-06-17（v2：核验 D:\code\claude-code 源码 + ~/.localclaw 实际目录后重写）
> 范围：让"项目"成为真实、可沉淀的中间层，为项目记忆打底座

> **v2 关键修订（一手源码推翻了 v1 的两条核心结论）**：
> 1. **CLI 原生支持 `--append-system-prompt`，且可走 stdin 动态传**（`print.ts:4591` 注释"from stdin to avoid ARG_MAX"）。v1"连系统提示注入口都没有"只对 localclaw 封装层成立，对 CLI 本身是错的。
> 2. **CLI 自带按项目维度的 auto-memory 系统，且已在本机运行落盘**：`<base>/projects/<sanitized-git-root>/memory/`（`memdir/paths.ts:223 getAutoMemPath`）。本仓库记忆已存在于 `~/.localclaw/projects/D--lenovo-code-localclaw/memory/`。这就是要找的"项目记忆底座"——它已存在，只是 localclaw 未接管、未在 UI 暴露。
> 3. 澄清：`~/.localclaw/projects/<cwd>/*.jsonl` 是 CLI 的**会话 transcript**（`--resume` 数据源），`memory/` 子目录才是项目记忆。

## 背景与目标

当前 composer 下方的 "Project" 选择，逻辑上仍是 session（会话）维度的东西，不是一个真正的"项目"层。后果是：后续想引入项目记忆，没有可依附的中间层。

目标：

- 用户能围绕项目组织工作，而非一堆零散对话；
- 项目知识 / 约定 / 背景能沉淀在项目里，AI 在该项目下"懂行"而非每次空降；
- 为后续项目记忆打下能长出来的底座。

核心判断：**全局 → 项目 → 会话** 是一条上下文优先级链，"项目层"正是当前缺失的中间层。

## 前提（已逐条验证）

| 前提 | 结论 |
|---|---|
| 模型无状态，"项目"只活在每轮组装的上下文里 | ✅ 证实 |
| 只能走 CLI 认的通道（cwd/CLAUDE.md/env/args）影响上下文 | ⚠️ 部分修正：通道比 v1 想的**更多**——CLI 原生支持 `--append-system-prompt`（可走 stdin），且自带项目级 auto-memory |
| 旗舰收敛到"项目根 markdown + 层级加载" | ✅ 证实（CLI 本身就是 Claude Code，机制内建） |
| 正解是分层而非全量常驻 | ✅ 证实必要性 |

## 第一部分：调研结论

### ① 现状：今天的 "project" 是什么 —— 伪项目层（证实）

**判定：当前 project = 前端 localStorage 里的一个目录路径字符串（+ 可选别名/置顶/隐藏），后端零 project 概念。** "它其实就是 session 维度"的判断完全成立。

- 前端：`registeredProjects` / `projectAliases` / `projectPins` 全在 `sidebarSlice.ts:55-76`，纯 zustand + `localStorage`（键 `lc:registeredProjects` 等，`storageKeys.ts:24-28`），无任何后端调用。
- 后端：数据库只有 `sessions / messages / settings / session_usage` 四张表（`database.migrations.ts:84-143`），**没有 projects 表**；`Session` 类型无 projectId，只有一列 `cwd` 文本（`session.service.ts:45-55`）；业务迁移数组为空。
- 分组：侧边栏"项目分组"是前端 `groupSessions.ts:47-60` 拿 `session.cwd === registeredProject路径` **字符串等值匹配**现算的视图。
- 添加项目："使用现有文件夹"纯前端登记；"新建空白项目"后端只 `mkdir` 一个真实目录（`workspace.service.ts:711-731`），**不写库**；"不使用项目"只把前端 `defaultWorkspace` 置空。

> **铁证：删掉浏览器 localStorage，所有"项目"立即消失，但会话和它们的 cwd 在后端 sqlite 里纹丝不动。** 项目没有独立身份、生命周期、配置或知识。

### ② 注入通道与生效时机 —— 命门

进程是**长驻复用**：每 session 一个 CLI 进程，Map 缓存，跨轮复用（`runner-spawn.service.ts:316`），靠 fingerprint `{cwd, envHash, permissionMode, directEnvHash}` 判定复用还是销毁重建（`:272-285, 386-417`）。另有 **prewarm 预热**：进程在用户发首条消息前就 spawn，停在 init 就绪态等 stdin（`:690`、`:682`），不发任何 stdin（`runner-prewarm.spec.ts:68`）——这不阻碍 stdin 注入，知识随首条 user message 发即可。

对**复用中的进程**，各通道能否动态更新：

| 通道 | 生效时机 | 复用进程内能否动态更新 |
|---|---|---|
| **stdin（user message 正文）** | 每轮写入 `sendUserMessage:1073` → `buildPromptWithAttachments`（`attachment-context.ts:40`）→ `writeStdin:1099` | ✅ 每轮可动态注入 |
| **stdin（`appendSystemPrompt`，CLI 原生支持）** | CLI `initialize` 控制请求时从 stdin 读（`print.ts:4591-4596`）；免 ARG_MAX | ✅ CLI 支持，但 **localclaw 当前未使用**（封装层 grep 零命中）；属 spawn/init 期注入，非每轮 |
| cwd | spawn 时固定 | ❌ 锁死（改了触发销毁重建） |
| env（含模型/网关配置） | spawn 时一次性构造 | ❌ 锁死（子进程 env 不可变；改了须杀进程重启） |
| `CLAUDE_CONFIG_DIR` 下 settings/CLAUDE.md/.claude.json | spawn 前落盘，启动时读 | ⚠️ 文件可改，但复用进程不重读 |
| cwd 下的 CLAUDE.md（项目知识） | 首次 spawn 时由 `prepareSessionCwd` 写 | ⚠️ 半可行：CLI 会读，但运行中改是否重读不可靠 |
| **CLI 项目级 auto-memory**（`<base>/projects/<git-root>/memory/`） | CLI 每会话自动读写（`memdir/paths.ts`，默认启用） | ✅ CLI 自管，已在本机运行（见下文 ⑤） |

> **修正后的核心结论**：要让"项目知识"注入且能动态更新，有**两条可靠通道**：
> 1. **stdin user message 正文**——每轮可注入，最灵活，绕开"复用进程不重读文件"（参考 `buildPromptWithAttachments` 拼附件的现成做法）；
> 2. **stdin `appendSystemPrompt`**——CLI 原生、免 ARG_MAX，但属 init 期注入，localclaw 需新增使用。
>
> v1 所谓"唯一通道是 prompt 正文""无系统提示注入口"是把 localclaw 封装层的现状当成了 CLI 的能力边界——**实为封装层未用，非 CLI 不支持**。

### ⑤ 决定性发现：CLI 自带项目级 auto-memory，且已在运行

claude-cli 内建一套按项目维度的持久记忆系统，**默认启用**（`isAutoMemoryEnabled()` `memdir/paths.ts:30`，可经 `CLAUDE_CODE_DISABLE_AUTO_MEMORY` / settings `autoMemoryEnabled` 关闭）。

- **落盘位置**：`getAutoMemPath()` = `<base>/projects/<sanitized-git-root>/memory/`，base 默认 `CLAUDE_CONFIG_DIR`（本应用 = `~/.localclaw`）。项目键按 **git root**（`memdir/paths.ts`），同一仓库多会话天然共享同一记忆目录。
- **已实证落盘**：本仓库记忆现存于 `~/.localclaw/projects/D--lenovo-code-localclaw/memory/`，含 `MEMORY.md`(索引) + 分类记忆文件（user/feedback/project/reference）——即本会话 system-reminder 加载的那份。
- **配套能力**：`memdir/`、`services/SessionMemory/`、`services/extractMemories/`（每轮结束后台抽取）、`skills/bundled/remember.ts`、`commands/memory/`。记忆还会被 CLI 自动拼进系统提示（`prompts.ts` memory section）。
- **路径可重定向**：`CLAUDE_COWORK_MEMORY_PATH_OVERRIDE`（env，绝对路径）或 settings `autoMemoryDirectory`（支持 `~/` 展开）——可把"项目记忆"指向我们自定义的、与 UI 项目实体对齐的目录。

> **含义**：所谓"项目记忆底座"**已经存在并在跑**。localclaw 当前既没接管它（grep 零命中，用默认行为），也没在 UI 暴露。设计的重心应从"从零造记忆层"转为"**接管 + 对齐 + 暴露** CLI 现成的 auto-memory"。

### ③ 为什么现状沉淀不了项目知识 —— 卡点（修订）

修订认知：**记忆"底座"其实已存在（CLI auto-memory，见 ⑤），真正缺的是"应用层把它接管、对齐到项目实体、并暴露给用户"。** 卡点是：

1. **没有项目实体可对齐**：项目只是前端 localStorage 的一个字符串，无 id、无后端记录。CLI 记忆按 git-root 自动分目录，但应用层没有一个"项目"对象与之绑定/映射。
2. **记忆键与用户心智的项目不一致**：CLI 用 git-root 当项目键——非 git 目录、或同仓多目录场景，记忆归属可能不符用户预期；且用户无法在 UI 里看到/编辑/控制这份记忆。
3. **没有用户可控的注入纽带**：记忆是 CLI 自动抽取的，用户无法主动"补充项目知识/约定/背景"并确保下次注入；`prepareSessionCwd` 写的只是固定任务路由块，且仅 Smart Hybrid 激活时、仅首次 spawn 写一次。
4. **不跨端、不可见**：localStorage 项目状态换设备即失；CLI 记忆躺在本地文件里，UI 完全不暴露。

→ 缺的不是"记忆存储"，而是"全局 → 项目 → 会话"链条里那个**有 id、能持久、能与 CLI 记忆对齐、能让用户读写、能在会话启动时把知识送进上下文的项目中间层**。

### ④ 旗舰怎么解 —— 对照

| 维度 | Claude Code (CLAUDE.md) | Codex (AGENTS.md) |
|---|---|---|
| 知识载体 | markdown 文件 | markdown 文件 |
| 层级 | enterprise → user → project root → 子目录 → local | global → root → nested 子目录 |
| 叠加规则 | 层层加载，就近覆盖 | 离被改文件最近的胜；用户对话指令覆盖一切 |
| 加载时机 | 会话起始加载，**每轮重发** | 任务时按目录树就近读取 |

**借鉴**：markdown 载体（人可读、可 git、迁移友好）、分层就近覆盖、显式区分层级。**警惕**：CLAUDE.md "每轮重发"导致文件一大就成 token 税且 context rot —— 印证"分层而非全量常驻"。

## 第二部分：设计方案

### 设计原则（v2 修订）

**不从零造记忆层，而是建立"项目实体"并接管 / 对齐 CLI 现成的 auto-memory，再叠加一层用户可控的项目知识，通过 stdin 注入。** 项目成为有 id 的后端实体，是 CLI 记忆目录与用户可读写知识的锚点。

### 方案抉择：自造记忆 vs 复用 CLI auto-memory

| | A. 自造（v1 思路） | B. 复用 + 接管 CLI auto-memory（v2 推荐） |
|---|---|---|
| 记忆存储 | 新建表/文件，自实现抽取与注入 | 复用 CLI `<base>/projects/<key>/memory/`，已自动抽取 |
| 注入 | 自己拼进 prompt | CLI 自动拼进系统提示；用户知识另经 stdin 补 |
| 工作量 | 大（重造轮子） | 小（对齐 + 暴露） |
| 风险 | 与 CLI 记忆重复/打架 | 依赖 CLI 行为，需用 env/settings 驯服记忆键 |
| 取舍 | — | **推荐**：CLI 记忆已在跑，自造等于和它抢同一上下文 |

推荐 B：项目实体负责"把 CLI 记忆键对齐到用户心智的项目 + 暴露读写 + 叠加用户主动补充的知识"。

### 决策轴

**1. 注入走哪条通道**
- CLI auto-memory：**让 CLI 自管**（自动抽取 + 自动拼系统提示），我们只通过 `CLAUDE_COWORK_MEMORY_PATH_OVERRIDE` / settings `autoMemoryDirectory` 把记忆目录**对齐到项目实体**（解决 git-root 键不符心智的问题）。注意：env 进 fingerprint，改它触发冷 spawn——所以记忆目录在**建会话时按项目定好**，会话内不变。
- 用户主动补充的项目知识：**走 stdin user message 正文**（每轮可注入、最灵活）；或 **stdin `appendSystemPrompt`**（init 期注入，更"系统级"）。首选正文方案，落地最快。
- cwd 下 CLAUDE.md：作冷启动兜底（对齐旗舰，`--resume` 时 CLI 自读）。
- 放弃：把知识塞 env（锁死 + 触发重建）。

**2. push / pull 边界与常驻预算**
- push（常驻）：① CLI auto-memory（CLI 自控预算）；② 用户项目知识"宪法"（技术栈/约定/背景），硬预算 **≤ 800 tokens**，超出截断提示精简。
- pull（按需）：大块知识（架构细节、历史决策、API 文档）不常驻，按需检索（P3）。
- 判据：**"几乎每轮都要用"→ push；"特定任务才要"→ pull**。警惕与 CLI 记忆叠加后的总预算膨胀（context rot）。

**3. "项目"由什么构成，如何映射 harness**
- 后端新增 `projects` 表：`id / name / root_path / memory_dir / created_at / updated_at`（`memory_dir` = 对齐后的 CLI 记忆目录）。
- 用户项目知识：**markdown 文件 + 表存指针**（如项目记忆目录下 `knowledge.md` 或项目内 `.localclaw/knowledge.md`），人可读、可 git、迁移友好。
- `sessions` 表加 `project_id` 外键（可空，null = "不使用项目"）。
- harness 映射：建会话时按 `project_id` → 解析 `memory_dir` → 注入 env（对齐 CLI 记忆）+ 把用户知识拼进首轮 stdin。

**4. 全局/项目/会话三层如何叠加覆盖**
- 优先级**就近覆盖**：全局（user 级约定）< 项目 < 会话内显式指令。
- 注入顺序：全局摘要 → 项目知识 →（会话内用户指令天然最后、最高优先级）。
- 与现有 `CLAUDE_CONFIG_DIR` 全局 CLAUDE.md 不冲突：那层继续管全局语言约束，项目层叠在其上。

**5. 知识更新何时生效**
- 用户项目知识：写后端 + 落 markdown → 下一个**新会话**或**当前会话下一轮**经 stdin 注入即生效，不需杀进程。
- CLI auto-memory：CLI 在会话内自动抽取/读写；记忆目录（env）在会话内固定，跨会话生效。
- 即时性靠 stdin 知识块保证；CLI 记忆走 CLI 自身节奏。

**6. 老数据平滑迁移**
- 一次性迁移：读前端 `localStorage.registeredProjects` + `projectAliases` + `projectPins` → 后端 `projects` 表建实体。
- 回填：每个已存在 session 按 `cwd === project.root_path` 匹配，回填 `session.project_id`。
- **记忆目录对齐**：迁移时为每个项目计算/绑定 `memory_dir`。注意 CLI 已有记忆按 git-root 落在 `~/.localclaw/projects/<sanitized-git-root>/memory/`——迁移要么沿用该键（零搬运），要么搬到项目对齐目录（需迁文件）。**P0 先沿用 CLI 默认键，不搬运**，降低风险。
- localStorage 保留一轮兜底，迁移完成标记后以后端为准。
- cwd 为空的散会话 → `project_id = null`，继续走"对话"分组。

**7. 组件影响**
- 后端：新增 migration（projects 表 + sessions.project_id）、ProjectService（CRUD + 知识读写 + memory_dir 解析）、session 创建关联 project 并注入记忆目录 env。
- 注入层：`runner-spawn` 的 `sendUserMessage`（`:1073`）/ `buildPromptWithAttachments`（`attachment-context.ts:40`）处增加"项目知识块"；spawn env 增加 `CLAUDE_COWORK_MEMORY_PATH_OVERRIDE`（若选择对齐目录）。**注意需新增"首轮判定"**——复用路径（`:544`）与冷启动路径（`:662/:866`）共用 `sendUserMessage`，无现成首轮标志，需在 ProcessEntry 加 `injectedKnowledge` 标记。
- 前端：`ProjectPicker` 接后端、`groupSessions` 改用 `project_id`、新增"项目知识"编辑入口、迁移逻辑。

**8. 阶段拆分**
- P0 最小闭环：projects 表 + session.project_id + 用户知识存储 + stdin 首轮注入 + （可选）记忆目录对齐，用 API/脚本验证闭环。
- P1 迁移：localStorage → 后端，session 回填。
- P2 前端：ProjectPicker 接后端、分组改 project_id、知识编辑 UI、暴露 CLI 记忆只读视图。
- P3 进阶：pull 检索、层级子目录知识、记忆目录搬运对齐、预算可视化。

### 推荐与取舍

推荐 P0 走"后端项目实体 + 用户知识 markdown + stdin 首轮注入 + 沿用 CLI 默认记忆键"。
- 取：不和 CLI auto-memory 抢轮子、即时生效（stdin）、迁移零搬运最稳、对齐旗舰 markdown 载体。
- 舍：P0 不做记忆目录搬运（沿用 CLI 默认键）、不做 `appendSystemPrompt` 通道（先用正文）、不做 pull 检索、不追求活进程重读文件。

## 第三部分：实现子任务清单

### P0 — 最小闭环（后端 + 注入）

1. DB migration：新增 `projects` 表（id/name/root_path/memory_dir/时间戳）；`sessions` 加 `project_id` 列（nullable）。
2. `ProjectService`：create / get / list / update / rename / remove + 用户知识读写（markdown + 表存指针）+ `memory_dir` 解析（P0 沿用 CLI 默认 git-root 键）。
3. 会话创建关联：`createSession` 接受并写入 `project_id`；`cwd` 可由 project.root_path 派生。
4. **注入纽带**：`runner-spawn` 的 `sendUserMessage:1073` / `buildPromptWithAttachments`（`attachment-context.ts:40`）处，首轮 user message 前置"项目知识块"（≤800 token 截断）。**需新增首轮判定**：ProcessEntry 加 `injectedKnowledge` 标记（复用/冷启动共用 `sendUserMessage`，无现成首轮标志）。
5. （可选）记忆目录对齐：建会话时按项目注入 `CLAUDE_COWORK_MEMORY_PATH_OVERRIDE`——P0 可跳过，先验证 CLI 默认记忆 + stdin 知识块即可。
6. P0 验证：建项目 → 补知识 → 问"只有读过才答对"的问题 → 答对 → 更新知识 → 新会话/下轮反映最新 → 重启进程后仍在；并确认 CLI auto-memory 已在该项目目录沉淀。

### P1 — 迁移

7. 迁移器：`localStorage.registeredProjects/aliases/pins` → `projects` 表（一次性，幂等）。
8. session 回填：`cwd === root_path` 匹配回填 `project_id`；空 cwd 保持 null。

### P2 — 前端

9. `ProjectPicker` / 新建项目改接后端 API（替代纯 localStorage 写）。
10. `groupSessions` 改用 `session.project_id` 归组（替代 cwd 字符串匹配），保留 cwd 兜底过渡。
11. 项目知识编辑 UI（项目 ··· 菜单加"项目知识/记忆"入口）+ CLI 记忆只读视图。

### P3 — 进阶（可选）

12. pull 式知识检索（大块知识按需召回，不常驻）。
13. 记忆目录搬运对齐（git-root 键 → 项目对齐目录）+ `appendSystemPrompt` 通道 + 层级/子目录知识 + 常驻预算可视化。

## 验收标准（最小闭环）

新建项目 → 补充项目知识 → 在该项目下提一个"只有读过才答得对"的问题，AI 答对 → 更新知识后再问，反映最新 → 重启后项目 / 知识 / 会话归属仍在、老数据完成迁移。

## 关键证据文件索引

### localclaw 封装层
- `packages/client/src/sidebar/store/sidebarSlice.ts:55-76` — 前端项目状态（全 localStorage）
- `packages/client/src/store/storageKeys.ts:24-28` — 本地存储键
- `packages/client/src/sidebar/groupSessions.ts:47-60` — cwd 字符串匹配分组
- `packages/sdk/src/database/database.migrations.ts:84-143` — schema：只有 sessions，cwd 是普通列
- `packages/server/src/modules/database/database.migrations.ts:18-24` — 业务迁移为空，无 project 表
- `packages/sdk/src/core/session/session.service.ts:45-55, 212-254, 284-293` — Session 无 project 字段
- `packages/client/src/thread/ProjectPicker.tsx:36-78` — 添加/不使用项目逻辑（仅前端登记）
- `packages/sdk/src/capability/runner/runner-spawn.service.ts:316, 272-285, 386-417` — 进程复用缓存 + fingerprint
- `packages/sdk/src/capability/runner/runner-spawn.service.ts:690, 682` + `__tests__/runner-prewarm.spec.ts:68` — prewarm 预热（不发 stdin）
- `packages/sdk/src/capability/runner/runner-spawn.service.ts:1073-1105`（sendUserMessage）+ `packages/sdk/src/util/attachment-context.ts:40`（buildPromptWithAttachments）— **真实 stdin 注入点**（v1 误标 :748，已更正）
- localclaw 全仓 grep `appendSystemPrompt|DISABLE_AUTO_MEMORY|COWORK_MEMORY_PATH` — **零命中**（未用 CLI 这些能力）

### claude-cli 源码（D:\code\claude-code，即被包装的 CLI）
- `src/cli/print.ts:4591-4596` — `systemPrompt`/`appendSystemPrompt` 可从 stdin 传（免 ARG_MAX）
- `src/main.tsx:1290-1299` — CLI 暴露 `--system-prompt` / `--append-system-prompt`(-file) 选项
- `src/memdir/paths.ts:30 isAutoMemoryEnabled / :223 getAutoMemPath / :85 getMemoryBaseDir` — 项目级 auto-memory，默认启用，路径 `<base>/projects/<git-root>/memory/`
- `src/memdir/paths.ts:161 getAutoMemPathOverride`（`CLAUDE_COWORK_MEMORY_PATH_OVERRIDE`）/ `:179 getAutoMemPathSetting`（settings `autoMemoryDirectory`）— 记忆目录可重定向
- `src/services/extractMemories/`、`src/services/SessionMemory/`、`src/skills/bundled/remember.ts`、`src/commands/memory/` — 配套记忆能力

### 实际落盘（~/.localclaw）
- `~/.localclaw/projects/D--lenovo-code-localclaw/memory/`（MEMORY.md + 分类记忆）— **本仓库项目记忆已存在并运行**
- `~/.localclaw/projects/<cwd>/*.jsonl` — 会话 transcript（`--resume` 数据源），非记忆
- `~/.localclaw/CLAUDE.md` — 全局 CLAUDE.md（语言约束等）

## 参考

- [AGENTS.md 官方格式说明](https://agents.md)
- [Claude Code 内存机制（社区整理）](https://medium.com/@debaditya.chakravorty/6-simple-techniques-to-reduce-claude-code-token-cost-28f37425a123)
- [CLAUDE.md/AGENTS.md/Copilot 配置指南](https://www.deployhq.com/blog/ai-coding-config-files-guide)
- [Scoping Rules: Global/Project/Path-Glob](https://medium.com/@tacoda/scoping-rules-global-project-path-glob-e2eea5d52f5e)



