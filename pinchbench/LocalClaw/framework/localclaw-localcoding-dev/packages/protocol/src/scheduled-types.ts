// ── Scheduled Task types ──

export type ScheduledTaskSource = "ui" | "mcp" | "api";

/** 任务类型：project=每次独立会话在项目里执行；conversation=绑定长期对话续聊。 */
export type ScheduledTaskType = "project" | "conversation";

export interface ScheduledTask {
  id: string;
  name: string;
  cron: string;
  prompt: string;
  status: "active" | "paused";
  cwd?: string;
  source?: ScheduledTaskSource;
  /** 缺省视为 "project"（兼容存量）。 */
  taskType?: ScheduledTaskType;
  /** 仅 conversation：绑定的长期会话 id；留空则首次执行新建并回填。 */
  boundSessionId?: string;
  /** 仅 conversation：自上次绑定以来的执行轮次，达 30 触发滚动重置。 */
  runsSinceBind?: number;
  createdAt: number;
  updatedAt: number;
  lastRunAt?: number;
  lastRunStatus?: "success" | "failed" | "running";
}