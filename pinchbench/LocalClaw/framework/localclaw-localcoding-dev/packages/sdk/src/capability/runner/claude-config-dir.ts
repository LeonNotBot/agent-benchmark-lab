// LocalClaw 专属的 CLI 配置目录（CLAUDE_CONFIG_DIR）。
//
// 目的：让本应用 spawn 的 claude CLI 与用户全局 ~/.claude 彻底隔离，改用 ~/.localclaw。
// CLI 会从 CLAUDE_CONFIG_DIR 读 settings.json / .claude.json / projects 等。
// 关键：清洗 settings.json 的 env 块，移除 ANTHROPIC_BASE_URL / ANTHROPIC_AUTH_TOKEN，
// 确保所有流量走 localclaw gateway，而不是被直连地址绕过。

import { logger } from "../../util/logger";
import { existsSync, mkdirSync, writeFileSync, readFileSync, appendFileSync } from "fs";
import { join } from "path";
import { getClaudeConfigDir, getClaudeJsonPath } from "../../config/paths";

// 语言约束标记块（版本化，支持幂等替换）。
// v2：从「写死中文」改为「跟随用户提问语言」，使 UI 中英文切换与 Agent 回复语言天然一致。
const LANGUAGE_CONSTRAINT_START = "<!-- local-claw:language-constraint:v2 -->";
const LANGUAGE_CONSTRAINT_END = "<!-- /local-claw:language-constraint -->";
// 匹配任意历史版本的整块（含起止标记），用于幂等替换旧块。
const LANGUAGE_CONSTRAINT_BLOCK_RE =
  /<!-- local-claw:language-constraint:v\d+ -->[\s\S]*?<!-- \/local-claw:language-constraint -->\n?/;
const LANGUAGE_CONSTRAINT_BLOCK = `
${LANGUAGE_CONSTRAINT_START}
## 语言约束

- 始终使用用户当前提问所用的语言进行回复。
- 用户用中文提问就用中文回复，用英文提问就用英文回复。
- 所有提示、确认和问题都应与用户最近一条消息的语言保持一致。
${LANGUAGE_CONSTRAINT_END}
`.trim() + "\n";

export { getClaudeConfigDir } from "../../config/paths";

// 这些 key 会让 CLI 直连上游、绕过 gateway，隔离目录里必须确保它们不存在。
const FORBIDDEN_ENV_KEYS = ["ANTHROPIC_BASE_URL", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_API_KEY"];

// 默认注入的 CLI 行为设置（与用户全局体验对齐，但不含任何直连地址）。
const DEFAULT_SETTINGS: Record<string, unknown> = {
  env: {},
  alwaysThinkingEnabled: true,
  skipDangerousModePermissionPrompt: true,
};

/**
 * 确保隔离配置目录存在且 settings.json 干净。
 * 此目录即 ~/.localclaw（localclaw 与 CLI 共用），故只增量清洗 env 中的禁用 key，
 * 绝不整体覆盖已有 settings.json（会丢掉 localclaw 的 model / mcpServers 等字段）。
 * 同时确保语言约束（中文）已注入到 CLAUDE.md。
 * 返回目录路径，供设置 CLAUDE_CONFIG_DIR。
 */
export function ensureClaudeConfigDir(): string {
  const dir = getClaudeConfigDir();
  try {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const settingsPath = join(dir, "settings.json");
    if (existsSync(settingsPath)) {
      // 已有配置：解析成功才清洗回写；解析失败则保持原样不动，避免破坏。
      const settings = readExistingSettings(settingsPath);
      if (settings) {
        sanitizeEnv(settings);
        writeFileSync(settingsPath, JSON.stringify(settings, null, 2), "utf8");
      }
    } else {
      writeFileSync(settingsPath, JSON.stringify(DEFAULT_SETTINGS, null, 2), "utf8");
    }
    ensureClaudeJson(dir);
    ensureLanguageConstraint(dir);
  } catch (e) {
    logger.warn(`[claude-config-dir] ensure failed:`, e);
  }
  return dir;
}

/**
 * 确保隔离配置目录的 CLAUDE.md 包含语言约束（当前版本 v2：跟随用户提问语言）。
 * 使用版本化标记块，支持幂等：
 *   - 已是当前版本 → 跳过；
 *   - 存在旧版本块（如 v1 写死中文）→ 原地整块替换为当前版本；
 *   - 完全没有 → 追加到文件末尾；
 *   - 文件不存在 → 创建。
 */
function ensureLanguageConstraint(dir: string): void {
  const claudeMdPath = join(dir, "CLAUDE.md");
  try {
    if (!existsSync(claudeMdPath)) {
      // CLAUDE.md 不存在，创建并写入语言约束
      writeFileSync(claudeMdPath, LANGUAGE_CONSTRAINT_BLOCK, "utf8");
      logger.log(`[claude-config-dir] created CLAUDE.md with language constraint`);
      return;
    }
    const content = readFileSync(claudeMdPath, "utf8");
    // 已是当前版本，跳过
    if (content.includes(LANGUAGE_CONSTRAINT_START)) {
      return;
    }
    // 存在旧版本块：原地整块替换为当前版本（升级 v1 写死中文 → v2 跟随用户语言）
    if (LANGUAGE_CONSTRAINT_BLOCK_RE.test(content)) {
      const updated = content.replace(LANGUAGE_CONSTRAINT_BLOCK_RE, LANGUAGE_CONSTRAINT_BLOCK);
      writeFileSync(claudeMdPath, updated, "utf8");
      logger.log(`[claude-config-dir] upgraded language constraint to current version`);
      return;
    }
    // 没有任何版本块：追加语言约束到文件末尾
    const prefix = content.endsWith("\n") ? "" : "\n";
    appendFileSync(claudeMdPath, prefix + LANGUAGE_CONSTRAINT_BLOCK, "utf8");
    logger.log(`[claude-config-dir] appended language constraint to CLAUDE.md`);
  } catch (e) {
    logger.warn(`[claude-config-dir] ensureLanguageConstraint failed:`, e);
  }
}

/**
 * 隔离目录的 .claude.json：CLI 从这里读 MCP 配置与会话登录态。
 * 首次创建时，从用户全局 ~/.claude.json 复制顶层 mcpServers（含手动添加的 codegraph），
 * 这样隔离后 MCP 不丢失。已存在则不动，由 CLI / registrar 自行维护。
 */
function ensureClaudeJson(dir: string): void {
  const target = join(dir, ".claude.json");
  if (existsSync(target)) return;
  let mcpServers: Record<string, unknown> = {};
  const globalJson = getClaudeJsonPath();
  if (existsSync(globalJson)) {
    try {
      const g = JSON.parse(readFileSync(globalJson, "utf8")) as Record<string, unknown>;
      if (g.mcpServers && typeof g.mcpServers === "object") {
        mcpServers = g.mcpServers as Record<string, unknown>;
      }
    } catch { /* 全局文件损坏则留空，CLI 仍可启动 */ }
  }
  writeFileSync(target, JSON.stringify({
    mcpServers,
    // 隔离目录是全新的，预置这些标记避免 CLI 在非交互模式下触发首次运行 / 信任对话阻塞。
    hasCompletedOnboarding: true,
    bypassPermissionsModeAccepted: true,
    hasTrustDialogAccepted: true,
  }, null, 2), "utf8");
  logger.log(`[claude-config-dir] seeded .claude.json with MCP: ${Object.keys(mcpServers).join(", ") || "(none)"}`);
}

function readExistingSettings(path: string): Record<string, unknown> | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** 从 settings.env 中移除会导致直连的 key。 */
function sanitizeEnv(settings: Record<string, unknown>): void {
  const env = settings.env;
  if (env && typeof env === "object") {
    for (const key of FORBIDDEN_ENV_KEYS) delete (env as Record<string, unknown>)[key];
  } else {
    settings.env = {};
  }
}
