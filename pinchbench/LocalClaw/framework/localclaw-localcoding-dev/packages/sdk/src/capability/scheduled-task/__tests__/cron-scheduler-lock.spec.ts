import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { configurePaths, __resetPathsForTest, getAgentHomeDir } from "../../../config/paths";
import {
  tryAcquireSchedulerLock,
  releaseSchedulerLock,
} from "../cron-scheduler-lock";

let dir: string;
const lockPath = () => join(getAgentHomeDir(), "scheduled_tasks.lock");

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cron-lock-"));
  configurePaths({ agentHomeDir: dir });
});
afterEach(() => {
  __resetPathsForTest();
  rmSync(dir, { recursive: true, force: true });
});

describe("cron-scheduler-lock", () => {
  it("首个获取成功并写锁文件", () => {
    expect(tryAcquireSchedulerLock("A")).toBe(true);
    expect(existsSync(lockPath())).toBe(true);
  });

  it("同 owner 幂等重获", () => {
    expect(tryAcquireSchedulerLock("A")).toBe(true);
    expect(tryAcquireSchedulerLock("A")).toBe(true);
  });

  it("另一存活进程持锁时拒绝", () => {
    // 伪造一个由存活 PID（当前进程）持有、但 owner 不同的锁
    writeFileSync(
      lockPath(),
      JSON.stringify({ owner: "OTHER", pid: process.pid, acquiredAt: Date.now() }),
    );
    expect(tryAcquireSchedulerLock("A")).toBe(false);
  });

  it("陈旧锁（死 PID）被恢复", () => {
    // PID=1 之外用一个几乎不可能存活的大 PID
    writeFileSync(
      lockPath(),
      JSON.stringify({ owner: "DEAD", pid: 2147483646, acquiredAt: 0 }),
    );
    expect(tryAcquireSchedulerLock("A")).toBe(true);
    expect(JSON.parse(readFileSync(lockPath(), "utf-8")).owner).toBe("A");
  });

  it("损坏锁文件被当作陈旧恢复", () => {
    writeFileSync(lockPath(), "not json {{{");
    expect(tryAcquireSchedulerLock("A")).toBe(true);
  });

  it("release 删除自己的锁，非持有者不误删", () => {
    tryAcquireSchedulerLock("A");
    releaseSchedulerLock("B"); // 非持有者
    expect(existsSync(lockPath())).toBe(true);
    releaseSchedulerLock("A");
    expect(existsSync(lockPath())).toBe(false);
  });
});
