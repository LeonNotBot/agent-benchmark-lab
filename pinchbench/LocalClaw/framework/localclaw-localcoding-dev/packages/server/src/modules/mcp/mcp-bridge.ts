/**
 * MCP 事件桥接：后端 → WebSocket 网关。
 * 与 ChannelGatewayBridge 模式一致，通过 EventEmitter 向 websocket.module 推送事件。
 */
import { Injectable } from "@nestjs/common";
import { EventEmitter } from "events";
import type { MCPServer, MCPTool, MCPPermissionRequest } from "@lenovo/agent-sdk";

@Injectable()
export class McpGatewayBridge extends EventEmitter {
  /** Server 列表变更 */
  emitServerList(servers: MCPServer[]): void {
    this.emit("mcp.server.list", { servers });
  }

  /** 单个 Server 新增/更新 */
  emitServerUpdated(server: MCPServer): void {
    this.emit("mcp.server.updated", { server });
  }

  /** Server 删除 */
  emitServerDeleted(serverId: string): void {
    this.emit("mcp.server.deleted", { serverId });
  }

  /** Server 状态变更 */
  emitServerStatus(serverId: string, status: string, error?: string): void {
    this.emit("mcp.server.status", { serverId, status, error });
  }

  /** Server 启动成功，携带 tools 列表 */
  emitServerStarted(serverId: string, tools: MCPTool[]): void {
    this.emit("mcp.server.started", { serverId, tools });
  }

  /** Tool 调用结果 */
  emitToolResult(toolUseId: string, success: boolean, content: unknown): void {
    this.emit("mcp.tool.result", { toolUseId, success, content });
  }

  /** 权限请求（前端弹出 dialog） */
  emitPermissionRequest(req: MCPPermissionRequest): void {
    this.emit("mcp.permission.request", req);
  }
}
