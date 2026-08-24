// 「立即运行」运行态管理：跨组件共享 + 跨视图切换存活 + 以服务端为权威来源。
//
// 设计要点（修复列表/详情/切视图状态不同步）：
// - 运行态与轮询定时器存在【模块级单例】store，而非组件局部 state。这样列表页与
//   详情页读到同一份 runningIds；切走视图组件卸载也不清空（定时器继续跑）。
// - 服务端 lastRunStatus==="running" 是权威来源：reconcile() 用最新任务列表回灌，
//   使 cron 自动触发、或切走再切回时也能看到真实运行态。本地乐观态仅用于点击后的
//   瞬时反馈（轮询尚未确认前），完成后由 advanced 判定清除。
import { useCallback, useSyncExternalStore } from "react";
import { apiRunAutomation, apiGetRawAutomation, type RawScheduledTask } from "../api/automation";

const POLL_INTERVAL_MS = 1500;
// 安全上限：cron 执行超时 30min，留余量 35min 后强制清除，避免永久转圈。
const MAX_POLL_MS = 35 * 60 * 1000;

// ── 模块级单例 store ──────────────────────────────────────────────
let runningIds: Set<string> = new Set();
const timers = new Map<string, ReturnType<typeof setInterval>>();
const baseRunAtById = new Map<string, number>();
// 点击后、轮询定时器尚未挂上的乐观窗口内的任务 id。reconcile 不清这些，
// 避免服务端尚未写入 running 时把刚点的乐观态误清。
const pending = new Set<string>();
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}
function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
function getSnapshot(): Set<string> {
  return runningIds;
}

function setRunning(id: string, on: boolean): void {
  if (on === runningIds.has(id)) return;
  const next = new Set(runningIds);
  if (on) next.add(id);
  else next.delete(id);
  runningIds = next;
  emit();
}

function clearRun(id: string): void {
  const tm = timers.get(id);
  if (tm) { clearInterval(tm); timers.delete(id); }
  baseRunAtById.delete(id);
  setRunning(id, false);
}

// 启动轮询：直到本次运行结束（状态非 running 且 lastRunAt 较 base 推进）才清除。
function startPolling(id: string, baseRunAt: number): void {
  if (timers.has(id)) return;
  baseRunAtById.set(id, baseRunAt);
  const startedAt = Date.now();
  const tm = setInterval(() => {
    void (async () => {
      if (Date.now() - startedAt > MAX_POLL_MS) { clearRun(id); return; }
      const t = await apiGetRawAutomation(id).catch(() => null);
      if (!t) return;
      const advanced = (t.lastRunAt ?? 0) > (baseRunAtById.get(id) ?? 0);
      if (t.lastRunStatus !== "running" && advanced) clearRun(id);
    })();
  }, POLL_INTERVAL_MS);
  timers.set(id, tm);
}

// 用最新任务列表回灌运行态（服务端为权威）。供 reconcile() 调用。
function reconcileFrom(
  tasks: Array<Pick<RawScheduledTask, "id" | "status" | "lastRunStatus" | "lastRunAt">>,
): void {
  for (const t of tasks) {
    // 暂停的任务永不可能被自动触发：其 lastRunStatus==="running" 必为僵尸态
    // （进程中途被杀、finishExecution 未走到）。绝不据此判定运行中，否则已暂停任务永久转圈。
    // 唯一合法的「暂停 + 真在跑」是手动触发后暂停 —— 那一轮由本地轮询定时器独立跟踪，
    // 不依赖此处 reconcile，故这里跳过 paused 不会误清它。
    const serverRunning = t.status !== "paused" && t.lastRunStatus === "running";
    if (serverRunning) {
      // 服务端在跑但本地没轮询（cron 触发 / 切回视图）→ 接管轮询。
      setRunning(t.id, true);
      if (!timers.has(t.id)) startPolling(t.id, (t.lastRunAt ?? Date.now()) - 1);
    }
    // 服务端已结束（或任务已暂停）：不强行清有定时器/乐观窗口的，交给其轮询的 advanced 判定，
    // 避免点击后服务端尚未写入 running 的窗口期把乐观态误清。其余兜底清除。
    if (!serverRunning && !timers.has(t.id) && !pending.has(t.id) && runningIds.has(t.id)) {
      setRunning(t.id, false);
    }
  }
}

export function useAutomationRun() {
  const ids = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const run = useCallback((id: string) => {
    if (timers.has(id) || pending.has(id)) return; // 已在运行/触发中，忽略重复点击
    pending.add(id);
    void (async () => {
      try {
        const before = await apiGetRawAutomation(id).catch(() => null);
        const baseRunAt = before?.lastRunAt ?? 0;
        setRunning(id, true);
        await apiRunAutomation(id).catch(() => {});
        startPolling(id, baseRunAt);
      } finally {
        pending.delete(id);
      }
    })();
  }, []);

  const reconcile = useCallback(
    (tasks: Array<Pick<RawScheduledTask, "id" | "status" | "lastRunStatus" | "lastRunAt">>) => {
      reconcileFrom(tasks);
    },
    [],
  );

  return { runningIds: ids, run, reconcile };
}
