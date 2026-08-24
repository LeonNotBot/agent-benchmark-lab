import { readAgentSettings } from "./agent-settings";
import type { ClaudeSettingsEnv } from "@lenovo/agent-protocol";

const CLAUDE_SETTINGS_ENV_KEYS = [
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL",
  "ANTHROPIC_DEFAULT_OPUS_MODEL",
  "ANTHROPIC_DEFAULT_SONNET_MODEL",
  "ANTHROPIC_MODEL",
  "API_TIMEOUT_MS",
  "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC",
  "CLAUDE_RUNNER_MODE",
  "CLAUDE_CLI_PATH",
  "CLAUDE_CLI_EXECUTABLE",
] as const;

export function loadClaudeSettingsEnv(): ClaudeSettingsEnv {
  try {
    const parsed = readAgentSettings();
    // 注入 settings.json 的 env 块（CLI 也读这些）。直连概念已移除：所有上游访问统一
    // 经本地网关，endpoint 配置存于 endpoints 数组、由 EndpointRegistry 管理。
    if (parsed.env) {
      for (const [key, value] of Object.entries(parsed.env)) {
        if (process.env[key] === undefined && value !== undefined && value !== null) {
          process.env[key] = String(value);
        }
      }
    }
  } catch {
    // Ignore missing or invalid settings file.
  }

  const env = {} as ClaudeSettingsEnv;
  for (const key of CLAUDE_SETTINGS_ENV_KEYS) {
    env[key] = process.env[key] ?? "";
  }
  return env;
}

export const claudeCodeEnv = loadClaudeSettingsEnv();
