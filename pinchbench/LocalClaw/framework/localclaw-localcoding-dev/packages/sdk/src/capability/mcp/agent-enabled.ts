/**
 * MCP Server 是否会被 Agent 加载的判定。
 * @module @lenovo/agent-sdk / capability / mcp / agent-enabled
 * @internal
 */
import type { MCPServerConfig } from "./types";

/**
 * 判定 MCP Server 是否会被投影进 .claude.json（即会被 Agent CLI 加载并使用）。
 *
 * 与 McpAgentRegistrarService.mapToCliEntry 的非空判定保持同源：
 * stdio 需 command，sse / streamable_http 需 url，缺必需字段则不会被加载。
 */
export function isMcpServerAgentEnabled(server: MCPServerConfig): boolean {
  if (server.type === "stdio") return Boolean(server.command);
  return Boolean(server.url);
}
