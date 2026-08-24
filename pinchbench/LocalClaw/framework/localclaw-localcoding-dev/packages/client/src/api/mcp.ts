/**
 * MCP 连接器 API 客户端。
 */
import { getJson, postJson, putJson, deleteJson } from "./_fetch";
import type { MCPServer, MCPServerConfig } from "@lenovo/agent-protocol";

// Re-export for consumers
export type { MCPServer, MCPServerConfig };

export async function apiListMCPServers(): Promise<MCPServer[]> {
  const r = await getJson<{ servers: MCPServer[] }>("/api/mcp/servers");
  return r?.servers ?? [];
}

export async function apiGetMCPServer(id: string): Promise<MCPServer | null> {
  const r = await getJson<{ server: MCPServer }>(`/api/mcp/servers/${id}`);
  return r?.server ?? null;
}

export async function apiCreateMCPServer(
  input: Omit<MCPServerConfig, "id" | "createdAt" | "updatedAt">,
): Promise<MCPServer> {
  const r = await postJson<{ server: MCPServer }>("/api/mcp/servers", input);
  if (!r?.server) throw new Error("create failed");
  return r.server;
}

export async function apiUpdateMCPServer(
  id: string,
  patch: Partial<MCPServerConfig>,
): Promise<MCPServer> {
  const r = await putJson<{ server: MCPServer }>(`/api/mcp/servers/${id}`, patch);
  if (!r?.server) throw new Error("update failed");
  return r.server;
}

export async function apiDeleteMCPServer(id: string): Promise<void> {
  const r = await deleteJson<{ ok: boolean }>(`/api/mcp/servers/${id}`);
  if (!r?.ok) throw new Error("delete failed");
}

export async function apiStartMCPServer(id: string): Promise<void> {
  await postJson(`/api/mcp/servers/${id}/start`, {});
}

export async function apiStopMCPServer(id: string): Promise<void> {
  await postJson(`/api/mcp/servers/${id}/stop`, {});
}
