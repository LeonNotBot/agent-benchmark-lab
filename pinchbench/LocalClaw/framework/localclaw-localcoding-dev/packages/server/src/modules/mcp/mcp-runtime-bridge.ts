/**
 * MCP Runtime 桥接：MCP Server Manager ↔ McpService。
 * 真正负责 spawn/kill MCP Server 进程，并把状态/工具回写 service。
 */
import { Injectable, OnModuleInit, OnModuleDestroy, Inject } from "@nestjs/common";
import { MCPServerManager } from "@lenovo/agent-sdk";
import { McpService } from "./mcp.service";

@Injectable()
export class McpRuntimeBridge implements OnModuleInit, OnModuleDestroy {
  private readonly manager: MCPServerManager;

  constructor(
    @Inject(McpService) private readonly service: McpService,
    manager?: MCPServerManager,
  ) {
    this.manager = manager ?? new MCPServerManager();
  }

  /**
   * App 启动时，对配置完整（重启后置为 starting）的 server 后台重新探活。
   *
   * ⚠️ 关键：绝不能 await 探活完成。NestJS 在所有 onModuleInit resolve 后才
   * app.listen()，若在此 await 串行探活（每个 stdio 探活超时 120s），server 将迟迟
   * 不监听端口，electron 健康检查超时 → 整个 app 启动失败。故 fire-and-forget：
   * onModuleInit 立即返回，探活在后台**并行**跑，状态经 WebSocket 推送给前端。
   *
   * 并行优于串行：队头一个 server 挂住（如 npx 下载卡死 120s）不会阻塞它之后的
   * 所有 server 探活，每个 server 独立超时，各自独立推送——UI 能陆续收到各 server
   * 的终态，而非永停在队头的 starting。
   */
  onModuleInit(): void {
    void this.probeStartingServers();
  }

  /** 后台并行探活所有 starting 态 server（不阻塞启动，互不阻塞）。 */
  private async probeStartingServers(): Promise<void> {
    const servers = this.service.listServers();
    const probePromises = servers
      .filter((s) => s.status === "starting")
      .map((s) => this.startServer(s.id).catch(() => { /* 单个失败不影响其他 */ }));
    if (probePromises.length === 0) return;
    await Promise.all(probePromises);
    // 权威收敛广播：探活全部结束后，再推一次带完整终态的全量列表。
    // 必要性——前端有两个数据源在赛跑：WS 增量 status 事件 + AppShell 的 HTTP list fetch。
    // 二者到达顺序不定，且 fetch 命中后端的瞬间多数 server 还在 starting，那份过期快照
    // 可能晚于 status 事件覆盖、或早于 status 事件落库（status 遍历空列表被丢）。
    // 这次「所有探活结束后」的全量广播是最后一个事件，携带全部终态完整对象，
    // 配合前端「list 不回退已落定状态」的合并逻辑，无论前面如何乱序都能收敛到正确终态。
    this.service.emitServerList();
  }

  /** 预览工具：spawn 进程 → 拉取 tools → 缓存 → 停掉预览进程，状态回到「已启用」。
   *  预览仅为在 UI 查看工具列表，不保留持久运行态（Agent 的 MCP 由 CLI 独立管理）。 */
  async startServer(serverId: string): Promise<void> {
    const server = this.service.getServer(serverId);
    if (!server) return;

    this.service.setServerStatus(serverId, "starting");
    try {
      await this.manager.startServer(server);
      const inst = this.manager.getServer(serverId);
      const tools = inst?.tools ?? [];
      this.service.cacheTools(serverId, tools);
      // 拉完即停：预览进程使命完成，不停留在 running。
      this.manager.stopServer(serverId);
      // 就绪判定：握手成功且工具数 >0 才算「已验证·已启用」；否则报错。
      const finalStatus = tools.length > 0 ? "installed" : "error";
      const finalError = tools.length > 0 ? undefined : "启动成功但未暴露任何工具，可能不兼容当前客户端";
      this.service.setServerStatus(serverId, finalStatus, finalError);
      // 探活完成后再次 emit，带上最新 tools，让前端能收到完整数据。
      const updatedServer = this.service.getServer(serverId);
      if (updatedServer && this.service.bridgeReady) {
        this.service.emitServerUpdated(updatedServer);
      }
    } catch (err) {
      this.service.setServerStatus(serverId, "error", String(err));
    }
  }

  /** 停止 Server */
  stopServer(serverId: string): void {
    this.manager.stopServer(serverId);
    this.service.setServerStatus(serverId, "stopped");
  }

  /** 调用 Tool */
  async callTool(serverId: string, toolName: string, args: Record<string, unknown>): Promise<unknown> {
    return this.manager.callTool(serverId, toolName, args);
  }

  onModuleDestroy(): void {
    this.manager.stopAll();
  }
}
