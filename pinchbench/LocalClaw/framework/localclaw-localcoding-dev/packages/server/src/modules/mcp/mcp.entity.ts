/**
 * MCP Server 数据库实体定义（SQLite）。
 * 使用 raw SQL 建表（与 channel 模块一致的迁移模式）。
 */
import type Database from "better-sqlite3";
import type { MCPServerConfig, MCPTool } from "@lenovo/agent-sdk";

/** mcp_servers 表行 */
export interface MCPServerRow {
  id: string;
  name: string;
  description: string | null;
  type: string;
  command: string | null;
  args: string | null;    // JSON string
  env: string | null;     // JSON string
  url: string | null;
  headers: string | null; // JSON string
  sort_order: number;
  created_at: number;
  updated_at: number;
}

/** mcp_tools 表行 */
export interface MCPToolRow {
  id: string;
  server_id: string;
  name: string;
  description: string | null;
  input_schema: string | null; // JSON string
  risk: string;
  cached_at: number;
}

export function buildMCPServerRow(config: MCPServerConfig): MCPServerRow {
  return {
    id: config.id,
    name: config.name,
    description: config.description ?? null,
    type: config.type,
    command: config.command ?? null,
    args: config.args ? JSON.stringify(config.args) : null,
    env: config.env ? JSON.stringify(config.env) : null,
    url: config.url ?? null,
    headers: config.headers ? JSON.stringify(config.headers) : null,
    sort_order: config.sortOrder ?? 0,
    created_at: config.createdAt,
    updated_at: config.updatedAt,
  };
}

export function parseMCPServerRow(row: MCPServerRow): MCPServerConfig {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    type: row.type as MCPServerConfig["type"],
    command: row.command ?? undefined,
    args: row.args ? JSON.parse(row.args) : undefined,
    env: row.env ? JSON.parse(row.env) : undefined,
    url: row.url ?? undefined,
    headers: row.headers ? JSON.parse(row.headers) : undefined,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function parseMCPToolRow(row: MCPToolRow, serverName: string): MCPTool {
  return {
    name: row.name,
    description: row.description ?? "",
    inputSchema: row.input_schema ? JSON.parse(row.input_schema) : {},
    serverId: row.server_id,
    serverName,
    risk: row.risk as MCPTool["risk"],
  };
}
