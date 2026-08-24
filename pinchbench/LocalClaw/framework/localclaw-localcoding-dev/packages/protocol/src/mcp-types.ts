/**
 * MCP 连接器相关类型。
 * 与 @lenovo/agent-sdk 保持同步。
 */

export type MCPServerTransportType = "stdio" | "sse" | "streamable_http";

export type MCPServerStatus =
  | "installed"
  | "starting"
  | "running"
  | "error"
  | "stopped";

export type MCPToolRisk = "read" | "write" | "danger";

export interface MCPServerConfig {
  id: string;
  name: string;
  description?: string;
  type: MCPServerTransportType;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  sortOrder?: number;
  createdAt: number;
  updatedAt: number;
}

export interface MCPServer extends MCPServerConfig {
  status: MCPServerStatus;
  tools: MCPTool[];
  errorMessage?: string;
}

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: object;
  serverId: string;
  serverName: string;
  risk: MCPToolRisk;
}
