import type { MCPServer } from "@lenovo/agent-protocol";

export interface McpSlice {
  mcpServers: MCPServer[];
  setMcpServers: (servers: MCPServer[]) => void;
}

export function createMcpSlice(set: any): McpSlice {
  return {
    mcpServers: [],
    setMcpServers: (mcpServers) => set({ mcpServers }),
  };
}
