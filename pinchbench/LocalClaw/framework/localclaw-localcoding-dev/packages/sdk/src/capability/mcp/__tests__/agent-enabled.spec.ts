/**
 * isMcpServerAgentEnabled 单测：判定 MCP Server 是否会被 Agent CLI 加载。
 * 与 McpAgentRegistrarService.mapToCliEntry 的投影判定同源。
 */
import { describe, it, expect } from "vitest";
import { isMcpServerAgentEnabled } from "../agent-enabled";
import type { MCPServerConfig } from "../types";

function base(overrides: Partial<MCPServerConfig>): MCPServerConfig {
  return {
    id: "srv-1",
    name: "test",
    type: "stdio",
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

describe("isMcpServerAgentEnabled", () => {
  it("stdio 有 command → 会被加载", () => {
    expect(isMcpServerAgentEnabled(base({ type: "stdio", command: "npx" }))).toBe(true);
  });

  it("stdio 无 command → 不会被加载", () => {
    expect(isMcpServerAgentEnabled(base({ type: "stdio", command: undefined }))).toBe(false);
  });

  it("sse 有 url → 会被加载", () => {
    expect(isMcpServerAgentEnabled(base({ type: "sse", url: "https://x" }))).toBe(true);
  });

  it("streamable_http 无 url → 不会被加载", () => {
    expect(isMcpServerAgentEnabled(base({ type: "streamable_http", url: undefined }))).toBe(false);
  });
});
