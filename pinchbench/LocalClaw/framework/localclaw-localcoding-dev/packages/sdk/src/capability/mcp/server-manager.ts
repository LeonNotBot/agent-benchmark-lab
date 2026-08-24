/**
 * MCP Server Manager：管理多个 MCP Server 连接生命周期。
 * @module @lenovo/agent-sdk / capability / mcp / server-manager
 * @internal
 */
import { logger } from "../../util/logger";
import { getAgentHomeDir } from "../../config/paths";
import { StdioTransport } from "./transport/stdio";
import type {
  MCPServer,
  MCPServerConfig,
  MCPTool,
  MCPToolRisk,
  StdioTransportOptions,
} from "./types";

/** Server 运行时实例 */
interface ServerInstance {
  config: MCPServerConfig;
  transport: StdioTransport;
  tools: MCPTool[];
  status: MCPServer["status"];
  errorMessage?: string;
}

/** MCP Server Manager：管理 stdio/sse/http Server 生命周期。 */
export class MCPServerManager {
  private servers = new Map<string, ServerInstance>();

  get allTools(): MCPTool[] {
    const tools: MCPTool[] = [];
    for (const inst of this.servers.values()) {
      tools.push(...inst.tools);
    }
    return tools;
  }

  getTool(serverId: string, toolName: string): MCPTool | undefined {
    return this.servers.get(serverId)?.tools.find((t) => t.name === toolName);
  }

  getServer(serverId: string): ServerInstance | undefined {
    return this.servers.get(serverId);
  }

  listServerIds(): string[] {
    return [...this.servers.keys()];
  }

  /** 启动 Server */
  async startServer(config: MCPServerConfig): Promise<void> {
    const existing = this.servers.get(config.id);
    if (existing) {
      if (existing.status === "running" || existing.status === "starting") {
        logger.warn(`[MCPServerManager] server already running: ${config.id}`);
        return;
      }
      // error / stopped 残留 instance：清理旧 transport 后重建，支持失败重试
      this.stopServer(config.id);
    }

    if (config.type !== "stdio") {
      // TODO: sse / streamable_http support
      throw new Error(`[MCPServerManager] transport type "${config.type}" not yet supported`);
    }

    const transport = new StdioTransport();
    const instance: ServerInstance = {
      config,
      transport,
      tools: [],
      status: "starting",
    };
    this.servers.set(config.id, instance);

    try {
      const opts: StdioTransportOptions = {
        command: config.command!,
        args: config.args,
        env: config.env,
        // 干净 cwd：避免 npx 在 pnpm monorepo 根目录触发 arborist 扫描 node_modules 崩溃
        // （Cannot read properties of null reading 'package'）。getAgentHomeDir 非 monorepo、无 node_modules。
        cwd: getAgentHomeDir(),
      };
      await transport.spawn(opts);
      instance.status = "running";

      // 拉取 tools/list
      await this.refreshTools(config.id);

      logger.log(`[MCPServerManager] started server: ${config.name} (${config.id}), tools: ${instance.tools.length}`);
    } catch (err) {
      instance.status = "error";
      instance.errorMessage = String(err);
      logger.error(`[MCPServerManager] failed to start server ${config.id}:`, err);
      throw err;
    }
  }

  /** 停止 Server */
  stopServer(serverId: string): void {
    const inst = this.servers.get(serverId);
    if (!inst) return;
    inst.transport.close();
    inst.status = "stopped";
    inst.tools = [];
    this.servers.delete(serverId);
    logger.log(`[MCPServerManager] stopped server: ${serverId}`);
  }

  /** 停止全部 Server */
  stopAll(): void {
    for (const id of [...this.servers.keys()]) {
      this.stopServer(id);
    }
  }

  /** 调用 Tool */
  async callTool(
    serverId: string,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    const inst = this.servers.get(serverId);
    if (!inst) throw new Error(`[MCPServerManager] server not found: ${serverId}`);
    if (inst.status !== "running") throw new Error(`[MCPServerManager] server not running: ${serverId}`);

    const tool = inst.tools.find((t) => t.name === toolName);
    if (!tool) throw new Error(`[MCPServerManager] tool not found: ${toolName} on server ${serverId}`);

    const res = await inst.transport.send({
      jsonrpc: "2.0",
      method: "tools/call",
      params: {
        name: toolName,
        arguments: args,
      },
    });

    if (res.error) throw new Error(`[MCPServerManager] tool call error: ${res.error.message}`);
    return res.result;
  }

  /** 重新获取 Server 的 Tool 列表 */
  private async refreshTools(serverId: string): Promise<void> {
    const inst = this.servers.get(serverId);
    if (!inst) return;

    try {
      const res = await inst.transport.send({
        jsonrpc: "2.0",
        method: "tools/list",
      });

      const result = (res.result as { tools?: unknown[] }) ?? {};
      const rawTools = (result.tools ?? []) as Array<{
        name: string;
        description?: string;
        inputSchema?: { properties?: Record<string, unknown> };
      }>;

      inst.tools = rawTools.map((t) => ({
        name: t.name,
        description: t.description ?? "",
        inputSchema: t.inputSchema ?? {},
        serverId,
        serverName: inst.config.name,
        risk: this.inferRisk(t.name),
      }));
    } catch (err) {
      logger.warn(`[MCPServerManager] failed to list tools for ${serverId}:`, err);
    }
  }

  /**
   * 根据 Tool 名称静态推断风险等级。
   * 后续可由用户配置覆盖。
   */
  private inferRisk(name: string): MCPToolRisk {
    const dangerKeywords = ["delete", "remove", "destroy", "exec", "run", "write", "create", "update", "edit", "patch"];
    const writeKeywords = ["post", "put", "send", "add", "insert", "submit", "publish", "comment"];
    const lower = name.toLowerCase();
    if (dangerKeywords.some((k) => lower.includes(k))) return "danger";
    if (writeKeywords.some((k) => lower.includes(k))) return "write";
    return "read";
  }
}
