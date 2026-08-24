import { Injectable, Inject, type OnModuleInit } from "@nestjs/common";
import { WebsocketGateway, SCHEDULED_TASK_SERVICE, type IScheduledTaskService, TaskSnapshotWatcherService } from "@lenovo/agent-sdk";
import { ChannelGatewayBridge } from "../channel/channel.bridge";
import { McpGatewayBridge } from "../mcp/mcp-bridge";
import { ScheduledTaskRunnerService } from "../scheduled-task/scheduled-task-runner.service";

/**
 * 宿主侧传输接线：把渠道(channel)和定时任务(cron)的事件接到 SDK 传输内核的广播。
 *
 * SDK 内核不认识 channel/cron，只暴露 getEmitter()。这里在内核实例化后，
 * 用它的 emitter 订阅 channelBridge 事件、设置 cron 的 emitter。
 */
@Injectable()
export class TransportWiring implements OnModuleInit {
  constructor(
    @Inject(WebsocketGateway) private readonly gateway: WebsocketGateway,
    @Inject(ChannelGatewayBridge)
    private readonly channelBridge: ChannelGatewayBridge,
    @Inject(McpGatewayBridge)
    private readonly mcpBridge: McpGatewayBridge,
    @Inject(ScheduledTaskRunnerService)
    private readonly cronRunner: ScheduledTaskRunnerService,
    @Inject(SCHEDULED_TASK_SERVICE)
    private readonly scheduledTaskService: IScheduledTaskService,
    @Inject(TaskSnapshotWatcherService)
    private readonly taskWatcher: TaskSnapshotWatcherService,
  ) {}

  onModuleInit(): void {
    const emit = this.gateway.getEmitter();
    this.channelBridge.on("wechat-qr-ready", (dataUrl?: string) => {
      emit({
        type: "channel.qrcode",
        payload: { url: dataUrl || `/api/wechat-qr?t=${Date.now()}` },
      } as any);
    });
    this.channelBridge.on("wechat-qr-warning", (message: string) => {
      emit({
        type: "channel.qrcode.warning",
        payload: { message },
      } as any);
    });
    this.channelBridge.on("wechat-qr-dismiss", () => {
      emit({ type: "channel.qrcode", payload: { url: null } } as any);
    });
    this.channelBridge.on(
      "channel-status",
      (payload: { channelId: string; status: string; error?: string }) => {
        emit({ type: "channel.status", payload } as any);
      },
    );
    // 渠道保存（含扫码成功后写 token）→ 前端 channels 数组同步更新。
    // bridge.emitChannelSaved 已 emit { channel }，此处直接透传为 payload，
    // 不可再包一层（否则前端 payload.channel 变成 {channel:{...}}，取不到 id/token）。
    this.channelBridge.on("channel-saved", (payload: { channel: any }) => {
      emit({ type: "channel.saved", payload } as any);
    });
    this.channelBridge.on("channel-message-new", (msg: any) => {
      emit({ type: "channel.message.new", payload: msg } as any);
    });
    this.channelBridge.on("channel-messages-read", (payload: any) => {
      emit({ type: "channel.message.read", payload } as any);
    });
    // 渠道 daemon 产生流式消息 → 实时推给前端渲染（绕过 history 加载）
    this.channelBridge.on("channel-stream-message", (p: { sessionId: string; message: unknown }) => {
      emit({
        type: "stream.message",
        payload: { sessionId: p.sessionId, message: p.message },
      } as any);
    });
    // 渠道 daemon 创建新 session → 转为 session.status 推给前端实时显示
    this.channelBridge.on("channel-session-update", (s: any) => {
      emit({
        type: "session.status",
        payload: {
          sessionId: s.id,
          status: s.status,
          title: s.title,
          cwd: s.cwd,
          kind: s.kind,
          channelId: s.channelId,
        },
      } as any);
    });
    this.cronRunner.setEmitter(emit);
    this.scheduledTaskService.setEmitter(emit);
    // 任务目录监听器：把 tasks.snapshot 事件接到广播
    this.taskWatcher.setEmitter(emit);

    // MCP 连接器事件桥接 → WebSocket 广播
    this.mcpBridge.on("mcp.server.list", (payload: any) => emit({ type: "mcp.server.list", payload }));
    this.mcpBridge.on("mcp.server.updated", (payload: any) => emit({ type: "mcp.server.updated", payload }));
    this.mcpBridge.on("mcp.server.deleted", (payload: any) => emit({ type: "mcp.server.deleted", payload }));
    this.mcpBridge.on("mcp.server.status", (payload: any) => emit({ type: "mcp.server.status", payload }));
    this.mcpBridge.on("mcp.server.started", (payload: any) => emit({ type: "mcp.server.started", payload } as any));
    this.mcpBridge.on("mcp.permission.request", (payload: any) => emit({ type: "mcp.permission.request", payload } as any));
  }
}
