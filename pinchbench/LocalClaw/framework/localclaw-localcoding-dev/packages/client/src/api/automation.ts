// 自动化任务 API 客户端：对接 /api/scheduled-tasks（后端 ScheduledTaskService）。
// 后端原始结构 → 列表展示模型的映射也收在此处。
import { getJson, postJson, putJson, deleteJson } from "./_fetch";

type T = (key: string, params?: Record<string, string | number>) => string;

/** 后端持久化的原始任务结构（scheduled_tasks.json 一条记录）。 */
export interface RawScheduledTask {
  id: string;
  name: string;
  cron: string;
  prompt: string;
  status: "active" | "paused";
  cwd?: string;
  source?: "ui" | "mcp" | "api";
  taskType?: "project" | "conversation";
  boundSessionId?: string;
  runsSinceBind?: number;
  model?: string;
  endpointId?: string;
  createdAt: number;
  updatedAt: number;
  lastRunAt?: number;
  lastRunStatus?: "success" | "failed" | "running";
}

/** 单次执行记录（GET /api/scheduled-tasks/history）。 */
export interface TaskExecution {
  id: string;
  taskId: string;
  taskName: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  status: "running" | "success" | "failed";
  logs?: string;
  error?: string;
  sessionId?: string;
}

/** 列表展示模型。携带原始 cwd/cron，project/schedule 文案在组件渲染时按 locale 计算。 */
export interface AutomationTask {
  id: string;
  name: string;
  cwd?: string;      // 原始工作目录，用于推导项目名
  cron: string;      // 原始 cron，用于反译人类可读文案
  status: "active" | "paused";
  /** 最近一次运行状态。"running" 表示任务正在执行中（含 cron 自动触发），用于运行态同步。 */
  lastRunStatus?: "success" | "failed" | "running";
}

/** cwd "D:/temp/tttt" → "tttt"；空则回退「默认工作空间」。 */
export function projectFromCwd(t: T, cwd?: string): string {
  if (!cwd) return t("auto.defaultWorkspace");
  const seg = cwd.replace(/[/\\]+$/, "").split(/[/\\]/);
  return seg[seg.length - 1] || cwd;
}

function toView(t: RawScheduledTask): AutomationTask {
  return {
    id: t.id,
    name: t.name,
    cwd: t.cwd,
    cron: t.cron,
    status: t.status,
    lastRunStatus: t.lastRunStatus,
  };
}

/** 列出全部任务（后端已按 createdAt 倒序）。 */
export async function apiListAutomations(): Promise<AutomationTask[]> {
  const data = await getJson<{ tasks: RawScheduledTask[] }>("/api/scheduled-tasks");
  return (data?.tasks ?? []).map(toView);
}

/**
 * 查出绑定到指定会话的定时任务（仅 conversation 类型会有 boundSessionId）。
 * 用于侧栏删除会话前提示「将一并删除关联自动化」。
 */
export async function apiListAutomationsBySession(
  sessionId: string,
): Promise<Array<{ id: string; name: string }>> {
  const data = await getJson<{ tasks: RawScheduledTask[] }>("/api/scheduled-tasks");
  return (data?.tasks ?? [])
    .filter((t) => t.boundSessionId === sessionId)
    .map((t) => ({ id: t.id, name: t.name }));
}

/** 取单条原始任务（列表中按 id 过滤），用于详情页展示完整字段。 */
export async function apiGetRawAutomation(id: string): Promise<RawScheduledTask | null> {
  const data = await getJson<{ tasks: RawScheduledTask[] }>("/api/scheduled-tasks");
  return (data?.tasks ?? []).find((t) => t.id === id) ?? null;
}

/** 取某任务的运行历史（后端按时间倒序）。 */
export async function apiListAutomationHistory(taskId: string): Promise<TaskExecution[]> {
  const data = await getJson<{ executions: TaskExecution[] }>(
    `/api/scheduled-tasks/history?taskId=${encodeURIComponent(taskId)}`,
  );
  return data?.executions ?? [];
}

/** 取全部运行历史（不带 taskId），用于 sessionId → 任务 的反查映射。 */
export async function apiListAllExecutions(): Promise<TaskExecution[]> {
  const data = await getJson<{ executions: TaskExecution[] }>("/api/scheduled-tasks/history");
  return data?.executions ?? [];
}

/** 切换启用/暂停。 */
export async function apiSetAutomationStatus(
  id: string,
  status: "active" | "paused",
): Promise<void> {
  await putJson(`/api/scheduled-tasks/${encodeURIComponent(id)}`, { status });
}

/** 删除任务。 */
export async function apiDeleteAutomation(id: string): Promise<void> {
  await deleteJson(`/api/scheduled-tasks/${encodeURIComponent(id)}`);
}

/** 立即触发一次（fire-and-forget）。 */
export async function apiRunAutomation(id: string): Promise<void> {
  await postJson(`/api/scheduled-tasks/${encodeURIComponent(id)}/run`, {});
}

/** 结构化排程 spec：与 SDK ScheduleSpec / buildCron 对齐，cron 由后端权威生成。 */
export interface CreateScheduleSpec {
  kind: "interval" | "hourly" | "daily" | "workday" | "weekly" | "custom";
  intervalMin?: number;
  time?: string;
  weekday?: number;
  cron?: string;
}

/** 创建任务入参：cron 走结构化 schedule 收口到后端 Service.create。 */
export interface CreateAutomationInput {
  name: string;
  prompt: string;
  schedule: CreateScheduleSpec;
  cwd?: string;
  model?: string;
  endpointId?: string;
  /** project=本地项目；conversation=绑定长期对话续聊。 */
  taskType?: "project" | "conversation";
  /** 仅 conversation：绑定的已有会话 id；留空则首次执行新建。 */
  boundSessionId?: string;
}

/** 创建一个自动化任务，成功返回原始记录，失败返回 null。 */
export async function apiCreateAutomation(
  input: CreateAutomationInput,
): Promise<RawScheduledTask | null> {
  return postJson<RawScheduledTask>("/api/scheduled-tasks", {
    name: input.name,
    prompt: input.prompt,
    schedule: input.schedule,
    cwd: input.cwd || undefined,
    model: input.model || undefined,
    endpointId: input.endpointId || undefined,
    taskType: input.taskType || undefined,
    boundSessionId: input.boundSessionId || undefined,
    source: "ui",
  });
}

/** 可更新字段（部分更新）。cron 由调用方用 buildCron 生成后传入。 */
export interface UpdateAutomationPatch {
  name?: string;
  prompt?: string;
  cron?: string;
  cwd?: string;
  status?: "active" | "paused";
  model?: string;
  endpointId?: string;
  /** 仅 conversation：改绑目标会话。 */
  boundSessionId?: string;
}

/** 更新任务，成功返回更新后的原始记录，失败返回 null。 */
export async function apiUpdateAutomation(
  id: string,
  patch: UpdateAutomationPatch,
): Promise<RawScheduledTask | null> {
  return putJson<RawScheduledTask>(`/api/scheduled-tasks/${encodeURIComponent(id)}`, patch);
}
