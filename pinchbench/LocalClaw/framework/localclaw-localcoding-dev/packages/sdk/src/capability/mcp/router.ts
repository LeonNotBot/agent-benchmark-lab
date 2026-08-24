/**
 * MCP Tool Router：Tool → Server 路由 + 冲突处理。
 * @module @lenovo/agent-sdk / capability / mcp / router
 * @internal
 */
import { logger } from "../../util/logger";
import type { MCPToolRegistry } from "./registry";
import type { MCPTool } from "./types";

/** 路由结果 */
export interface RouteResult {
  tool: MCPTool;
  serverId: string;
}

/** 路由冲突策略 */
export type ConflictStrategy = "first" | "error";

/**
 * Tool Router：将 Tool 调用请求路由到具体 Server。
 *
 * 冲突处理：同名 Tool 来自多个 Server 时
 * - "first"（默认）：取注册顺序第一个，记录 warn
 * - "error"：抛错，要求调用方用 serverId 显式指定
 */
export class MCPToolRouter {
  constructor(
    private readonly registry: MCPToolRegistry,
    private readonly conflictStrategy: ConflictStrategy = "first",
  ) {}

  /**
   * 路由 Tool 调用。
   * @param toolName Tool 名称
   * @param preferServerId 显式指定 Server（优先于冲突策略）
   */
  route(toolName: string, preferServerId?: string): RouteResult {
    const candidates = this.registry.resolve(toolName);

    if (candidates.length === 0) {
      throw new Error(`[MCPToolRouter] no server provides tool: ${toolName}`);
    }

    // 显式指定 Server
    if (preferServerId) {
      const match = candidates.find((t) => t.serverId === preferServerId);
      if (!match) {
        throw new Error(`[MCPToolRouter] tool "${toolName}" not found on server ${preferServerId}`);
      }
      return { tool: match, serverId: match.serverId };
    }

    // 唯一
    if (candidates.length === 1) {
      return { tool: candidates[0], serverId: candidates[0].serverId };
    }

    // 冲突
    if (this.conflictStrategy === "error") {
      const servers = candidates.map((t) => t.serverId).join(", ");
      throw new Error(
        `[MCPToolRouter] tool "${toolName}" provided by multiple servers [${servers}]; specify serverId`,
      );
    }

    logger.warn(
      `[MCPToolRouter] tool "${toolName}" conflict across ${candidates.length} servers; using first`,
    );
    return { tool: candidates[0], serverId: candidates[0].serverId };
  }

  /** 检查 Tool 是否可路由 */
  canRoute(toolName: string): boolean {
    return this.registry.resolve(toolName).length > 0;
  }
}
