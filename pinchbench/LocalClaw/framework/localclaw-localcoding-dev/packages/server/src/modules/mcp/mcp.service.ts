/**
 * MCP Server 业务逻辑层。
 * 管理 Server CRUD + 运行时状态映射（内存）。
 */
import { Injectable, Inject, OnModuleInit } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { DATABASE } from "@lenovo/agent-sdk";
import { isMcpServerAgentEnabled } from "@lenovo/agent-sdk";
import type { MCPServerConfig, MCPServer, MCPTool, MCPServerStatus } from "@lenovo/agent-sdk";
import {
  buildMCPServerRow,
  parseMCPServerRow,
  parseMCPToolRow,
  type MCPServerRow,
  type MCPToolRow,
} from "./mcp.entity";
import { runMcpMigrations } from "./mcp-migrations";
import { McpGatewayBridge } from "./mcp-bridge";

/** 内存中的运行时状态映射 */
const runtimeStatus: Map<string, MCPServerStatus> = new Map();
const runtimeTools: Map<string, MCPTool[]> = new Map();
const runtimeErrors: Map<string, string> = new Map();

@Injectable()
export class McpService implements OnModuleInit {
  bridgeReady = false;

  constructor(
    @Inject(DATABASE) private readonly db: Database.Database,
    @Inject(McpGatewayBridge) private readonly bridge: McpGatewayBridge,
  ) {}

  onModuleInit(): void {
    runMcpMigrations(this.db);
    const servers = this.listServers();
    for (const s of servers) {
      // 重启后状态判定（两分支）：
      // 1. 配置完整 → starting，由 McpRuntimeBridge.onModuleInit 后台重新探活得出真相。
      // 2. 配置不完整 → stopped。
      // 不用「有缓存工具 → installed」做捷径：缓存工具是 upsert 只增不删，只能证明
      // 「曾经拿到过工具」，不能证明「现在可用」。若上次启用失败但 DB 仍留有旧工具缓存，
      // 那条捷径会把它误判为「已启用」，与现实脱节。探活结果才是唯一真相。
      runtimeStatus.set(s.id, isMcpServerAgentEnabled(s) ? "starting" : "stopped");
    }
    this.bridgeReady = true;
    this.bridge?.emitServerList(this.buildServerList(servers));
  }

  /** 全量查询（带运行时状态） */
  listServers(): MCPServer[] {
    const rows = this.db.prepare("SELECT * FROM mcp_servers ORDER BY sort_order ASC, created_at ASC").all() as MCPServerRow[];
    const configs = rows.map(parseMCPServerRow);
    return this.buildServerList(configs);
  }

  /** 单条查询 */
  getServer(id: string): MCPServer | null {
    const row = this.db.prepare("SELECT * FROM mcp_servers WHERE id = ?").get(id) as MCPServerRow | undefined;
    if (!row) return null;
    return this.buildServer(parseMCPServerRow(row));
  }

  /** 创建 Server */
  addServer(input: Omit<MCPServerConfig, "id" | "createdAt" | "updatedAt">): MCPServer {
    const now = Date.now();
    const config: MCPServerConfig = {
      ...input,
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
    };
    const row = buildMCPServerRow(config);
    this.db.prepare(`
      INSERT INTO mcp_servers (id, name, description, type, command, args, env, url, headers, sort_order, created_at, updated_at)
      VALUES (@id, @name, @description, @type, @command, @args, @env, @url, @headers, @sort_order, @created_at, @updated_at)
    `).run(row);
    runtimeStatus.set(config.id, "starting");
    const server = this.buildServer(config);
    if (this.bridgeReady) this.bridge?.emitServerUpdated(server);
    return server;
  }

  /** 更新 Server */
  updateServer(id: string, patch: Partial<MCPServerConfig>): MCPServer | null {
    const existing = this.getServer(id);
    if (!existing) return null;
    // 不能改 id/createdAt
    const updated: MCPServerConfig = {
      ...existing,
      ...patch,
      id,
      createdAt: existing.createdAt,
      updatedAt: Date.now(),
    };
    const row = buildMCPServerRow(updated);
    this.db.prepare(`
      UPDATE mcp_servers SET
        name=@name, description=@description, type=@type,
        command=@command, args=@args, env=@env, url=@url,
        headers=@headers, sort_order=@sort_order, updated_at=@updated_at
      WHERE id=@id
    `).run(row);
    // 更新 runtime（如果运行中则下次启动生效）
    if (runtimeStatus.get(id) !== "running") {
      runtimeStatus.set(id, "installed");
    }
    const server = this.buildServer(updated);
    if (this.bridgeReady) this.bridge?.emitServerUpdated(server);
    return server;
  }

  /** 删除 Server */
  removeServer(id: string): boolean {
    const info = this.getServer(id);
    if (!info) return false;
    // 运行时停止（如果正在运行）
    this.setServerStatus(id, "stopped");
    runtimeStatus.delete(id);
    runtimeTools.delete(id);
    runtimeErrors.delete(id);
    this.db.prepare("DELETE FROM mcp_tools WHERE server_id = ?").run(id);
    this.db.prepare("DELETE FROM mcp_servers WHERE id = ?").run(id);
    if (this.bridgeReady) this.bridge?.emitServerDeleted(id);
    return true;
  }

  // ── 运行时状态（供 MCP Runtime Core 调用）──

  /** 广播当前全量 server 列表（带最新运行时状态）。供探活全部结束后做权威收敛广播。 */
  emitServerList(): void {
    if (this.bridgeReady) this.bridge?.emitServerList(this.listServers());
  }

  /** 广播单个 server 变更（带最新运行时状态和工具）。供探活完成后推送完整数据给前端。 */
  emitServerUpdated(server: MCPServer): void {
    if (this.bridgeReady) this.bridge?.emitServerUpdated(server);
  }

  /** 设置 Server 运行时状态并广播 */
  setServerStatus(id: string, status: MCPServerStatus, error?: string): void {
    runtimeStatus.set(id, status);
    // 错误信息生命周期绑定状态：仅 error 态保留 errorMessage；任何非 error 态（含
    // installed/starting/stopped）都清除残留错误，否则「错误→重试成功」后旧错误会
    // 一直挂在 UI 上（收敛广播的 list 从 runtimeErrors 读，会把陈旧错误带回前端）。
    if (status === "error") {
      if (error) runtimeErrors.set(id, error);
      else runtimeErrors.delete(id);
    } else {
      runtimeErrors.delete(id);
    }
    if (this.bridgeReady) this.bridge?.emitServerStatus(id, status, error);
  }

  /** 注册/更新 Tool 列表 */
  cacheTools(serverId: string, tools: MCPTool[]): void {
    runtimeTools.set(serverId, tools);
    // 持久化到 DB：先删本 server 旧行再插入，使缓存严格等于最近一次探活结果。
    // 不可只 upsert——那样探活失败/工具减少时旧行会残留，造成「失败的 server 仍有缓存工具」。
    this.db.prepare("DELETE FROM mcp_tools WHERE server_id = ?").run(serverId);
    const insertTool = this.db.prepare(`
      INSERT INTO mcp_tools (id, server_id, name, description, input_schema, risk, cached_at)
      VALUES (@id, @server_id, @name, @description, @input_schema, @risk, @cached_at)
    `);
    const now = Date.now();
    for (const tool of tools) {
      insertTool.run({
        id: randomUUID(),
        server_id: serverId,
        name: tool.name,
        description: tool.description,
        input_schema: JSON.stringify(tool.inputSchema),
        risk: tool.risk,
        cached_at: now,
      });
    }
  }

  /** 从 DB 加载缓存的 Tool */
  getCachedTools(serverId: string): MCPTool[] {
    const serverRow = this.db.prepare("SELECT name FROM mcp_servers WHERE id = ?").get(serverId) as { name: string } | undefined;
    if (!serverRow) return [];
    const rows = this.db.prepare("SELECT * FROM mcp_tools WHERE server_id = ?").all(serverId) as MCPToolRow[];
    return rows.map((r) => parseMCPToolRow(r, serverRow.name));
  }

  /** 全量 Tool 列表（带 serverName） */
  listAllTools(): MCPTool[] {
    const rows = this.db.prepare(`
      SELECT mt.*, ms.name as server_name
      FROM mcp_tools mt
      JOIN mcp_servers ms ON mt.server_id = ms.id
    `).all() as (MCPToolRow & { server_name: string })[];
    return rows.map((r) => parseMCPToolRow(r, r.server_name));
  }

  // ── 私有辅助 ──

  private buildServerList(configs: MCPServerConfig[]): MCPServer[] {
    return configs.map((c) => this.buildServer(c));
  }

  private buildServer(config: MCPServerConfig): MCPServer {
    return {
      ...config,
      status: runtimeStatus.get(config.id) ?? "stopped",
      tools: runtimeTools.get(config.id) ?? this.getCachedTools(config.id),
      errorMessage: runtimeErrors.get(config.id),
    };
  }
}
