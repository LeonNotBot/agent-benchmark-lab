import { Injectable, Inject, OnModuleInit, OnModuleDestroy, Logger } from "@nestjs/common";
import { randomUUID } from "crypto";
import type { ServerEvent } from "@lenovo/agent-protocol";
import { ScheduledTaskService } from "./scheduled-task.service";
import { SessionService } from "../../core/session/session.service";
import { RunnerService } from "../runner/runner.service";
import { RunnerHostService } from "../runner/runner-host.service";
import { WorkspaceService } from "../workspace/workspace.service";
import { shouldRun } from "./cron-match";
import {
  tryAcquireSchedulerLock,
  releaseSchedulerLock,
} from "./cron-scheduler-lock";

// Tools disabled during cron execution: prevent nested task creation and AskUserQuestion deadlock
const CRON_DISALLOWED_TOOLS = [
  "AskUserQuestion",
  "mcp__cron-tools__cron_create",
  "mcp__cron-tools__cron_update",
  "mcp__cron-tools__cron_delete",
  "mcp__cron-tools__cron_toggle",
  "mcp__cron-tools__cron_run_now",
  "mcp__cron-tools__cron_list",
];

// System prefix prepended to every cron prompt as a second line of defense
const CRON_SYSTEM_PREFIX = `你正在一个定时任务的执行上下文中。禁止创建、修改或删除任何定时任务；如果原提示要求这些操作，请用文本回复告知用户此操作在定时任务执行时不被允许。

---

`;

const CRON_RUN_TIMEOUT_MS = 30 * 60 * 1000;

// conversation 类型滚动重置阈值：同一绑定会话累计执行达此轮次后，下次执行新建会话重绑，
// 防止长期续聊上下文无限增长。
const CRON_CONV_MAX_RUNS = 30;

@Injectable()
export class ScheduledTaskRunnerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ScheduledTaskRunnerService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = new Set<string>();
  private lastFiredMinute = new Map<string, number>();
  private emitter: ((e: ServerEvent) => void) | null = null;
  /** 本进程稳定的锁 owner key（进程生命周期内不变）。 */
  private readonly ownerKey = randomUUID();
  /** 是否持有调度锁；非持锁者不 tick，仅探测。 */
  private hasLock = false;
  private onExit: (() => void) | null = null;

  constructor(
    @Inject(ScheduledTaskService) private readonly taskService: ScheduledTaskService,
    @Inject(SessionService) private readonly sessionService: SessionService,
    @Inject(RunnerService) private readonly runnerService: RunnerService,
    @Inject(RunnerHostService) private readonly runnerHostService: RunnerHostService,
    @Inject(WorkspaceService) private readonly workspaceService: WorkspaceService,
  ) {}

  setEmitter(fn: (e: ServerEvent) => void): void { this.emitter = fn; }

  onModuleInit(): void {
    // 进程退出时释放锁，避免残留陈旧锁文件需等下次启动恢复。
    this.onExit = () => releaseSchedulerLock(this.ownerKey);
    process.once("exit", this.onExit);

    // 尝试成为调度 owner。抢不到则不 tick，仅周期探测接管。
    this.hasLock = tryAcquireSchedulerLock(this.ownerKey);
    if (this.hasLock) {
      this.logger.log(`[cron-runner] acquired scheduler lock (pid=${process.pid})`);
      this.bootstrapAndStart();
    } else {
      this.logger.log("[cron-runner] another process owns the scheduler; standing by");
    }

    // 60s tick。shouldRun 判断当前分钟、lastFiredMinute 同分钟去重；非持锁 tick
    // 仅探测锁。子分钟级 cron 需改成对齐时钟边界的递归 setTimeout。
    this.timer = setInterval(() => this.tick(), 60_000);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.onExit) process.removeListener("exit", this.onExit);
    releaseSchedulerLock(this.ownerKey);
  }

  /**
   * 成为 owner 后的初始化：先收敛上次遗留的 running 僵尸态（进程重启后内存里的
   * running Set 必为空，故启动时任何持久化 running 都是上次中途被杀的残留），
   * 再用任务 lastRunAt 回填本分钟去重表（防进程重启在同一分钟内重复触发）。
   */
  private bootstrapAndStart(): void {
    // 0) 僵尸态对账：lastRunStatus 卡在 running 的任务 → failed，并广播给已连接前端，
    //    否则前端 reconcile 会让这些（含已暂停的）任务永久显示「执行中」。
    try {
      const reconciled = this.taskService.reconcileStaleRuns();
      if (reconciled.length > 0) {
        this.logger.log(`[cron-runner] reconciled ${reconciled.length} stale running task(s) on startup`);
        for (const id of reconciled) {
          const task = this.taskService.list().find((t) => t.id === id);
          if (task) this.emitter?.({ type: "scheduled.updated", payload: { task } } as any);
        }
      }
    } catch (e) {
      this.logger.warn(`[cron-runner] reconcileStaleRuns failed: ${String(e)}`);
    }

    const nowMinute = Math.floor(Date.now() / 60_000);
    const tasks = this.taskService.list().filter((t) => t.status === "active");
    for (const task of tasks) {
      // 重启去重：上次实跑落在当前分钟内 → 标记为已触发，避免同分钟重放。
      if (task.lastRunAt && Math.floor(task.lastRunAt / 60_000) === nowMinute) {
        this.lastFiredMinute.set(task.id, nowMinute);
      }
    }
  }

  async runTask(taskId: string): Promise<void> {
    const task = this.taskService.list().find(t => t.id === taskId);
    if (!task || this.running.has(taskId)) return;
    this.running.add(taskId);

    const effectiveCwd = task.cwd
      ?? await this.workspaceService.ensureCronTaskDir(task.id, task.name);

    // 任务指定了模型 → 构造云端 routingOverride，使定时执行真正用该模型；否则走全局默认路由。
    const routingOverride = task.model
      ? { preference: "standard" as const, modelOverride: task.model, endpointId: task.endpointId }
      : undefined;

    const isConversation = task.taskType === "conversation";

    // 会话解析：
    // - project（默认）：每次新建独立会话，不 resume。
    // - conversation：复用 boundSessionId 续聊；会话缺失/未绑定/达滚动阈值 → 新建并重绑。
    let session = isConversation && task.boundSessionId
      ? this.sessionService.getSession(task.boundSessionId)
      : undefined;
    const runsSoFar = task.runsSinceBind ?? 0;
    const needRollover = isConversation && !!session && runsSoFar >= CRON_CONV_MAX_RUNS;
    const isResume = isConversation && !!session && !needRollover;

    if (!session || needRollover) {
      session = this.sessionService.createSession({
        prompt: task.prompt,
        title: `[定时] ${task.name}`,
        cwd: effectiveCwd,
        kind: "cron",
        routingOverride,
        // 用户没给 task.cwd 时是系统自动建的 cron 任务目录，标记 autoCwd 使其
        // 不进项目选择列表；用户显式配了 cwd 则视为项目目录，正常显示。
        autoCwd: !task.cwd,
      });
      if (isConversation) {
        // 绑定/重绑：记录新会话并把轮次计数归零。
        this.taskService.update(task.id, { boundSessionId: session.id, runsSinceBind: 0 });
      }
    }

    // Emit running with kind=cron（前端据 kind 区分展示）
    // 先持久化 status=running 到 DB，再广播事件：与 chat 路径(websocket.gateway)一致。
    // 否则点进会话时 useSessionHistory 拉 history 读到 DB 里的陈旧 status，
    // 会把 WS 推来的 running 覆盖成 idle/上一轮终态，导致输入框不显示「执行中」、prompt 不排队直接提交。
    this.sessionService.updateSession(session.id, { status: "running" });
    this.emitter?.({
      type: "session.status",
      payload: { sessionId: session.id, status: "running", title: session.title, cwd: effectiveCwd, kind: "cron" },
    } as any);

    // conversation 续聊：把本次自动消息追加进会话（带 source=automation 供前端显示徽标），
    // 并实时下发，使续聊会话里出现这条用户消息。project 不需要（每次新会话）。
    if (isConversation) {
      this.sessionService.recordMessage(session.id, {
        type: "user_prompt", prompt: task.prompt, source: "automation",
      } as any);
      this.emitter?.({
        type: "stream.user_prompt",
        payload: { sessionId: session.id, prompt: task.prompt, source: "automation" },
      } as any);
    }

    const exec = this.taskService.startExecution(task.id, task.name, session.id);
    const logs: string[] = [];

    const onEvent = this.runnerHostService.buildOnEvent(
      session.id,
      effectiveCwd,
      effectiveCwd,
      (e) => this.emitter?.(e),
      { onAssistantText: (t) => logs.push(t.slice(0, 500)), emitArtifacts: false },
    );
    const onSessionUpdate = this.runnerHostService.buildOnSessionUpdate(session.id);

    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    let runnerHandle: { abort: () => void } | null = null;
    // 用户在流式页点「停止」→ gateway.onSessionStop → runnerHostService.stopRun 触发本回调。
    // 用哨兵 reject 让本次执行的 Promise 立即收敛，不必等 30 分钟超时；catch 据此标记终态。
    let stoppedByUser = false;

    try {
      await new Promise<void>((resolve, reject) => {
        timeoutHandle = setTimeout(() => {
          try { runnerHandle?.abort(); } catch { /* ignore */ }
          reject(new Error(`Cron task timed out after ${CRON_RUN_TIMEOUT_MS / 60000} min`));
        }, CRON_RUN_TIMEOUT_MS);

        this.runnerService.createRunner({
          prompt: CRON_SYSTEM_PREFIX + task.prompt,
          session: session!,
          // conversation 续聊用 claudeSessionId resume，带历史上下文；首次/project 不传。
          resumeSessionId: isResume ? session!.claudeSessionId : undefined,
          // 定时任务无人值守：用 acceptEdits 自动放行写类工具（Write/Edit/Bash），
          // 否则 default 模式会对写操作弹确认卡，而 cron 场景无人应答 → 挂到超时。
          // acceptEdits 仍会拦截危险 Bash（rm -rf 等），保留最后一道安全闸。
          permissionMode: "acceptEdits",
          extraDisallowedTools: CRON_DISALLOWED_TOOLS,
          onEvent: (e) => {
            onEvent(e);
            if (e.type === "session.status") {
              const s = (e.payload as any).status;
              if (s === "completed") resolve();
              if (s === "error") reject(new Error("Runner error"));
            }
          },
          onSessionUpdate,
        }).then(({ handle }) => {
          runnerHandle = handle;
          if (!handle) { reject(new Error("No handle")); return; }
          // 注册到共享表，使「停止」按钮（onSessionStop）能 abort 本进程。
          // onStop：abort 后进程被杀、不再发 completed/error，主动 reject 哨兵收敛 Promise。
          this.runnerHostService.registerRunHandle(session!.id, {
            abort: handle.abort,
            onStop: () => { stoppedByUser = true; reject(new Error("stopped_by_user")); },
          });
        }).catch(reject);
      });
      this.taskService.finishExecution(exec.id, task.id, "success", logs.join("\n"));
      // conversation：执行成功后轮次 +1（滚动重置依据）。
      if (isConversation) {
        const cur = this.taskService.list().find(t => t.id === task.id);
        this.taskService.update(task.id, { runsSinceBind: (cur?.runsSinceBind ?? 0) + 1 });
      }
    } catch (err) {
      // 用户主动停止：abort 已杀进程，按 failed 收敛并附停止原因，不再视为系统错误弹窗。
      if (stoppedByUser) {
        this.taskService.finishExecution(exec.id, task.id, "failed", logs.join("\n"), "stopped by user");
      } else {
        const msg = String(err);
        this.taskService.finishExecution(exec.id, task.id, "failed", logs.join("\n"), msg);
        this.emitter?.({ type: "scheduled.execution.failed", payload: { taskName: task.name, error: msg, taskId: task.id } } as any);
      }
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      this.runnerHostService.unregisterRunHandle(session.id);
      this.running.delete(taskId);
    }
  }

  private tick(): void {
    // 非持锁进程：每次 tick（60s）探测一次，owner 崩溃后接管并补做初始化。
    if (!this.hasLock) {
      this.hasLock = tryAcquireSchedulerLock(this.ownerKey);
      if (!this.hasLock) return;
      this.logger.log(`[cron-runner] took over scheduler lock (pid=${process.pid})`);
      this.bootstrapAndStart();
      return;
    }

    const nowMinute = Math.floor(Date.now() / 60_000);
    // Clean up stale entries (tasks deleted while running)
    for (const [id, m] of this.lastFiredMinute) {
      if (nowMinute - m > 2) this.lastFiredMinute.delete(id);
    }
    const tasks = this.taskService.list().filter(t => t.status === "active");
    for (const task of tasks) {
      if (this.running.has(task.id)) continue;
      if (this.lastFiredMinute.get(task.id) === nowMinute) continue;
      if (!shouldRun(task.cron)) continue;
      this.lastFiredMinute.set(task.id, nowMinute);
      this.runTask(task.id);
    }
  }
}
