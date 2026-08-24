/**
 * prepare-env —— 在 import claude-cli 之前布置好运行环境。
 *
 * 三件事：
 *  1. 确保隔离配置目录 ~/.localcoding 存在，并 seed .claude.json（避免非交互阻塞）。
 *  2. 从 ~/.localcoding/settings.json 的 endpoints 读出启用的端点，把凭据注入 process.env
 *     （anthropic 直连 或 openai 兼容直连）。
 *  3. 设 CLAUDE_CONFIG_DIR / CLAUDE_CODE_ENTRYPOINT，让 CLI 走隔离目录。
 *
 * 与后端 runner 的关键差异：后端强制流量走本地 gateway（清洗直连 key）；CLI 第一版
 * 无后端，故【反向】——直接注入端点直连凭据。路由/网关留待 daemon 阶段。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pickEndpointEnv, type EndpointLike } from "./endpoint-env.js";

/** 隔离配置目录：优先环境变量，默认 ~/.localcoding（与桌面端共享会话历史）。 */
export function resolveConfigDir(): string {
  return (
    process.env.CLAUDE_CONFIG_DIR ||
    process.env.LOCALCLAW_CLAUDE_HOME ||
    process.env.AGENT_CONFIG_DIR ||
    join(homedir(), ".localcoding")
  );
}

/** 准备环境，返回诊断信息供入口决定是否提示用户。 */
export function prepareEnv(): { configDir: string; credentialSource: string } {
  const configDir = resolveConfigDir();
  ensureConfigDir(configDir);

  process.env.CLAUDE_CONFIG_DIR = configDir;
  process.env.CLAUDE_CODE_ENTRYPOINT ||= "localclaw-cli";

  const credentialSource = injectCredentials(configDir);
  return { configDir, credentialSource };
}

/** 确保目录存在并 seed .claude.json（onboarding 标记，防非交互阻塞）。 */
function ensureConfigDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const claudeJson = join(dir, ".claude.json");
  if (!existsSync(claudeJson)) {
    writeFileSync(
      claudeJson,
      JSON.stringify(
        {
          mcpServers: {},
          hasCompletedOnboarding: true,
          bypassPermissionsModeAccepted: true,
          hasTrustDialogAccepted: true,
        },
        null,
        2,
      ),
      "utf8",
    );
  }
}

/**
 * 注入凭据。优先级：已有的 ANTHROPIC/OPENAI 环境变量 > settings.json 里 enabled 的端点。
 * 返回来源标识："env" | "endpoint:<id>" | "none"。
 */
function injectCredentials(configDir: string): string {
  // 用户已在 shell 里显式设了直连凭据 → 尊重之，不覆盖。
  if (process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_API_KEY) return "env";
  if (process.env.CLAUDE_CODE_USE_OPENAI === "1" && process.env.OPENAI_API_KEY) return "env";

  const endpoint = readFirstEnabledEndpoint(configDir);
  if (!endpoint) return "none";

  const env = pickEndpointEnv(endpoint);
  if (!env) return "none";
  for (const [k, v] of Object.entries(env)) process.env[k] = v;
  return `endpoint:${endpoint.id}`;
}

/** 读 settings.json 的第一个 enabled 端点（坏 JSON / 无文件 → undefined）。 */
function readFirstEnabledEndpoint(configDir: string): EndpointLike | undefined {
  const settingsPath = join(configDir, "settings.json");
  if (!existsSync(settingsPath)) return undefined;
  try {
    const settings = JSON.parse(readFileSync(settingsPath, "utf8")) as {
      endpoints?: EndpointLike[];
    };
    const list = Array.isArray(settings.endpoints) ? settings.endpoints : [];
    return list.find((e) => e && e.enabled && e.apiKey && e.baseUrl);
  } catch {
    return undefined;
  }
}
