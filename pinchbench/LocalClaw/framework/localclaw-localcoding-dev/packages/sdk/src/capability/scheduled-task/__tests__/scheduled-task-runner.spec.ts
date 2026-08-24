import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { configurePaths, __resetPathsForTest } from "../../../config/paths";
import { ScheduledTaskRunnerService } from "../scheduled-task-runner.service";
import type { ScheduledTask } from "../scheduled-task.service";

/**
 * Runner 启动逻辑测试：重启去重。
 *
 * 不触达真实 Session/Runner/Workspace —— 它们只在 runTask 内用到，而这里 spy 掉
 * runTask，只验证 bootstrapAndStart 的决策（哪些任务被去重）。
 * 依赖用最小桩注入；taskService 仅需 list()。
 */

let dir: string;

const task = (over: Partial<ScheduledTask> = {}): ScheduledTask => ({
  id: "t1", name: "t", cron: "0 9 * * *", prompt: "p",
  status: "active", source: "ui", createdAt: 0, updatedAt: 0,
  ...over,
});

function makeRunner(tasks: ScheduledTask[]) {
  const taskService = { list: () => tasks, reconcileStaleRuns: () => [] } as any;
  const svc = new ScheduledTaskRunnerService(
    taskService, null as any, null as any, null as any, null as any,
  );
  const runSpy = vi.spyOn(svc as any, "runTask").mockResolvedValue(undefined);
  return { svc, runSpy };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cron-runner-"));
  configurePaths({ agentHomeDir: dir });
});
afterEach(() => {
  __resetPathsForTest();
  rmSync(dir, { recursive: true, force: true });
  vi.useRealTimers();
});

describe("bootstrapAndStart — 重启去重", () => {
  it("lastRunAt 落在当前分钟内 → 不补跑（标记已触发）", () => {
    vi.useFakeTimers();
    // 固定到周一 9:00:30，任务每天 9:00，lastRunAt = 9:00:05（同分钟）
    vi.setSystemTime(new Date(2026, 5, 15, 9, 0, 30));
    const lastRunAt = new Date(2026, 5, 15, 9, 0, 5).getTime();
    const { svc, runSpy } = makeRunner([task({ lastRunAt })]);
    (svc as any).bootstrapAndStart();
    expect(runSpy).not.toHaveBeenCalled();
  });

  it("停机期间错过的应触发点 → 不补跑（已移除补偿逻辑）", () => {
    vi.useFakeTimers();
    // 现在 11:30，任务每天 9:00，上次实跑在昨天 → 今天 9:00 被错过，但不再补跑
    vi.setSystemTime(new Date(2026, 5, 15, 11, 30, 0));
    const lastRunAt = new Date(2026, 5, 14, 9, 0, 0).getTime();
    const { svc, runSpy } = makeRunner([task({ lastRunAt })]);
    (svc as any).bootstrapAndStart();
    expect(runSpy).not.toHaveBeenCalled();
  });
});

describe("runTask — 运行状态持久化", () => {
  it("启动时把 session.status=running 持久化到 DB（点进会话读 history 才显示执行中）", async () => {
    const t = task({ cwd: "/tmp/x" });
    const session = { id: "s1", title: "[定时] t", claudeSessionId: undefined };
    const updateSession = vi.fn();
    const sessionService = {
      getSession: () => session,
      createSession: () => session,
      recordMessage: vi.fn(),
      updateSession,
    } as any;
    const taskService = {
      list: () => [t],
      startExecution: () => ({ id: "e1" }),
      finishExecution: vi.fn(),
      update: vi.fn(),
    } as any;
    // createRunner 立即回传 completed，使 runTask 走完成功分支后返回。
    const runnerService = {
      createRunner: ({ onEvent }: any) => {
        onEvent({ type: "session.status", payload: { status: "completed" } });
        return Promise.resolve({ handle: { abort: () => {} } });
      },
    } as any;
    const runnerHostService = {
      buildOnEvent: () => () => {},
      buildOnSessionUpdate: () => () => {},
      registerRunHandle: () => {},
      unregisterRunHandle: () => {},
    } as any;
    const workspaceService = { ensureCronTaskDir: () => Promise.resolve("/tmp/x") } as any;

    const svc = new ScheduledTaskRunnerService(
      taskService, sessionService, runnerService, runnerHostService, workspaceService,
    );
    await (svc as any).runTask("t1");

    expect(updateSession).toHaveBeenCalledWith("s1", { status: "running" });
  });

  it("用户停止（stopRun 触发 onStop）→ 执行按 failed 收敛并注销 handle，不挂到超时", async () => {
    const t = task({ cwd: "/tmp/x" });
    const session = { id: "s1", title: "[定时] t", claudeSessionId: undefined };
    const sessionService = {
      getSession: () => session,
      createSession: () => session,
      recordMessage: vi.fn(),
      updateSession: vi.fn(),
    } as any;
    const finishExecution = vi.fn();
    const taskService = {
      list: () => [t],
      startExecution: () => ({ id: "e1" }),
      finishExecution,
      update: vi.fn(),
    } as any;
    // createRunner 不发 completed/error，模拟运行中；返回可 abort 的 handle。
    const runnerService = {
      createRunner: () => Promise.resolve({ handle: { abort: vi.fn() } }),
    } as any;
    // 轻量共享表替身：注册即捕获 onStop，unregister 记录调用。
    let captured: { abort: () => void; onStop?: () => void } | null = null;
    const unregisterRunHandle = vi.fn();
    const runnerHostService = {
      buildOnEvent: () => () => {},
      buildOnSessionUpdate: () => () => {},
      registerRunHandle: (_id: string, h: any) => { captured = h; },
      unregisterRunHandle,
    } as any;
    const workspaceService = { ensureCronTaskDir: () => Promise.resolve("/tmp/x") } as any;

    const svc = new ScheduledTaskRunnerService(
      taskService, sessionService, runnerService, runnerHostService, workspaceService,
    );
    const runP = (svc as any).runTask("t1");
    // 等微任务跑到注册 handle，再模拟「停止」。
    await vi.waitFor(() => expect(captured).not.toBeNull());
    captured!.abort();
    captured!.onStop!();
    await runP;

    // 终态为 failed + "stopped by user"，且 handle 已注销。
    expect(finishExecution).toHaveBeenCalledWith("e1", "t1", "failed", expect.any(String), "stopped by user");
    expect(unregisterRunHandle).toHaveBeenCalledWith("s1");
  });
});
