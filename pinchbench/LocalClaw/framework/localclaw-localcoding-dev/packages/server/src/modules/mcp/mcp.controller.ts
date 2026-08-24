/**
 * MCP HTTP 控制器（REST API）。
 */
import { Controller, Get, Post, Put, Delete, Body, Param, Inject } from "@nestjs/common";
import type { MCPServerConfig } from "@lenovo/agent-sdk";
import { McpService } from "./mcp.service";
import { McpRuntimeBridge } from "./mcp-runtime-bridge";

@Controller("api/mcp")
export class McpController {
  constructor(
    @Inject(McpService) private readonly service: McpService,
    @Inject(McpRuntimeBridge) private readonly runtime: McpRuntimeBridge,
  ) {}

  @Get("servers")
  listServers() {
    return { servers: this.service.listServers() };
  }

  @Get("servers/:id")
  getServer(@Param("id") id: string) {
    const server = this.service.getServer(id);
    if (!server) return { error: "not found" };
    return { server };
  }

  @Post("servers")
  addServer(@Body() body: Omit<MCPServerConfig, "id" | "createdAt" | "updatedAt">) {
    const server = this.service.addServer(body);
    // 添加后自动探活一次，fire-and-forget，状态变更经 WebSocket/轮询同步
    void this.runtime.startServer(server.id);
    return { server };
  }

  @Put("servers/:id")
  updateServer(@Param("id") id: string, @Body() body: Partial<MCPServerConfig>) {
    const server = this.service.updateServer(id, body);
    if (!server) return { error: "not found" };
    return { server };
  }

  @Delete("servers/:id")
  removeServer(@Param("id") id: string) {
    const ok = this.service.removeServer(id);
    return { ok };
  }

  @Post("servers/:id/start")
  startServer(@Param("id") id: string) {
    this.runtime.startServer(id);
    return { ok: true };
  }

  @Post("servers/:id/stop")
  stopServer(@Param("id") id: string) {
    this.runtime.stopServer(id);
    return { ok: true };
  }

  @Get("tools")
  listTools() {
    return { tools: this.service.listAllTools() };
  }
}
