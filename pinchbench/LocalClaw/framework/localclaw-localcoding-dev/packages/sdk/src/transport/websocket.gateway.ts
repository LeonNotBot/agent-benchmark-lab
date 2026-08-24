import { logger } from "../util/logger";
import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
} from "@nestjs/websockets";
import { Inject, Optional } from "@nestjs/common";
import { Server, WebSocket } from "ws";
import type {
  ClientEvent,
  ServerEvent,
  Attachment,
  SmartHybridConfig,
} from "@lenovo/agent-protocol";
import { SessionService } from "../core/session/session.service";
import { FileChangeService } from "../core/session/file-change.service";
import { RunnerService } from "../capability/runner/runner.service";
import { RunnerHostService } from "../capability/runner/runner-host.service";
import { RoutingService } from "../capability/routing/routing.service";
import { SmartHybridService } from "../capability/routing/smart-hybrid.service";
import { WorkspaceService } from "../capability/workspace/workspace.service";
import {
  SCHEDULED_TASK_SERVICE,
  type IScheduledTaskService,
} from "../capability/scheduled-task/scheduled-task.service";
import type { PersistedAttachmentContext } from "../util/attachment-context";
import {
  SESSION_START_CONTRIBUTORS,
  WS_EVENT_HANDLERS,
  type SessionStartContributor,
  type WsEventHandler,
  type SessionStartPayload,
} from "./contracts";

const WEBSOCKET_MAX_PAYLOAD_BYTES = 256 * 1024 * 1024;
/** 心跳间隔：每 30s 向所有 client 发 ping，检测死连接。 */
const HEARTBEAT_INTERVAL_MS = 30_000;

/**
 * SDK 通用 WebSocket 传输内核。
 *
 * 职责：连接管理 / 心跳 / 广播 + 标准会话(session.*)、路由(routing.*)、模型(model.*)事件。
 * 这些只依赖 SDK 自有能力，不认识任何宿主业务。
 *
 * 宿主业务通过两个扩展点接入（见 contracts.ts）：
 * - SESSION_START_CONTRIBUTORS：参与 session.start 编排（模板等）。
 * - WS_EVENT_HANDLERS：处理内核不认识的事件（语音等）。
 * 宿主还可用 getEmitter() 把渠道/定时任务的事件接到广播。
 */
@WebSocketGateway({ path: "/ws", maxPayload: WEBSOCKET_MAX_PAYLOAD_BYTES })
export class WebsocketGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit
{
  @WebSocketServer()
  server!: Server;

  private clients = new Set<WebSocket>();
  private heartbeatTimer?: NodeJS.Timeout;

  constructor(
    @Inject(SessionService) private readonly sessionService: SessionService,
    @Inject(RunnerService) private readonly runnerService: RunnerService,
    @Inject(RoutingService) private readonly routingService: RoutingService,
    @Inject(FileChangeService)
    private readonly fileChangeService: FileChangeService,
    @Inject(WorkspaceService)
    private readonly workspaceService: WorkspaceService,
    @Inject(RunnerHostService)
    private readonly runnerHostService: RunnerHostService,
    @Inject(SmartHybridService)
    private readonly smartHybrid: SmartHybridService,
    @Optional()
    @Inject(SESSION_START_CONTRIBUTORS)
    private readonly contributors: SessionStartContributor[] = [],
    @Optional()
    @Inject(WS_EVENT_HANDLERS)
    private readonly eventHandlers: WsEventHandler[] = [],
    @Optional()
    @Inject(SCHEDULED_TASK_SERVICE)
    private readonly scheduledTaskService: IScheduledTaskService | null = null,
  ) {}

  /** 暴露广播器：宿主把渠道/定时任务的事件接到这里。 */
  getEmitter(): (event: ServerEvent) => void {
    return (event) => this.emit(event);
  }

  private handleClientEvent(event: ClientEvent): void {
    switch (event.type) {
      case "session.start":
        this.onSessionStart(event.payload as SessionStartPayload);
        break;
      case "session.continue":
        this.onSessionContinue(event.payload);
        break;
      case "session.stop":
        this.onSessionStop(event.payload.sessionId);
        break;
      case "session.delete":
        this.onSessionDelete(event.payload.sessionId);
        break;
      case "session.prewarm":
        this.onSessionPrewarm(event.payload);
        break;
      case "permission.response":
        this.onPermissionResponse(event.payload);
        break;
      case "routing.preference":
        this.onRoutingPreference(event.payload);
        break;
      default:
        // 内核不认识的事件类型 → 派发给宿主注册的 handler（如 speech.recognize）。
        this.dispatchToHostHandler(event);
        break;
    }
  }

  /** 把内核不处理的事件派发给宿主 WsEventHandler。 */
  private dispatchToHostHandler(event: ClientEvent): void {
    const handler = this.eventHandlers.find((h) => h.type === event.type);
    if (!handler) return;
    const payload = (event as { payload?: unknown }).payload;
    Promise.resolve(handler.handle(payload, (e) => this.emit(e))).catch(
      (err) => {
        logger.error(
          `[websocket] host handler for "${event.type}" failed:`,
          err,
        );
      },
    );
  }

  /** WebSocket 服务器初始化后启动心跳定时器。 */
  afterInit(): void {
    this.heartbeatTimer = setInterval(() => {
      for (const client of this.clients) {
        if ((client as any).__isAlive === false) {
          logger.warn("[websocket] terminating unresponsive client");
          this.clients.delete(client);
          client.terminate();
          continue;
        }
        (client as any).__isAlive = false;
        client.ping();
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify({ type: "ping" }));
        }
      }
    }, HEARTBEAT_INTERVAL_MS);
    if (this.heartbeatTimer.unref) this.heartbeatTimer.unref();
  }

  handleConnection(client: WebSocket): void {
    (client as any).__isAlive = true;
    client.on("pong", () => {
      (client as any).__isAlive = true;
    });
    this.clients.add(client);
    logger.log(
      "[websocket] client connected, total clients:",
      this.clients.size,
    );
    client.on("message", (data) => {
      try {
        const event = JSON.parse(String(data)) as ClientEvent;
        this.handleClientEvent(event);
      } catch (error) {
        this.emit({
          type: "runner.error",
          payload: { message: `Invalid message: ${String(error)}` },
        });
      }
    });
    this.emit({
      type: "device.capabilities",
      payload: this.routingService.getCapabilities(),
    });
  }

  handleDisconnect(client: WebSocket): void {
    this.clients.delete(client);
  }

  private broadcast(event: ServerEvent): void {
    const data = JSON.stringify(event);
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(data);
    }
  }

  private emit(event: ServerEvent): void {
    this.broadcast(event);
  }

  // ── Routing / Model 事件 ──────────────────────────────────────

  private onRoutingPreference(payload: {
    preference: string;
    modelOverride?: string;
    smartHybridConfig?: any;
    endpointId?: string;
  }): void {
    // 全局 preference 只写自己的存储（服务于渠道/cron 等无 UI 路径的兜底，见 resolvePref）。
    // 绝不因全局开关变化去清理会话级 CLAUDE.md 注入块——块的生死完全由会话租约管理
    // （prepareSessionCwd/releaseIfHeld，删会话/切单模型/onModuleDestroy 触发）。
    // 级联配置铁律：上层（global）只提供 fallback，下层（session）显式设置即接管，
    // 上层操作永不物理改写下层状态。
    this.routingService.setPreference({
      preference: payload.preference as any,
      modelOverride: payload.modelOverride,
      smartHybridConfig: payload.smartHybridConfig,
      endpointId: payload.endpointId,
    });
  }

  // ── Session 事件 ──────────────────────────────────────────────

  private async onSessionStart(payload: SessionStartPayload): Promise<void> {
    // 启动贡献者：createSession 前收集路由覆盖（同步、顺序确定，无竞态）。
    let routingOverride;
    for (const c of this.contributors) {
      const o = c.contributeRouting?.(payload);
      if (o) routingOverride = o;
    }
    const session = this.sessionService.createSession({
      cwd: payload.cwd,
      allowedTools: payload.allowedTools,
      prompt: payload.prompt,
      title: payload.title,
      routingOverride,
      // 用户没选项目（!payload.cwd）→ 下面会自动建会话目录并写回 cwd。标记 autoCwd，
      // 使这类目录不进项目选择列表（listRecentCwds 据此过滤）。显式选目录一律 false。
      autoCwd: !payload.cwd,
    });
    this.sessionService.recordMessage(session.id, {
      type: "user_prompt",
      prompt: payload.prompt,
      attachments: payload.attachments as Attachment[] | undefined,
    });

    const effectiveCwd = payload.cwd ?? null;
    if (!payload.cwd) {
      try {
        const sessionDir = await this.workspaceService.ensureSessionDir(
          session.id,
          session.title,
        );
        this.sessionService.updateSession(session.id, { cwd: sessionDir });
      } catch (e) {
        logger.warn("[workspace] Failed to create session dir:", e);
      }
    }

    this.emit({
      type: "session.status",
      payload: {
        sessionId: session.id,
        status: "running",
        title: session.title,
        cwd: session.cwd,
      },
    });
    this.sessionService.updateSession(session.id, { status: "running" });
    if (effectiveCwd)
      this.fileChangeService.takeSnapshot(session.id, effectiveCwd);

    // 启动贡献者：createSession 后、startRunner 前跑副作用（如写 CLAUDE.md）。
    const liveSession = this.sessionService.getSession(session.id) ?? session;
    for (const c of this.contributors) {
      await c.afterSessionCreated?.(liveSession, payload);
    }

    const attachmentContext = await this.persistAttachmentsForSession(
      session.id,
      session.title,
      payload.attachments as Attachment[] | undefined,
    );
    this.startRunner(
      session.id,
      payload.prompt,
      undefined,
      payload.attachments as Attachment[] | undefined,
      effectiveCwd ?? undefined,
      attachmentContext,
      payload.permissionMode as string | undefined,
      payload.model as string | undefined,
      payload.endpointId as string | undefined,
      payload.smartHybrid as SmartHybridConfig | undefined,
    );
    this.sessionService
      .generateSessionTitle(payload.prompt)
      .then((title) => {
        const updated = this.sessionService.updateSession(session.id, { title });
        const status = updated?.status ?? "running";
        this.emit({
          type: "session.status",
          payload: { sessionId: session.id, status, title },
        });
      })
      .catch(() => {});
  }

  private async onSessionContinue(payload: {
    sessionId: string;
    prompt: string;
    attachments?: Attachment[];
    permissionMode?: string;
    model?: string;
    endpointId?: string;
    smartHybrid?: SmartHybridConfig;
  }): Promise<void> {
    const session = this.sessionService.getSession(payload.sessionId);
    if (!session) {
      this.emit({
        type: "runner.error",
        payload: { sessionId: payload.sessionId, message: "Session not found" },
      });
      return;
    }
    this.sessionService.recordMessage(session.id, {
      type: "user_prompt",
      prompt: payload.prompt,
      attachments: payload.attachments,
    });
    this.emit({
      type: "stream.user_prompt",
      payload: {
        sessionId: session.id,
        prompt: payload.prompt,
        attachments: payload.attachments,
      },
    });
    this.sessionService.updateSession(session.id, {
      status: "running",
      lastPrompt: payload.prompt,
    });
    const effectiveCwd = session.cwd;
    if (effectiveCwd)
      this.fileChangeService.takeSnapshot(session.id, effectiveCwd);
    this.emit({
      type: "session.status",
      payload: { sessionId: session.id, status: "running", title: session.title },
    });
    const attachmentContext = await this.persistAttachmentsForSession(
      session.id,
      session.title,
      payload.attachments,
    );
    this.startRunner(
      session.id,
      payload.prompt,
      session.claudeSessionId,
      payload.attachments,
      effectiveCwd,
      attachmentContext,
      payload.permissionMode,
      payload.model,
      payload.endpointId,
      payload.smartHybrid,
    );
  }

  private onSessionStop(sessionId: string): void {
    const session = this.sessionService.getSession(sessionId);
    if (!session) return;
    // 统一从共享注册表停止：覆盖 chat 与 cron 两条运行路径。
    this.runnerHostService.stopRun(sessionId);
    session.abortController?.abort();
    const stoppedMsg = { type: "session_stopped" as const, at: Date.now() };
    this.sessionService.recordMessage(sessionId, stoppedMsg);
    this.sessionService.updateSession(sessionId, { status: "idle" });
    this.emit({ type: "stream.message", payload: { sessionId, message: stoppedMsg } });
    this.emit({
      type: "session.status",
      payload: { sessionId, status: "idle", title: session.title },
    });
  }

  private onSessionDelete(sessionId: string): void {
    this.onSessionStop(sessionId);
    // 级联兜底：删掉绑定到此会话的 conversation 类型定时任务，避免悬空 boundSessionId。
    // @Optional 注入 —— 宿主未装配定时任务能力时跳过，不破坏 gateway 的宿主无关性。
    // service.delete() 内部会各自广播 scheduled.deleted，前端自动化面板据此同步。
    if (this.scheduledTaskService) {
      try {
        for (const task of this.scheduledTaskService.list()) {
          if (task.boundSessionId === sessionId) {
            this.scheduledTaskService.delete(task.id);
          }
        }
      } catch (e) {
        logger.warn(`[ws] cascade delete bound tasks failed: ${String(e)}`);
      }
    }
    // 释放该会话的 SH 租约（若有），避免 CLAUDE.md 注入块残留
    this.smartHybrid.releaseIfHeld(sessionId);
    this.sessionService.deleteSession(sessionId);
    this.emit({ type: "session.deleted", payload: { sessionId } });
  }

  /**
   * 预热：用户聚焦/切到某个已存在会话 tab 时触发，提前 spawn CLI 进程到就绪态。
   * 尽力而为：会话不存在 / 正在运行 / 预热失败都静默跳过——预热失败只是退化为
   * 用户发消息时再冷启动，不影响正确性，绝不打扰用户。
   */
  private onSessionPrewarm(payload: {
    sessionId: string;
    model?: string;
    endpointId?: string;
    smartHybrid?: any;
    permissionMode?: string;
  }): void {
    const session = this.sessionService.getSession(payload.sessionId);
    if (!session) return;
    // 已在运行：进程已存在，无需预热
    if (session.status === "running") return;
    void this.runnerService.prewarmRunner({
      prompt: "",
      session,
      onEvent: () => { /* prewarm: no events to client */ },
      permissionMode: payload.permissionMode,
      modelOverride: payload.model,
      endpointId: payload.endpointId,
      smartHybrid: payload.smartHybrid,
    });
  }

  private onPermissionResponse(payload: {
    sessionId: string;
    toolUseId: string;
    result: { behavior: "allow" | "deny"; updatedInput?: unknown; message?: string };
    dontAskAgain?: boolean;
  }): void {
    const session = this.sessionService.getSession(payload.sessionId);
    if (!session) return;
    const pending = session.pendingPermissions.get(payload.toolUseId);
    // 「本次会话不再询问」：把该工具加入会话级放行集合，后续同名工具调用 auto-allow。
    // sessionAllowedTools 在 session 构造时已预初始化（引用稳定，与 runner 读到的副本共享），
    // 故此处直接 add，不再懒创建（懒创建会替换引用、破坏共享）。
    if (payload.dontAskAgain && pending) {
      session.sessionAllowedTools?.add(pending.toolName);
    }
    if (pending) pending.resolve(payload.result);
  }

  private async startRunner(
    sessionId: string,
    prompt: string,
    resumeSessionId?: string,
    attachments?: Attachment[],
    effectiveCwd?: string,
    attachmentContext?: PersistedAttachmentContext | null,
    permissionMode?: string,
    modelOverride?: string,
    endpointId?: string,
    smartHybrid?: SmartHybridConfig,
  ): Promise<void> {
    const session = this.sessionService.getSession(sessionId);
    if (!session) return;
    await this.workspaceService.ensureAttachmentTextSidecars(
      session.id,
      session.title,
    );
    const runnerCwd = effectiveCwd ?? session.cwd;
    const onEvent = this.runnerHostService.buildOnEvent(
      sessionId,
      runnerCwd,
      session.cwd,
      (e) => this.emit(e),
      { emitArtifacts: true },
    );
    const onSessionUpdate =
      this.runnerHostService.buildOnSessionUpdate(sessionId);
    try {
      // 扩展 session 对象时必须保留运行时状态（sessionAllowedTools、pendingPermissions），
      // 否则「本次会话不再询问」功能失效——权限响应写入原始 session，runner 读副本读不到。
      const sessionWithCwd = runnerCwd
        ? {
            ...session,
            cwd: runnerCwd,
            sessionAllowedTools: session.sessionAllowedTools,
            pendingPermissions: session.pendingPermissions,
          }
        : session;
      const { handle } = await this.runnerService.createRunner({
        prompt,
        session: sessionWithCwd,
        resumeSessionId,
        attachments,
        attachmentContext,
        onEvent,
        onSessionUpdate,
        permissionMode,
        modelOverride,
        endpointId,
        smartHybrid,
      });
      this.runnerHostService.registerRunHandle(sessionId, { abort: handle.abort });
    } catch (error) {
      this.sessionService.updateSession(sessionId, { status: "error" });
      this.emit({
        type: "runner.error",
        payload: { sessionId, message: `Runner failed: ${String(error)}` },
      });
    }
  }

  private async persistAttachmentsForSession(
    sessionId: string,
    title: string,
    attachments?: Attachment[],
  ): Promise<PersistedAttachmentContext | null> {
    if (!attachments?.length) return null;
    try {
      return await this.workspaceService.persistAttachments(
        sessionId,
        title,
        attachments,
      );
    } catch (error) {
      logger.warn(
        `[attachments] Failed to persist attachments for session ${sessionId}:`,
        error,
      );
      return null;
    }
  }
}
