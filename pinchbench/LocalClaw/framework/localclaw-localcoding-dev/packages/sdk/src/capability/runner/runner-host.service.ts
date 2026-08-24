import { Injectable, Inject } from "@nestjs/common";
import type { ServerEvent } from "@lenovo/agent-protocol";
import { SessionService, type Session } from "../../core/session/session.service";
import { WorkspaceService } from "../workspace/workspace.service";

/** 已注册的运行句柄：abort 杀进程；onStop 通知持有者（如 cron runner）执行已被外部停止。 */
interface RegisteredRunHandle {
  abort: () => void;
  onStop?: () => void;
}

/** @internal Runner 宿主辅助子管线，非公共契约。 */
@Injectable()
export class RunnerHostService {
  /**
   * sessionId → 运行句柄的共享注册表。
   *
   * WebsocketGateway（chat）与 ScheduledTaskRunnerService（cron）都把各自的 handle
   * 注册到这里，使「停止」操作（onSessionStop）能统一按 sessionId 找到正在运行的进程
   * 并 abort。修复点：cron 任务运行时点停止按钮无法中断的问题 —— 此前 cron 的 handle
   * 只存于其局部变量，gateway 的 stop 查不到。
   */
  private readonly runHandles = new Map<string, RegisteredRunHandle>();

  constructor(
    @Inject(SessionService) private readonly sessionService: SessionService,
    @Inject(WorkspaceService) private readonly workspaceService: WorkspaceService,
  ) {}

  /** 注册某会话的运行句柄（同一 sessionId 重复注册以最新为准）。 */
  registerRunHandle(sessionId: string, handle: RegisteredRunHandle): void {
    this.runHandles.set(sessionId, handle);
  }

  /** 注销某会话的运行句柄（幂等）。 */
  unregisterRunHandle(sessionId: string): void {
    this.runHandles.delete(sessionId);
  }

  /**
   * 停止某会话正在运行的进程：abort 杀进程 + 通知持有者（onStop），并移除注册。
   * 返回是否命中一个已注册句柄。
   */
  stopRun(sessionId: string): boolean {
    const handle = this.runHandles.get(sessionId);
    if (!handle) return false;
    this.runHandles.delete(sessionId);
    try { handle.abort(); } catch { /* ignore */ }
    try { handle.onStop?.(); } catch { /* ignore */ }
    return true;
  }

  /**
   * Builds a shared onEvent closure for both WebsocketGateway and ScheduledTaskRunnerService.
   *
   * - Records stream.message to DB.
   * - On session.status completed/error: updateSession + computeAndSaveUsageSummary + emit session.usage.
   * - On completed + emitArtifacts=true: scans workspace/generated files and emits session.diff/session.files.
   *
   * IMPORTANT: Callers must completely replace their existing onEvent with this closure.
   * Do NOT keep the original emit call alongside — that would broadcast every event twice.
   * The running status emit before runner start is NOT handled here; callers do it once before createRunner.
   */
  buildOnEvent(
    sessionId: string,
    runnerCwd: string | undefined,
    originalCwd: string | undefined,
    emit: (event: ServerEvent) => void,
    hooks?: {
      onAssistantText?: (text: string) => void;
      emitArtifacts?: boolean;
    },
  ): (event: ServerEvent) => void {
    const emitArtifacts = hooks?.emitArtifacts ?? true;

    return (event) => {
      if (event.type === "stream.message") {
        this.sessionService.recordMessage(sessionId, event.payload.message);
        if (hooks?.onAssistantText) {
          const msg = event.payload.message as any;
          if (msg?.type === "assistant" && Array.isArray(msg?.message?.content)) {
            for (const block of msg.message.content) {
              if (block?.type === "text" && typeof block.text === "string") {
                hooks.onAssistantText(block.text);
              }
            }
          }
        }
      }

      // Prevent workspace dir from leaking to frontend — always show original cwd
      let emitEvent = event;
      if (event.type === "session.status" && runnerCwd !== originalCwd && event.payload.cwd) {
        emitEvent = { ...event, payload: { ...event.payload, cwd: originalCwd } };
      }

      if (event.type === "session.status") {
        this.sessionService.updateSession(sessionId, { status: event.payload.status });
        if (event.payload.status === "completed" || event.payload.status === "error") {
          try {
            const summary = this.sessionService.computeAndSaveUsageSummary(sessionId);
            emit({ type: "session.usage", payload: { sessionId, summary } });
          } catch { /* ignore */ }
          if (event.payload.status === "completed" && emitArtifacts) {
            this.emitPostSessionArtifacts(sessionId, emit).catch(() => {});
          }
        }
      }

      emit(emitEvent);
    };
  }

  buildOnSessionUpdate(sessionId: string): (updates: Partial<Session>) => void {
    return (updates) => this.sessionService.updateSession(sessionId, updates);
  }

  private async emitPostSessionArtifacts(sessionId: string, emit: (e: ServerEvent) => void): Promise<void> {
    const session = this.sessionService.getSession(sessionId);
    const cwd = session?.cwd;
    if (!cwd) return;
    try {
      const startTime = Date.now() - 60000;
      const files = await this.workspaceService.scanGeneratedFiles(cwd, startTime);
      if (files.length > 0) emit({ type: "session.files", payload: { sessionId, sessionWorkDir: cwd, files } } as any);
    } catch { /* ignore */ }
  }
}
