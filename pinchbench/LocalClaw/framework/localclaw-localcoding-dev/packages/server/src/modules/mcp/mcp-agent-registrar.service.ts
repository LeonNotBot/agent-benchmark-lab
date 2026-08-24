/**
 * MCP Agent 注册器：把连接器中配置的 MCP Server 同步进隔离目录 .claude.json
 * 的 mcpServers 字段，使其进入 Claude CLI（Agent）的工具面。
 *
 * 真正的 Agent 是 LocalClaw spawn 的 Claude CLI 进程，它从 CLAUDE_CONFIG_DIR
 * 下 .claude.json 的【顶层 mcpServers】读取配置并自行 spawn / 路由
 * mcp__<server>__<tool> 工具调用。本服务负责把数据库中的 MCP 配置投影到该文件。
 *
 * 仅操作本服务托管的键（记录在 .claude.json 的 mcpServersManaged），保留 cron-tools
 * 等其它键。同时一次性清理历史误写入 settings.json 的托管键。
 */
import { Injectable, OnModuleInit, OnModuleDestroy, Inject, Logger } from "@nestjs/common";
import {
  readClaudeConfigJson,
  writeClaudeConfigJson,
  readAgentSettings,
  writeAgentSettings,
  isMcpServerAgentEnabled,
  type ClaudeConfigJson,
  type MCPServer,
} from "@lenovo/agent-sdk";
import { McpService } from "./mcp.service";
import { McpGatewayBridge } from "./mcp-bridge";

/** CLI mcpServers 条目（stdio / sse / http 三态）。 */
type CliMcpEntry =
  | { command: string; args?: string[]; env?: Record<string, string> }
  | { type: "sse"; url: string; headers?: Record<string, string> }
  | { type: "http"; url: string; headers?: Record<string, string> };

@Injectable()
export class McpAgentRegistrarService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(McpAgentRegistrarService.name);
  private readonly onMutated = (): void => this.safeSync();

  constructor(
    @Inject(McpService) private readonly service: McpService,
    @Inject(McpGatewayBridge) private readonly bridge: McpGatewayBridge,
  ) {}

  onModuleInit(): void {
    this.bridge.on("mcp.server.updated", this.onMutated);
    this.bridge.on("mcp.server.deleted", this.onMutated);
    this.safeSync();
  }

  onModuleDestroy(): void {
    this.bridge.off("mcp.server.updated", this.onMutated);
    this.bridge.off("mcp.server.deleted", this.onMutated);
  }

  private safeSync(): void {
    try {
      this.syncAll();
    } catch (e) {
      this.logger.error(`[mcp-agent-registrar] sync failed: ${String(e)}`);
    }
  }

  /** 全量重建托管键：删旧托管键 → 写当前 server → 记录新托管键。幂等。 */
  syncAll(): void {
    const config = readClaudeConfigJson();
    const managedKeys = Array.isArray(config.mcpServersManaged)
      ? (config.mcpServersManaged as string[])
      : [];
    const mcpServers: Record<string, unknown> =
      config.mcpServers && typeof config.mcpServers === "object"
        ? { ...(config.mcpServers as Record<string, unknown>) }
        : {};

    // 1. 清理上一轮托管键（重命名/删除遗留、跨重启陈旧项）。
    for (const k of managedKeys) delete mcpServers[k];

    // 2. 重建当前托管键。
    const newManaged: string[] = [];
    for (const server of this.service.listServers()) {
      const entry = this.mapToCliEntry(server);
      if (!entry) continue;
      const key = this.uniqueKey(server, mcpServers);
      mcpServers[key] = entry;
      newManaged.push(key);
    }

    // 3. 写回 .claude.json（CLI 真正读取的文件）。
    const next: ClaudeConfigJson = {
      ...config,
      mcpServers,
      mcpServersManaged: newManaged,
    };
    writeClaudeConfigJson(next);

    // 4. 一次性清理历史误写入 settings.json 的托管键（终态：MCP 配置只存在于 .claude.json）。
    this.cleanupLegacySettings();

    this.logger.log(
      `[mcp-agent-registrar] synced ${newManaged.length} MCP server(s) to .claude.json: ${newManaged.join(", ") || "(none)"}`,
    );
  }

  /**
   * 清理早期版本误写入 settings.json 的 MCP 托管键与 mcpServersManaged 标记。
   * 幂等：无残留则不写文件。不触碰 settings.json 其它字段。
   */
  private cleanupLegacySettings(): void {
    const settings = readAgentSettings();
    const legacyServers =
      settings.mcpServers && typeof settings.mcpServers === "object"
        ? (settings.mcpServers as Record<string, unknown>)
        : null;
    const legacyManaged = Array.isArray(settings.mcpServersManaged)
      ? (settings.mcpServersManaged as string[])
      : [];
    if (!legacyServers && legacyManaged.length === 0) return;

    let changed = false;
    if (legacyServers) {
      for (const k of legacyManaged) {
        if (k in legacyServers) {
          delete legacyServers[k];
          changed = true;
        }
      }
    }
    if ("mcpServersManaged" in settings) {
      delete settings.mcpServersManaged;
      changed = true;
    }
    if (changed) writeAgentSettings(settings);
  }

  /** 配置 → CLI 条目。不会被 Agent 加载（缺必需字段）返回 null（跳过）。 */
  private mapToCliEntry(server: MCPServer): CliMcpEntry | null {
    // 与 onModuleInit 初始状态判定同源：不会被加载则不投影。
    if (!isMcpServerAgentEnabled(server)) return null;
    if (server.type === "stdio") {
      const command = server.command;
      if (!command) return null;
      const entry: { command: string; args?: string[]; env?: Record<string, string> } = { command };
      if (server.args && server.args.length > 0) entry.args = server.args;
      if (server.env && Object.keys(server.env).length > 0) entry.env = server.env;
      return entry;
    }
    const url = server.url;
    if (!url) return null;
    const transport = server.type === "sse" ? "sse" : "http";
    const entry: { type: "sse" | "http"; url: string; headers?: Record<string, string> } = {
      type: transport,
      url,
    };
    if (server.headers && Object.keys(server.headers).length > 0) {
      entry.headers = server.headers;
    }
    return entry;
  }

  /** sanitize server name 为键；重名追加 id 短片段。 */
  private uniqueKey(server: MCPServer, taken: Record<string, unknown>): string {
    const base = (server.name || server.id).replace(/[^a-zA-Z0-9_-]/g, "_") || "mcp";
    if (!(base in taken)) return base;
    return `${base}-${server.id.slice(0, 6)}`;
  }
}
