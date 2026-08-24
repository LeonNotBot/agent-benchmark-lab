import { Injectable, BadRequestException } from "@nestjs/common";
import { existsSync, readFileSync } from "fs";
import type { ServerEvent } from "@lenovo/agent-protocol";
import { atomicWriteFile } from "../../util/atomic-write";
import { resolveCron, type ScheduleSpec } from "./cron-build";
import {
  getScheduledTasksPath,
  getScheduledTaskHistoryPath,
} from "../../config/paths";

export interface ScheduledTask {
  id: string; name: string; cron: string; prompt: string;
  status: "active" | "paused"; cwd?: string;
  source?: "ui" | "mcp" | "api";
  /** 任务类型：project=每次独立会话在项目里执行；conversation=绑定长期对话续聊。缺省 project。 */
  taskType?: "project" | "conversation";
  /** 仅 conversation：绑定的长期会话 id；留空则首次执行新建并回填。 */
  boundSessionId?: string;
  /** 仅 conversation：自上次绑定以来的执行轮次，达 30 触发滚动重置。 */
  runsSinceBind?: number;
  /** 定时执行时使用的云端模型名（如 "claude-opus-4-8"）；缺省则走全局默认路由。 */
  model?: string;
  /** 该模型所属端点 id，与 model 配套用于 routingOverride。 */
  endpointId?: string;
  createdAt: number; updatedAt: number;
  lastRunAt?: number; lastRunStatus?: "success" | "failed" | "running";
}

export interface TaskExecution {
  id: string; taskId: string; taskName: string;
  startTime: number; endTime?: number; duration?: number;
  status: "running" | "success" | "failed";
  logs?: string; error?: string; sessionId?: string;
}

/**
 * SCHEDULED_TASK_SERVICE —— IScheduledTaskService 的 NestJS 注入令牌（@public）。
 */
export const SCHEDULED_TASK_SERVICE = Symbol("SCHEDULED_TASK_SERVICE");

/**
 * 创建入参：cron 与 schedule 二选一。提供 schedule（结构化）时由 Service 用
 * resolveCron 权威生成 cron；只给 cron 串则校验后采用。两者都缺/非法 → 抛 400。
 */
export type CreateTaskInput =
  Omit<ScheduledTask, "id" | "createdAt" | "updatedAt" | "cron"> & {
    cron?: string;
    schedule?: ScheduleSpec;
  };

/**
 * IScheduledTaskService —— 对外稳定的定时任务能力接口（@public）。
 */
export interface IScheduledTaskService {
  setEmitter(fn: (e: ServerEvent) => void): void;
  list(): ScheduledTask[];
  create(data: CreateTaskInput): ScheduledTask;
  update(id: string, data: Partial<Omit<ScheduledTask, "id" | "createdAt">>): ScheduledTask | null;
  delete(id: string): boolean;
  listHistory(taskId?: string): TaskExecution[];
}

@Injectable()
export class ScheduledTaskService implements IScheduledTaskService {
  private get filePath(): string { return getScheduledTasksPath(); }
  private get historyPath(): string { return getScheduledTaskHistoryPath(); }
  private emitter: ((e: ServerEvent) => void) | null = null;

  setEmitter(fn: (e: ServerEvent) => void): void { this.emitter = fn; }

  private readAll(): ScheduledTask[] {
    if (!existsSync(this.filePath)) return [];
    try { const p = JSON.parse(readFileSync(this.filePath, "utf-8")); return Array.isArray(p) ? p : []; } catch { return []; }
  }
  private writeAll(tasks: ScheduledTask[]): void { atomicWriteFile(this.filePath, JSON.stringify(tasks, null, 2)); }

  private readHistory(): TaskExecution[] {
    if (!existsSync(this.historyPath)) return [];
    try { const p = JSON.parse(readFileSync(this.historyPath, "utf-8")); return Array.isArray(p) ? p : []; } catch { return []; }
  }
  private writeHistory(execs: TaskExecution[]): void { atomicWriteFile(this.historyPath, JSON.stringify(execs, null, 2)); }

  list(): ScheduledTask[] { return this.readAll().sort((a, b) => b.createdAt - a.createdAt); }

  create(data: CreateTaskInput): ScheduledTask {
    // 唯一安全边界：所有必填字段在此统一强制，覆盖 ui/mcp/api 三入口。
    // 杜绝 JSON.stringify 静默丢弃 undefined 导致的脏数据落盘。
    if (!data.name || typeof data.name !== "string" || data.name.trim().length === 0)
      throw new BadRequestException("missing_name");
    if (!data.prompt || typeof data.prompt !== "string" || data.prompt.trim().length === 0)
      throw new BadRequestException("missing_prompt");
    const { cron, error } = resolveCron({ cron: data.cron, schedule: data.schedule });
    if (error) throw new BadRequestException(error);
    const tasks = this.readAll(); const now = Date.now();
    const { schedule: _drop, ...rest } = data;
    const task: ScheduledTask = { ...rest, cron, source: data.source ?? "api", id: crypto.randomUUID(), createdAt: now, updatedAt: now };
    tasks.push(task); this.writeAll(tasks);
    this.emitter?.({ type: "scheduled.created", payload: { task } } as any);
    return task;
  }

  update(id: string, data: Partial<Omit<ScheduledTask, "id" | "createdAt">>): ScheduledTask | null {
    const tasks = this.readAll(); const idx = tasks.findIndex((t) => t.id === id);
    if (idx < 0) return null;
    tasks[idx] = { ...tasks[idx], ...data, updatedAt: Date.now() };
    this.writeAll(tasks);
    this.emitter?.({ type: "scheduled.updated", payload: { task: tasks[idx] } } as any);
    return tasks[idx];
  }

  delete(id: string): boolean {
    const tasks = this.readAll(); const next = tasks.filter((t) => t.id !== id);
    if (next.length === tasks.length) return false;
    this.writeAll(next);
    this.emitter?.({ type: "scheduled.deleted", payload: { id } } as any);
    return true;
  }

  startExecution(taskId: string, taskName: string, sessionId?: string): TaskExecution {
    const exec: TaskExecution = { id: crypto.randomUUID(), taskId, taskName, startTime: Date.now(), status: "running", sessionId };
    const history = this.readHistory(); history.unshift(exec);
    this.writeHistory(history.slice(0, 200));
    this.update(taskId, { lastRunAt: exec.startTime, lastRunStatus: "running" });
    return exec;
  }

  finishExecution(execId: string, taskId: string, status: "success" | "failed", logs?: string, error?: string): void {
    const history = this.readHistory(); const idx = history.findIndex(e => e.id === execId);
    const endTime = Date.now();
    if (idx >= 0) {
      history[idx] = { ...history[idx], status, endTime, duration: endTime - history[idx].startTime, logs, error };
      this.writeHistory(history);
    }
    this.update(taskId, { lastRunStatus: status, lastRunAt: endTime });
  }

  /**
   * 启动对账：把上次遗留的「running」僵尸态收敛为 failed。
   *
   * cron runner 的 in-memory `running` Set 在进程重启后必为空，因此启动那一刻不可能
   * 有任务真的在执行。任何持久化为 running 的执行记录 / 任务 lastRunStatus，都是上次
   * 在任务进行中被关闭/强杀（finishExecution 未走到）的残留。不收敛的话：
   * - 任务 lastRunStatus 永久停在 "running"，前端 reconcile 会让它（含已暂停的）一直转圈；
   * - 历史里留下无 endTime 的开放记录。
   * 与 SessionService.reconcileStaleSessions 同源，幂等：重复跑只是再写一次 failed。
   * 返回被收敛的任务 id，供调用方按需广播 scheduled.updated。
   */
  reconcileStaleRuns(): string[] {
    const now = Date.now();
    // 1) 关闭开放（无 endTime）的 running 历史记录。
    const history = this.readHistory();
    let historyChanged = false;
    for (let i = 0; i < history.length; i++) {
      const e = history[i];
      if (e.status === "running" && e.endTime === undefined) {
        history[i] = { ...e, status: "failed", endTime: now, duration: now - e.startTime, error: "interrupted: process restarted" };
        historyChanged = true;
      }
    }
    if (historyChanged) this.writeHistory(history);
    // 2) 任务 lastRunStatus 卡在 running → failed。
    const tasks = this.readAll();
    const reconciled: string[] = [];
    let tasksChanged = false;
    for (let i = 0; i < tasks.length; i++) {
      if (tasks[i].lastRunStatus === "running") {
        tasks[i] = { ...tasks[i], lastRunStatus: "failed", updatedAt: now };
        reconciled.push(tasks[i].id);
        tasksChanged = true;
      }
    }
    if (tasksChanged) this.writeAll(tasks);
    return reconciled;
  }

  listHistory(taskId?: string): TaskExecution[] {
    const h = this.readHistory();
    return taskId ? h.filter(e => e.taskId === taskId) : h;
  }
}
