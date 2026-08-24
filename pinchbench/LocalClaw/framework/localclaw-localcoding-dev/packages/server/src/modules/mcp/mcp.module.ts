/**
 * MCP 模块。
 */
import { Module } from "@nestjs/common";
import { McpService } from "./mcp.service";
import { McpController } from "./mcp.controller";
import { McpGatewayBridge } from "./mcp-bridge";
import { McpRuntimeBridge } from "./mcp-runtime-bridge";
import { McpAgentRegistrarService } from "./mcp-agent-registrar.service";

@Module({
  controllers: [McpController],
  providers: [McpService, McpGatewayBridge, McpRuntimeBridge, McpAgentRegistrarService],
  exports: [McpService, McpGatewayBridge],
})
export class McpModule {}
