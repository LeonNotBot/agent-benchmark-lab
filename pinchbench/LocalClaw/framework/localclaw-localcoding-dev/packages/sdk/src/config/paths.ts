/**
 * SDK 路径解析 —— 唯一真相（@public）。
 *
 * 三个产品（localcoding / teamai / localclaw）共用本 SDK，但各自的配置/数据必须
 * 落在不同目录，否则会互相覆盖。本模块集中所有路径决策，杜绝散落各处的
 * `join(homedir(), ".localclaw")` 硬编码。
 *
 * ── 两个独立的目录概念，勿混 ──
 *  1. 产品配置根（agentHome）：本产品自己的 settings / 定时任务 / 渠道态等。
 *     默认 ~/.<product>，宿主用 configurePaths({product}) 声明产品名即可切换。
 *  2. CLI 共用目录（claudeHome）：与 spawn 的 claude CLI 交互的 ~/.claude 系。
 *
 * ── 解析优先级（每个路径一致）──
 *     configurePaths() 显式注入  >  环境变量  >  homedir 下的默认值
 *
 * 全部以「函数」而非顶层 const 暴露：路径在调用时解析，宿主可在启动后、
 * 任何 Service 实例化前调 configurePaths() 改写，不受 import 时序影响。
 */
import { homedir } from "os";
import { join } from "path";

/** 宿主可显式注入的路径覆盖。未注入的字段回落到环境变量 / 默认值。 */
export type PathOverrides = {
  /**
   * 产品名（去产品化的唯一声明点）。各产品启动早期注入自己的名字，
   * SDK 据此派生全部默认目录：~/.<product> 与 ~/<product>-workspace。
   * 例：product="localcoding" → ~/.localcoding、~/localcoding-workspace。
   * 显式的 agentHomeDir / workspaceRoot 优先级更高，可单独覆盖派生结果。
   */
  product?: string;
  /** 产品配置根目录（settings / 定时任务 / 渠道态）。默认 ~/.<product>。 */
  agentHomeDir?: string;
  /** 与 claude CLI 共用的目录。默认 ~/.claude。 */
  claudeHomeDir?: string;
  /** CLI 的 .claude.json 路径。默认 ~/.claude.json。 */
  claudeJsonPath?: string;
  /** spawn 的 CLI 专属隔离配置目录（CLAUDE_CONFIG_DIR）。默认同 agentHomeDir。 */
  claudeConfigDir?: string;
  /** 工作区根目录（会话产物）。默认 ~/<product>-workspace。 */
  workspaceRoot?: string;
};

/** 进程级注入态。configurePaths 写入，各 getter 优先读取。 */
const overrides: PathOverrides = {};

/**
 * 宿主显式配置路径。建议在应用启动最早期（任何 SDK Service 实例化前）调用一次。
 * 只覆盖传入的字段；其余保持环境变量 / 默认行为。多次调用累积合并。
 */
export function configurePaths(opts: PathOverrides): void {
  Object.assign(overrides, opts);
}

/** @internal 测试用：清空注入态。 */
export function __resetPathsForTest(): void {
  for (const k of Object.keys(overrides) as (keyof PathOverrides)[]) {
    delete overrides[k];
  }
}

// ── 产品名（去产品化的唯一声明点）─────────────────────────────────

/** SDK 自身的兜底产品名。仅当宿主既未 configurePaths 也未设 AGENT_PRODUCT 时生效。 */
const FALLBACK_PRODUCT = "localcoding";

/**
 * 当前产品名。优先级：configurePaths({product}) > AGENT_PRODUCT 环境变量 > 兜底值。
 * agentHome / workspaceRoot 的默认目录均由此派生，新增产品只改这一个声明。
 */
export function getProductName(): string {
  return overrides.product ?? process.env.AGENT_PRODUCT ?? FALLBACK_PRODUCT;
}

// ── 产品配置根 ───────────────────────────────────────────────────

/**
 * 产品配置根目录。
 * 优先级：configurePaths(agentHomeDir) > AGENT_CONFIG_DIR > LOCALCLAW_CLAUDE_HOME(兼容)
 *        > ~/.<product>（product 见 getProductName）。
 */
export function getAgentHomeDir(): string {
  return (
    overrides.agentHomeDir ??
    process.env.AGENT_CONFIG_DIR ??
    process.env.LOCALCLAW_CLAUDE_HOME ??
    join(homedir(), "." + getProductName())
  );
}

// ── CLI 共用目录（~/.claude 系）────────────────────────────────────

/** 与 claude CLI 共用的目录。优先级：configurePaths > CLAUDE_HOME_DIR > ~/.claude。 */
export function getClaudeHomeDir(): string {
  return (
    overrides.claudeHomeDir ??
    process.env.CLAUDE_HOME_DIR ??
    join(homedir(), ".claude")
  );
}

/** CLI 的 .claude.json 路径。优先级：configurePaths > CLAUDE_JSON_PATH > ~/.claude.json。 */
export function getClaudeJsonPath(): string {
  return (
    overrides.claudeJsonPath ??
    process.env.CLAUDE_JSON_PATH ??
    join(homedir(), ".claude.json")
  );
}

// ── spawn CLI 的隔离配置目录（CLAUDE_CONFIG_DIR）────────────────────

/**
 * spawn 的 claude CLI 专属隔离目录。CLI 从这里读 settings.json / .claude.json /
 * projects。默认与产品配置根同目录（即 ~/.<product>）。
 * 优先级：configurePaths > LOCALCLAW_CLAUDE_HOME > getAgentHomeDir()。
 */
export function getClaudeConfigDir(): string {
  return (
    overrides.claudeConfigDir ??
    process.env.LOCALCLAW_CLAUDE_HOME ??
    getAgentHomeDir()
  );
}

// ── 产品配置根下的派生路径 ─────────────────────────────────────────

/** 定时任务存储文件。 */
export function getScheduledTasksPath(): string {
  return join(getAgentHomeDir(), "scheduled_tasks.json");
}

/** 定时任务历史文件。 */
export function getScheduledTaskHistoryPath(): string {
  return join(getAgentHomeDir(), "scheduled_task_history.json");
}

// ── 工作区根（会话产物，独立于配置目录）────────────────────────────

/**
 * 工作区根目录。语义是「会话产物的落地处」，与配置目录解耦，可单独覆盖。
 * 优先级：configurePaths(workspaceRoot) > AGENT_WORKSPACE_DIR > ~/<product>-workspace。
 */
export function getWorkspaceRoot(): string {
  return (
    overrides.workspaceRoot ??
    process.env.AGENT_WORKSPACE_DIR ??
    join(homedir(), getProductName() + "-workspace")
  );
}

// ── 产品配置根下的语义化派生目录（消费方勿再自行拼接 .localclaw）────

/** skills 安装目录。 */
export function getSkillsDir(): string {
  return join(getAgentHomeDir(), "skills");
}

/** 项目模板目录。 */
export function getTemplatesDir(): string {
  return join(getAgentHomeDir(), "templates");
}

/** 项目记忆 / 会话 transcript 根（CLI 的 projects 目录）。 */
export function getProjectsDir(): string {
  return join(getAgentHomeDir(), "projects");
}

/** 渠道态目录（如 channels/weixin/account.json）。 */
export function getChannelsDir(): string {
  return join(getAgentHomeDir(), "channels");
}

/** 密钥/隐私信息存储文件（key-value-用途 三元组）。 */
export function getSecretsPath(): string {
  return join(getAgentHomeDir(), "secrets.json");
}

// ── 向后兼容：deprecated 顶层常量别名 ──────────────────────────────
// 旧代码（server/src/config/paths.ts 等）从这里取常量。函数化后保留别名，
// 在 import 期求值一次。注意：configurePaths 若在 import 之后调用，不会反映到
// 这两个常量上——新代码请改用 getClaudeHomeDir() / getClaudeJsonPath()。

/** @deprecated 改用 getClaudeHomeDir()。import 期固化，不随 configurePaths 变化。 */
export const CLAUDE_HOME_DIR = getClaudeHomeDir();

/** @deprecated 改用 getClaudeJsonPath()。import 期固化，不随 configurePaths 变化。 */
export const CLAUDE_JSON_PATH = getClaudeJsonPath();
