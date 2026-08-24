# claude-cli 权限系统深度研读

> 源码位置：`D:\code\claude-code\src\utils\permissions\`
> 本文基于源码逐行分析，所有引用带 `file:line`，供学习研读。

## 目录

1. [整体架构](#一整体架构)
2. [五种权限模式](#二五种权限模式)
3. [权限判定主流水线](#三权限判定主流水线)
4. [权限规则系统](#四权限规则系统)
5. [auto 模式与 AI 分类器](#五auto-模式与-ai-分类器)
6. [核心设计哲学](#六核心设计哲学)

---

## 一、整体架构

权限系统回答一个问题：**模型要调用某个工具时，允许（allow）/拒绝（deny）/询问用户（ask）？**

三层结构：

```
ToolPermissionContext（不可变上下文：模式 + 规则集）
        ↓
hasPermissionsToUseTool（外层：模式转换、classifier、headless 兜底）
        ↓
hasPermissionsToUseToolInner（内层：8 步规则流水线）
        ↓
PermissionResult { behavior: allow|deny|ask|passthrough }
```

- **模式（Mode）**：全局策略，决定"默认多严格"（default/plan/acceptEdits/bypassPermissions/auto）
- **规则（Rule）**：细粒度覆盖，`Bash(npm:*)` 这类字符串，分 allow/deny/ask
- **判定流水线**：把模式 + 规则 + 工具自检合成最终决策

## 二、五种权限模式

定义于 `types/permissions.ts:15-39`。

```typescript
export const EXTERNAL_PERMISSION_MODES = [
  'acceptEdits', 'bypassPermissions', 'default', 'plan',
] as const
// 内部 = 外部 + auto（ant 专属）
export type InternalPermissionMode = ExternalPermissionMode | 'auto' | 'bubble'
```

| 模式 | 颜色 | 语义 |
|---|---|---|
| `default` | 中性 | 每次写类工具调用都弹确认，最保守 |
| `plan` | 蓝 | 只读规划，禁止写操作，先出计划再执行 |
| `acceptEdits` | 绿 | 自动接受文件编辑，其他工具仍确认 |
| `bypassPermissions` | 红 | 跳过所有权限检查（YOLO），可被组织策略禁用 |
| `auto` | 橙 | 用 AI 分类器自动评估风险；**对外映射回 default**（`PermissionMode.ts:79-85`） |
| `dontAsk` | 红 | 不弹窗，所有 ask 直接转 deny（内部机制，不在切换循环里） |

### Shift+Tab 切换循环

`getNextPermissionMode.ts:1-64`：

```
default → acceptEdits → plan → auto → bypassPermissions → default → ...
                                  ↓（bypass 被策略禁用时）
                                default
```

`bypassPermissions` 是否出现取决于 `isBypassPermissionsModeAvailable`。

### 启动时模式优先级

`permissionSetup.ts:689-811`，`initialPermissionModeFromCLI` 按序取第一个合法值：

1. `--dangerously-skip-permissions` flag → `bypassPermissions`
2. `--permission-mode <mode>` CLI 参数
3. `settings.permissions.defaultMode`
4. 兜底 → `default`

`bypassPermissions` 有二次 gate 检查：GrowthBook `tengu_disable_bypass_permissions_mode` 或本地 `disableBypassPermissionsMode` 任一触发即跳过。

### 模式切换的副作用（transitionPermissionMode）

`permissionSetup.ts:597-646`，所有副作用集中在这一个纯函数：

- **进入 plan**：`prepareContextForPlanMode` 把当前模式存入 `prePlanMode`（退出时恢复）
- **进入 auto**：`setAutoModeActive(true)` + `stripDangerousPermissionsForAutoMode`（剥离会绕过分类器的宽松 allow 规则，暂存到 `strippedDangerousRules`）
- **离开 auto**：`restoreDangerousPermissions`（从暂存恢复规则）

### ToolPermissionContext 核心字段

`types/permissions.ts:428-442`，全部 `readonly`：

| 字段 | 作用 |
|---|---|
| `mode` | 当前活跃模式 |
| `alwaysAllowRules/DenyRules/AskRules` | 按来源分组的规则集 |
| `additionalWorkingDirectories` | `--add-dir` 授权的额外目录 |
| `isBypassPermissionsModeAvailable` | bypass 是否可用（控制切换循环） |
| `strippedDangerousRules` | auto 模式暂存的危险规则，退出时恢复 |
| `prePlanMode` | 进入 plan 前的模式备忘 |
| `shouldAvoidPermissionPrompts` | headless 场景标记，尽量不弹窗 |

## 三、权限判定主流水线

核心函数 `hasPermissionsToUseToolInner`，`permissions.ts:179-1340`。这是整个系统的心脏，8 个步骤按固定顺序执行，命中即返回。

### 流水线总览

```
前置：abort 信号检查
 1a  deny rule（整工具拒绝）        → deny   [bypass-immune]
 1b  ask rule（整工具强制询问）      → ask    [bypass-immune, sandbox 例外]
 1c  tool.checkPermissions()        （工具自检，细粒度）
 1d  tool 返回 deny                 → deny   [bypass-immune]
 1e  requiresUserInteraction + ask  → ask    [bypass-immune]
 1f  内容级 ask rule                → ask    [bypass-immune]
 1g  safetyCheck（敏感路径）         → ask    [bypass-immune]
 2a  shouldBypassPermissions?       → allow  （bypass 短路）
 2b  allow rule（整工具允许）        → allow
 3   passthrough → ask
```

### bypass-immune 是核心设计

步骤 1a–1g 全部位于 2a（bypass 短路）**之前**，意味着即使在 `bypassPermissions` 模式下，这些检查依然执行。这是"YOLO 也有底线"的体现：

| 步骤 | 为什么 bypass 也拦 |
|---|---|
| 1a deny rule | 用户/管理员明确禁止，最高优先级 |
| 1b ask rule | 用户明确要求"始终问我"，显式意图 |
| 1d tool deny | 工具自身的安全判断（如 subcommand deny） |
| 1e requiresUserInteraction | 工具语义上必须有人在场 |
| 1f 内容级 ask rule | 如 `Bash(npm publish:*)`，等同显式意图 |
| 1g safetyCheck | `.git/`、`.claude/`、shell 配置等敏感路径，安全底线 |

### bypass 短路条件

`permissions.ts:1289-1292`：

```typescript
const shouldBypassPermissions =
  mode === 'bypassPermissions' ||
  (mode === 'plan' && isBypassPermissionsModeAvailable)
```

plan 模式也能命中 bypass 的原因：用户原本信任 bypass，进入 plan 只是临时查看，不应突然失去 bypass 能力（`prePlanMode` 记住了来路）。

### safetyCheck 的两级细分

`types/permissions.ts:310-321`，`classifierApprovable` 字段：

- `false`（Windows 路径绕过尝试、跨机器 bridge 消息）：连 auto 分类器都不能批准，硬拦
- `true`（`.claude/`、`.git/`、shell config）：bypass-immune，但 auto 分类器可结合上下文批准

### 外层 hasPermissionsToUseTool 的附加处理

`permissions.ts:473-977`，在 inner 返回 `ask` 后：

- **dontAsk 模式**：所有 ask 转 deny（`permissions.ts:504-515`）
- **auto/plan+autoActive**：走分类器（见第五节）
- **headless（shouldAvoidPermissionPrompts）**：先跑 PermissionRequest hooks，无结论则自动 deny（`permissions.ts:953-973`）

### behavior 与 decisionReason

`behavior` 四种值：`allow` / `deny` / `ask` / `passthrough`（passthrough 仅工具自检可返回，最终会在步骤 3 转 ask）。

`decisionReason.type` 全集：`rule` / `mode` / `subcommandResults` / `permissionPromptTool` / `hook` / `asyncAgent` / `sandboxOverride` / `classifier` / `workingDir` / `safetyCheck` / `other`。

## 四、权限规则系统

### 三种行为与八种来源

行为（`PermissionRule.ts:25-27`）：`allow` / `deny` / `ask`。

来源（`types/permissions.ts:55-63`），按加载顺序：

| source | 文件/出处 | 说明 |
|---|---|---|
| `userSettings` | `~/.claude/settings.json` | 全局用户设置 |
| `projectSettings` | `.claude/settings.json` | 项目共享，提交 git |
| `localSettings` | `.claude/settings.local.json` | 项目本地，gitignore |
| `flagSettings` | `--settings` 传入 | 外部文件，只读 |
| `policySettings` | `managed-settings.json` | 企业远程策略，只读 |
| `cliArg` | `--allow-tools`/`--disallow-tools` | 命令行，仅内存 |
| `command` | `/slash` 注入 | 临时规则，仅内存 |
| `session` | 用户点"Yes, always" | 内存规则 |

企业接管：当 `allowManagedPermissionRulesOnly === true`（`permissionsLoader.ts:121-133`），只加载 `policySettings`，其他全忽略。

### 优先级：两个维度叠加

**维度 A — behavior 类型**：`deny > ask > allow`（`bashPermissions.ts:992-1048` 的判断顺序）。

**维度 B — source 顺序**：后加载叠加，但 A 优先于 B（无论哪个 source 的 deny 都压过 allow）。

### 规则字符串语法

格式 `ToolName` 或 `ToolName(content)`（`permissionRuleParser.ts:93-133`）。

| 规则 | 语义 |
|---|---|
| `Bash` / `Bash()` / `Bash(*)` | 工具级，匹配所有 Bash 调用（三者等价） |
| `Bash(npm install)` | 精确匹配 |
| `Bash(npm:*)` | 前缀匹配（旧语法，词边界） |
| `Bash(git *)` | 通配符匹配（新语法） |
| `mcp__server1__*` | MCP server 级 |

### 三种匹配类型

1. **prefix**（`cmd:*`，`shellRuleMatching.ts:43-48`）：命令等于 prefix 或以 `prefix + " "` 开头
2. **wildcard**（含未转义 `*`，`shellRuleMatching.ts:54-78`）：转成正则匹配
3. **exact**：完全相等

`matchWildcardPattern`（`shellRuleMatching.ts:90-153`）四阶段：转义序列用 `\x00` 哨兵占位 → 转义 regex 特殊字符 → `*`→`.*` 并还原哨兵 → 结尾 ` *` 优化成 `( .*)?`（让 `git *` 既配 `git add` 又配裸 `git`）。

### Bash 的安全攻击面（重点）

Bash 接受任意 shell 命令，等价写法太多，必须先"剥离"无关前缀再匹配。核心是**不对称设计**：

**allow 规则保守**（`stripSafeWrappers`，`bashPermissions.ts:524-615`）：
- 只剥离 `SAFE_ENV_VARS` 白名单内的 env var（绝不含 `PATH`/`LD_PRELOAD`/`PYTHONPATH`/`NODE_OPTIONS` 等能执行代码或加载库的）
- 只剥离 `timeout`/`time`/`nice`/`nohup` 四个 wrapper
- 防 `DOCKER_HOST=evil docker ps` 伪装成无害的 `docker ps` 匹配 allow

**deny 规则激进**（`stripAllLeadingEnvVars`，`bashPermissions.ts:733-776`）：
- 剥离所有 env var，迭代到不动点
- 防 `FOO=bar rm -rf /` 通过加环境变量绕过 deny

**标注的真实漏洞**：
- **HackerOne #3543050**（`bashPermissions.ts:604`）：wrapper 后的 `VAR=val` 在 execvp 语义下是命令不是 env var，Phase 2 不能剥
- **HackerOne 绝对路径绕过**（`bashPermissions.ts:2229`）：deny/ask 必须在 path constraint 检查之前
- **`timeout -k$(id) 10 ls`**（`bashPermissions.ts:542`）：flag 值用 `[^ \t]+` 会匹配 `$(id)`，bash 在 timeout 运行前就展开了——改用严格 allowlist `[A-Za-z0-9_.+-]`

### 持久化

`PermissionUpdate` 五种操作：`addRules`/`removeRules`/`replaceRules`/`setMode`/`add|removeDirectories`。只有 `localSettings`/`userSettings`/`projectSettings` 可持久化（`PermissionUpdate.ts:208-215`），其余仅内存。

## 五、auto 模式与 AI 分类器

auto 模式（YOLO 模式）用一个**独立的 AI 分类器模型**充当"代理审批人"：权限检查返回 `ask` 时，不打断用户，而是把操作发给分类器判断 allow/deny。

`feature('TRANSCRIPT_CLASSIFIER')` 是构建期 flag，外部版本 DCE 裁掉整个分支——**auto 模式在外部版本不存在**。

### 三种模式对比

| 模式 | `ask` 时做什么 |
|---|---|
| default | 暂停，等用户 |
| acceptEdits | CWD 内文件操作自动 allow，其余问用户 |
| auto | 调 AI 分类器决定 |

### classifyYoloAction 工作流程

`yoloClassifier.ts:1020`。发给分类器三层内容：

1. **System prompt**：安全分类规则（allow/deny/environment 三节），外部用 `permissions_external.txt`
2. **CLAUDE.md 消息**：作为独立 user 消息，打 `cache_control` 做稳定缓存前缀
3. **Transcript 投影**：只含用户文本 + 助手 tool_use，**故意排除助手纯文本回复**（`yoloClassifier.ts:350`：助手文本可能被构造来操纵分类器决策）

返回 `{ thinking, shouldBlock, reason }`。解析失败时 fail-closed（`shouldBlock: true`）。新版有两阶段 XML 分类器（stage1 快速 `<block>yes/no</block>`，stage2 带 reasoning）。

### 三条快速路径（跳过昂贵的分类器 API）

1. **safetyCheck 拦截**（`permissions.ts:531-547`）：非 classifierApprovable 的拒绝直接穿透
2. **acceptEdits 模拟**（`permissions.ts:599-654`）：模拟 acceptEdits 模式重跑 checkPermissions，本来就会 allow 的（如编辑 CWD 文件）直接放行。Agent/REPL 例外（REPL 的胶水 JS 可能藏 VM 逃逸）
3. **安全工具白名单**（`classifierDecision.ts:56-98`）：`SAFE_YOLO_ALLOWLISTED_TOOLS`（Read/Grep/Glob/TodoWrite 等只读或元工具）直接 allow

### DANGEROUS_BASH_PATTERNS 的真实用途（澄清误解）

**常见误解**：以为是"危险命令黑名单"，阻止模型执行这些命令。

**实际用途**（`dangerousPatterns.ts:1-12`）：是"**会绕过分类器的 allow 规则前缀识别表**"。像 `Bash(python:*)` 这种规则会让模型通过 python 跑任意代码绕过分类器，所以：
- `isDangerousBashPermission`（`permissionSetup.ts:94`）识别这类规则
- 进入 auto 时 `stripDangerousPermissionsForAutoMode`（`permissionSetup.ts:510`）剥离它们
- 退出时 `restoreDangerousPermissions`（`permissionSetup.ts:561`）恢复

清单含 `python`/`node`/`bash`/`eval`/`sudo`/`ssh` 等解释器和代码执行入口。它管的是"规则",不是"命令本身"。

### DANGEROUS_TYPES（AST 层）

`ast.ts:186-205`。tree-sitter 解析 bash 后，标记"无法静态确定最终命令"的节点类型：`command_substitution`（`$(...)`）、`subshell`、`for/while/if`、`eval` 等。命中则该命令标记为 `tooComplex`，规则匹配失败，升级到用户确认或分类器。真正的安全靠正向白名单，这个集合只是记录已知危险类型。

### denialTracking（防拒绝风暴）

`denialTracking.ts:12-15`：`maxConsecutive: 3`，`maxTotal: 20`。分类器连续拒绝达阈值后：
- 有交互（CLI）：转 `ask`，把原因给用户手动决定
- 无交互（headless）：直接 abort

任意 allow 都重置 `consecutiveDenials`（`totalDenials` 不减）。

### 多重门控（gate）

- **GrowthBook** `tengu_auto_mode_config.enabled`：`enabled`/`disabled`/`opt-in`
- **Circuit breaker**：`disabled` 或用户设置 `disableAutoMode` → 同步阻止进入
- **模型支持检查**：`modelSupportsAutoMode`
- **iron gate**（`tengu_iron_gate_closed`，默认 true）：分类器 API 报错时 fail-closed（拒绝并提示）还是 fail-open（回退正常 ask）

---

## 六、核心设计哲学

1. **模式分级 + 颜色编码**：default→acceptEdits→plan→auto→bypassPermissions，授权从用户控制到 AI 自动逐步升级，风险也逐步升高，UI 颜色（中性/绿/蓝/橙/红）直观传达危险等级。

2. **bypass 也有底线**：8 步流水线里 1a–1g 都是 bypass-immune，deny rule、ask rule、敏感路径（`.git/`/`.claude/`）即使 YOLO 模式也拦。

3. **不对称安全**：allow 规则保守（少剥离，防伪装匹配），deny 规则激进（多剥离，防绕过）。这是 shell 命令权限的精髓。

4. **auto 模式的危险规则隔离**：进入 auto 剥离 `Bash(*)`/`Agent(*)` 等宽松规则防绕过分类器，退出精确恢复——这是 auto 敢称"比 bypass 更安全"的核心。

5. **不可变上下文 + 纯函数变换**：`ToolPermissionContext` 全 `readonly`，副作用集中在 `transitionPermissionMode` 一个中心函数，便于推理测试。

6. **安全事件内联**：代码注释直接引用 HackerOne 编号，让修复意图与代码同在，防止后人误改回退。

7. **分类器防注入**：transcript 投影排除助手纯文本（可能被模型自己构造来操纵审批），只留用户意图和 tool_use 事实。

---

## 对 localclaw 的启示

localclaw 在 SDK 的 `can_use_tool` 层自实现了一套简化权限逻辑（见 `runner-spawn.service.ts`）。对照本文：

- localclaw 的 `CONFIRM_TOOLS_DEFAULT` ≈ CLI 的 default 模式写类工具确认，但**没有** CLI 的规则引擎（allow/deny/ask 字符串匹配）
- localclaw 的 `dangerous-commands.ts` 是自己的危险命令前缀表，**不等于** CLI 的 `DANGEROUS_BASH_PATTERNS`（后者管的是规则不是命令）
- CLI 原生 acceptEdits 会自动放行 Bash 不调 permission-prompt-tool，这是 localclaw 把 acceptEdits 映射为 default 传给 CLI、再自实现语义的根本原因
- 若要接入 CLI 完整规则引擎（路径 B），需移植 `shellRuleMatching` + `bashPermissions` + `bash/ast`（约 4000 行 + tree-sitter），成本很高


