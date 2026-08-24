import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

/**
 * ScheduledTaskService 单测：该服务以 JSON 文件持久化（非 DB）。
 * mock config/paths 的两个 getter 指向每个用例独立的临时目录，跑真实 fs 读写后清理。
 */
let tmpDir: string;
vi.mock("../../../config/paths", () => ({
  getScheduledTasksPath: () => join(tmpDir, "scheduled_tasks.json"),
  getScheduledTaskHistoryPath: () => join(tmpDir, "scheduled_task_history.json"),
}));

import { ScheduledTaskService } from "../scheduled-task.service";

function makeService() {
  return new ScheduledTaskService();
}

const base = {
  name: "每日构建",
  cron: "0 9 * * *",
  prompt: "run build",
  status: "active" as const,
};

describe("ScheduledTaskService CRUD", () => {
  let svc: ScheduledTaskService;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "sched-test-"));
    svc = makeService();
  });
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("create 生成 id/时间戳，默认 source=api", () => {
    const t = svc.create(base);
    expect(t.id).toBeTruthy();
    expect(t.createdAt).toBeGreaterThan(0);
    expect(t.updatedAt).toBe(t.createdAt);
    expect(t.source).toBe("api");
    expect(svc.list()).toHaveLength(1);
  });

  it("create 可显式指定 source", () => {
    const t = svc.create({ ...base, source: "mcp" });
    expect(t.source).toBe("mcp");
  });

  it("list 按 createdAt 倒序", () => {
    const a = svc.create({ ...base, name: "A" });
    // 保证时间戳不同
    vi.useFakeTimers();
    vi.setSystemTime(a.createdAt + 1000);
    const b = svc.create({ ...base, name: "B" });
    vi.useRealTimers();
    const list = svc.list();
    expect(list[0].id).toBe(b.id);
    expect(list[1].id).toBe(a.id);
  });

  it("update 修改字段并刷新 updatedAt，未知 id 返回 null", () => {
    const t = svc.create(base);
    const updated = svc.update(t.id, { status: "paused" });
    expect(updated?.status).toBe("paused");
    expect(updated?.updatedAt).toBeGreaterThanOrEqual(t.updatedAt);
    expect(svc.update("ghost", { status: "paused" })).toBeNull();
  });

  it("delete 删除存在的任务返回 true，未知返回 false", () => {
    const t = svc.create(base);
    expect(svc.delete(t.id)).toBe(true);
    expect(svc.list()).toHaveLength(0);
    expect(svc.delete("ghost")).toBe(false);
  });

  it("数据跨实例持久化（落到文件，重新构造可读回）", () => {
    const t = svc.create(base);
    const svc2 = makeService();
    expect(svc2.list().map((x) => x.id)).toContain(t.id);
  });
});

describe("ScheduledTaskService 执行历史", () => {
  let svc: ScheduledTaskService;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "sched-test-"));
    svc = makeService();
  });
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("startExecution 记录 running 并回写任务 lastRunStatus", () => {
    const t = svc.create(base);
    const exec = svc.startExecution(t.id, t.name, "sess-1");
    expect(exec.status).toBe("running");
    expect(exec.sessionId).toBe("sess-1");
    expect(svc.listHistory(t.id)).toHaveLength(1);
    expect(svc.list().find((x) => x.id === t.id)?.lastRunStatus).toBe("running");
  });

  it("finishExecution 更新历史条目状态与耗时", () => {
    const t = svc.create(base);
    const exec = svc.startExecution(t.id, t.name);
    svc.finishExecution(exec.id, t.id, "success", "ok");
    const hist = svc.listHistory(t.id);
    expect(hist[0].status).toBe("success");
    expect(hist[0].endTime).toBeGreaterThan(0);
    expect(hist[0].duration).toBeGreaterThanOrEqual(0);
    expect(svc.list().find((x) => x.id === t.id)?.lastRunStatus).toBe("success");
  });

  it("listHistory(taskId) 按任务过滤", () => {
    const a = svc.create({ ...base, name: "A" });
    const b = svc.create({ ...base, name: "B" });
    svc.startExecution(a.id, a.name);
    svc.startExecution(b.id, b.name);
    expect(svc.listHistory(a.id)).toHaveLength(1);
    expect(svc.listHistory()).toHaveLength(2);
  });

  it("create/update/delete 触发 emitter 事件回调", () => {
    const events: string[] = [];
    svc.setEmitter((e) => events.push(e.type));
    const t = svc.create(base);
    svc.update(t.id, { status: "paused" });
    svc.delete(t.id);
    expect(events).toEqual([
      "scheduled.created",
      "scheduled.updated",
      "scheduled.deleted",
    ]);
  });

  it("历史最多保留 200 条", () => {
    const t = svc.create(base);
    for (let i = 0; i < 205; i++) svc.startExecution(t.id, t.name);
    expect(svc.listHistory(t.id).length).toBeLessThanOrEqual(200);
  });
});

describe("ScheduledTaskService 启动对账 reconcileStaleRuns", () => {
  let svc: ScheduledTaskService;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "sched-test-"));
    svc = makeService();
  });
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("把卡在 running 的任务 lastRunStatus 收敛为 failed，并关闭开放历史记录", () => {
    const t = svc.create(base);
    // 模拟「进程在执行中途被杀」：只 start 不 finish。
    const exec = svc.startExecution(t.id, t.name, "sess-zombie");
    expect(svc.list().find((x) => x.id === t.id)?.lastRunStatus).toBe("running");

    const reconciled = svc.reconcileStaleRuns();

    expect(reconciled).toEqual([t.id]);
    expect(svc.list().find((x) => x.id === t.id)?.lastRunStatus).toBe("failed");
    const hist = svc.listHistory(t.id).find((e) => e.id === exec.id);
    expect(hist?.status).toBe("failed");
    expect(hist?.endTime).toBeGreaterThan(0);
  });

  it("暂停的任务若卡在 running 也被收敛（修复已暂停却永久显示执行中）", () => {
    const t = svc.create(base);
    svc.startExecution(t.id, t.name);
    svc.update(t.id, { status: "paused" });

    svc.reconcileStaleRuns();

    const after = svc.list().find((x) => x.id === t.id);
    expect(after?.status).toBe("paused");
    expect(after?.lastRunStatus).toBe("failed");
  });

  it("正常完成的任务不受影响；幂等（重复跑无新变更）", () => {
    const t = svc.create(base);
    const exec = svc.startExecution(t.id, t.name);
    svc.finishExecution(exec.id, t.id, "success");

    expect(svc.reconcileStaleRuns()).toEqual([]);
    expect(svc.list().find((x) => x.id === t.id)?.lastRunStatus).toBe("success");
  });
});

