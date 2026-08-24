import { existsSync, mkdirSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { getClaudeConfigDir } from "./paths";
import { atomicWriteFile } from "../util/atomic-write";

/**
 * 隔离目录 .claude.json 读写（去产品化）。
 *
 * 与 agent-settings.ts（settings.json）平级，但语义不同：
 *   - settings.json：LocalClaw 自身的 env / endpoints / 渠道态等。
 *   - .claude.json：定制版 Claude CLI（@lenovo/claude-cli）真正读取 MCP 配置与
 *     会话登录态的文件。CLI 从 CLAUDE_CONFIG_DIR（getClaudeConfigDir）下 .claude.json
 *     的【顶层 mcpServers】读取 MCP Server 定义并自行 spawn / 路由 mcp__<server>__<tool>。
 *
 * 注意：勿与 getClaudeJsonPath()（用户全局 ~/.claude.json）混淆——本文件操作的是
 * 隔离配置目录下的 .claude.json。
 */
export type ClaudeConfigJson = {
  /** CLI 读取的 MCP Server 定义（stdio / sse / http 三态条目）。 */
  mcpServers?: Record<string, unknown>;
  /** 本应用注册器写入的托管键名，用于先删后写的幂等同步。 */
  mcpServersManaged?: string[];
  [key: string]: unknown;
};

export function getClaudeConfigJsonPath(): string {
  return join(getClaudeConfigDir(), ".claude.json");
}

export function readClaudeConfigJson(): ClaudeConfigJson {
  const p = getClaudeConfigJsonPath();
  if (!existsSync(p)) return {};
  try {
    return JSON.parse(readFileSync(p, "utf8")) as ClaudeConfigJson;
  } catch {
    return {};
  }
}

export function writeClaudeConfigJson(json: ClaudeConfigJson): void {
  const p = getClaudeConfigJsonPath();
  mkdirSync(dirname(p), { recursive: true });
  atomicWriteFile(p, JSON.stringify(json, null, 2));
}
