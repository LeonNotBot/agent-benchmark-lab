# 微信IM机器人语言不一致问题分析报告

## 一、问题概述

**问题描述**：机器人在回复用户时，正文内容为中文，但询问用户下一步操作的提示（如 "Would you like me to continue?"）显示为英文。

**已确认事实**：
- 个人使用环境中该问题已修复且运行正常（所有回复均为中文）
- 其他用户使用时问题依然存在
- 核心表现：正文中文 + 操作提示英文

---

## 二、根本原因分析

### 2.1 架构理解

Channel 模式的消息处理链路如下：

```
微信消息 → GolemBot (handleMessage) → ChannelAssistant → RunnerService
         → RunnerSpawnService (spawn CLI) → Claude CLI
```

### 2.2 根因定位

通过代码分析，发现**存在两套独立的 CLAUDE.md 系统**：

#### 1. `~/.localclaw/CLAUDE.md`（LocalClaw 专属配置目录）
- 位置：`~/.localclaw/CLAUDE.md`
- 由 `TechStackRegistrarService` 管理
- 内容包含：
  - 定时任务规则（中文）
  - 技术栈约束（中文）
  - **无语言指令**

#### 2. `~/.claude/CLAUDE.md`（Claude CLI 全局配置）
- 位置：`~/.claude/CLAUDE.md`
- 包含用户个人设置：
  ```markdown
  - 使用中文与我交互
  - 新建文件时不要超过100行...
  ```
- **这是"个人环境正常"的关键**！

### 2.3 核心问题：隔离目录导致配置丢失

`ensureClaudeConfigDir()` 确保 LocalClaw spawn 的 CLI 使用 `~/.localclaw` 而非 `~/.claude`：

```typescript:packages/sdk/src/capability/runner/claude-config-dir.ts
export function ensureClaudeConfigDir(): string {
  const dir = getClaudeConfigDir(); // 返回 ~/.localclaw
  // ...确保目录和 settings.json 存在
}
```

但 `TechStackRegistrarService` 只写入 `~/.localclaw/CLAUDE.md`，该文件**不包含**用户的个人语言偏好（如 "使用中文与我交互"）。

### 2.4 为什么正文是中文？

正文内容由 LLM 生成的逻辑：
1. `ChannelAssistant.CHANNEL_PROMPT_PREFIX` 是中文
2. Channel 模式工作区（用户绑定的项目目录）通常有 `CLAUDE.md`
3. 如果项目级 CLAUDE.md 或 `~/.localclaw/CLAUDE.md` 包含中文指令，LLM 会遵循
4. 但操作提示是 LLM 生成的，可能不受约束影响

### 2.5 为什么个人环境正常？

用户本地的 `~/.claude/CLAUDE.md` 包含：
```markdown
- 使用中文与我交互
```

但这只影响本地 Claude Code CLI 会话，**不影响 Channel 模式的 CLI**。

---

## 三、问题代码位置

| 文件 | 问题 |
|------|------|
| [packages/sdk/src/capability/runner/claude-config-dir.ts](packages/sdk/src/capability/runner/claude-config-dir.ts) | 使用隔离目录 `~/.localclaw`，不读取用户全局配置 |
| [packages/server/src/modules/tech-stack/tech-stack-registrar.service.ts](packages/server/src/modules/tech-stack/tech-stack-registrar.service.ts) | 只管理 `~/.localclaw/CLAUDE.md`，不包含语言指令 |
| [packages/channel/src/channel-assistant.ts](packages/channel/src/channel-assistant.ts) | `CHANNEL_PROMPT_PREFIX` 是中文，但无语言强制约束 |
| [packages/sdk/src/capability/routing/smart-hybrid.service.ts](packages/sdk/src/capability/routing/smart-hybrid.service.ts) | 创建的 `CLAUDE_MD_BLOCK` 是英文，无语言设置 |

---

## 四、修复方案

### 方案一：在 CHANNEL_PROMPT_PREFIX 中强制指定中文（推荐）

**优点**：简单直接，影响所有 Channel 会话
**缺点**：无法区分用户偏好

修改 `packages/channel/src/channel-assistant.ts`：

```typescript
private static readonly CHANNEL_PROMPT_PREFIX =
  "[Channel 模式] 你正在回复 IM 用户。请遵守以下约束：\n" +
  "- 必须使用中文回复。\n" +  // ← 新增
  "- 禁止调用 Bash/BashOutput/KillShell — 绝不使用这些工具。\n" +
  // ...
```

### 方案二：在 TechStackRegistrarService 注入语言约束

**优点**：与现有技术栈管理系统集成
**缺点**：依赖技术栈功能启用

修改 `packages/server/src/modules/tech-stack/tech-stack-registrar.service.ts`，在渲染块中加入语言约束：

```typescript
private renderBlock(config: TechStackConfig, existing: string): string {
  const lines = [
    TechStackRegistrarService.START,
    "## 语言与默认技术栈约束",
    "",
    "除非我在某条消息里明确指定其他语言或技术栈，否则一律遵守以下默认约束：",
    "",
    "- 回复语言：中文（禁止使用英文回复）",  // ← 新增
    // ...
  ];
}
```

### 方案三：迁移用户语言偏好到隔离配置目录

**优点**：尊重用户个性化设置
**缺点**：实现复杂度高，需要迁移逻辑

1. 检测 `~/.claude/CLAUDE.md` 中的语言相关指令
2. 同步到 `~/.localclaw/CLAUDE.md`
3. 保持双向同步

### 方案四：创建默认语言约束文件

在 `ensureClaudeConfigDir()` 中创建默认语言约束：

```typescript
const DEFAULT_LANGUAGE_RULES = `
## 语言约束

- 使用中文与用户交流。
- 所有提示和确认信息必须使用中文。
`;

// 在 ensureClaudeConfigDir 中追加
function ensureClaudeConfigDir(): string {
  const dir = getClaudeConfigDir();
  // ...现有逻辑...
  
  // 确保语言约束存在
  const claudeMdPath = join(dir, "CLAUDE.md");
  if (existsSync(claudeMdPath)) {
    const content = readFileSync(claudeMdPath, "utf8");
    if (!content.includes("## 语言约束")) {
      appendFileSync(claudeMdPath, DEFAULT_LANGUAGE_RULES, "utf8");
    }
  }
  return dir;
}
```

---

## 五、推荐实施方案

### 短期修复（方案一 + 方案四）

1. **修改 `CHANNEL_PROMPT_PREFIX`**：添加中文强制约束
2. **修改 `ensureClaudeConfigDir()`**：自动注入语言约束

### 长期改进（方案三方向）

1. 设计用户偏好迁移机制
2. 在 UI 中提供 Channel 专属语言设置
3. 支持 per-user/per-channel 语言配置

---

## 六、实施步骤

### Step 1: 修改 CHANNEL_PROMPT_PREFIX

```typescript:packages/channel/src/channel-assistant.ts
private static readonly CHANNEL_PROMPT_PREFIX =
  "[Channel 模式] 你正在回复 IM 用户。请遵守以下约束：\n" +
  "- 必须使用中文回复，禁止在回复中夹杂英文。\n" +
  "- 禁止调用 Bash/BashOutput/KillShell — 绝不使用这些工具。\n" +
  // ...
```

### Step 2: 修改 ensureClaudeConfigDir

```typescript:packages/sdk/src/capability/runner/claude-config-dir.ts
// 在文件开头添加
const LANGUAGE_CONSTRAINTS = `
<!-- local-claw:language-constraint:v1 -->
## 语言约束

- 使用中文与用户交流。
- 所有提示、确认和问题必须使用中文。
- 禁止在回复中出现英文，除非用户明确使用英文提问。
<!-- /local-claw:language-constraint -->
`;

// 修改 ensureClaudeConfigDir 函数
export function ensureClaudeConfigDir(): string {
  const dir = getClaudeConfigDir();
  try {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const settingsPath = join(dir, "settings.json");
    // ...现有 settings 处理...
    
    // 确保语言约束存在
    ensureLanguageConstraints(dir);
  } catch (e) {
    logger.warn(`[claude-config-dir] ensure failed:`, e);
  }
  return dir;
}

function ensureLanguageConstraints(dir: string): void {
  const p = join(dir, "CLAUDE.md");
  if (!existsSync(p)) {
    writeFileSync(p, LANGUAGE_CONSTRAINTS, "utf8");
    return;
  }
  const content = readFileSync(p, "utf8");
  if (content.includes("local-claw:language-constraint")) return;
  const prefix = content.endsWith("\n") ? "" : "\n";
  appendFileSync(p, prefix + LANGUAGE_CONSTRAINTS, "utf8");
}
```

---

## 七、验证方法

### 1. 本地验证

```bash
# 检查 ~/.localclaw/CLAUDE.md 是否包含语言约束
cat ~/.localclaw/CLAUDE.md

# 应该看到：
# <!-- local-claw:language-constraint:v1 -->
# ## 语言约束
# - 使用中文与用户交流。
```

### 2. 功能测试

1. 启动 LocalCoding 应用
2. 打开微信测试频道
3. 发送测试消息
4. 验证回复是否全部为中文

### 3. 跨环境验证

在不同用户的机器上测试：
- 新用户（无 `~/.claude/CLAUDE.md`）
- 老用户（有 `~/.claude/CLAUDE.md` 但语言指令不同）

---

## 八、风险评估

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| 强制中文可能影响英文用户 | 英文用户收到中文回复 | 提供语言偏好配置选项 |
| 语言约束可能与项目 CLAUDE.md 冲突 | 优先级不明确 | 明确说明：Channel 模式优先使用系统级约束 |

---

## 九、结论

**根本原因**：`~/.localclaw/CLAUDE.md`（Channel CLI 读取的配置）与 `~/.claude/CLAUDE.md`（用户全局配置）分离，导致用户的个人语言偏好（"使用中文与我交互"）无法传递给 Channel 模式的 CLI。

**推荐修复**：在 `CHANNEL_PROMPT_PREFIX` 和 `ensureClaudeConfigDir()` 中强制注入中文约束，确保所有 Channel 会话使用中文回复。

---

*报告生成时间：2026-06-15*
*分析工具：Claude Code*