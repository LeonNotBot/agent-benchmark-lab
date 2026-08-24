/**
 * 定时任务调度器租约锁（@internal）。
 *
 * 同一 agentHome 目录下可能跑起多个后端进程（多开、开发热重载残留、误启双实例），
 * 它们都会读同一份 scheduled_tasks.json。若各自 tick 会导致同一任务被重复触发。
 *
 * 本锁保证「同一目录同一时刻只有一个进程驱动调度」：首个抢到锁者成为 owner，
 * 其余进程不 tick，仅周期性探测；owner 进程死亡（PID 不再存活）后，探测者接管。
 *
 * 实现照搬 claude-code 的 cronTasksLock 模式：O_EXCL 原子创建 + PID 存活探测 +
 * 陈旧锁恢复 + 退出清理。锁文件 = <agentHome>/scheduled_tasks.lock。
 */
import { writeFileSync, readFileSync, unlinkSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { getAgentHomeDir } from "../../config/paths";
import { logger } from "../../util/logger";

interface SchedulerLock {
  owner: string;
  pid: number;
  acquiredAt: number;
}

function getLockPath(): string {
  return join(getAgentHomeDir(), "scheduled_tasks.lock");
}

/** 跨平台 PID 存活探测：signal 0 不发信号，仅做权限/存在性检查。 */
function isProcessRunning(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e: unknown) {
    // EPERM = 进程存在但无权限（仍算存活）；ESRCH = 不存在。
    return (e as NodeJS.ErrnoException)?.code === "EPERM";
  }
}

function readLock(): SchedulerLock | null {
  try {
    const raw = readFileSync(getLockPath(), "utf-8");
    const p = JSON.parse(raw);
    if (typeof p?.owner === "string" && typeof p?.pid === "number") return p;
    return null;
  } catch {
    return null;
  }
}

/** O_EXCL 原子创建（flag 'wx'）：文件已存在则抛 EEXIST 返回 false。 */
function tryCreateExclusive(lock: SchedulerLock): boolean {
  const path = getLockPath();
  const body = JSON.stringify(lock);
  try {
    writeFileSync(path, body, { flag: "wx" });
    return true;
  } catch (e: unknown) {
    const code = (e as NodeJS.ErrnoException)?.code;
    if (code === "EEXIST") return false;
    if (code === "ENOENT") {
      mkdirSync(dirname(path), { recursive: true });
      try {
        writeFileSync(path, body, { flag: "wx" });
        return true;
      } catch (retry: unknown) {
        if ((retry as NodeJS.ErrnoException)?.code === "EEXIST") return false;
        throw retry;
      }
    }
    throw e;
  }
}

/**
 * 尝试获取调度锁。成功返回 true；被另一存活进程持有返回 false。
 *   - 文件不存在 → 原子创建，成功即 owner
 *   - 已是自己（owner 相同）→ 幂等 true（PID 变了则刷新，如进程重启复用同 owner key）
 *   - 另一存活 PID → false
 *   - 陈旧（PID 已死 / 文件损坏）→ 删除后重试一次创建
 */
export function tryAcquireSchedulerLock(ownerKey: string): boolean {
  const lock: SchedulerLock = {
    owner: ownerKey,
    pid: process.pid,
    acquiredAt: Date.now(),
  };

  if (tryCreateExclusive(lock)) return true;

  const existing = readLock();

  if (existing?.owner === ownerKey) {
    if (existing.pid !== process.pid) {
      try {
        writeFileSync(getLockPath(), JSON.stringify(lock));
      } catch {
        /* ignore */
      }
    }
    return true;
  }

  if (existing && isProcessRunning(existing.pid)) return false;

  // 陈旧或损坏：删除后重试创建一次（两进程竞争恢复时只有一个成功）。
  if (existing) {
    logger.log(
      `[cron-lock] recovering stale lock from dead pid=${existing.pid}`,
    );
  }
  try {
    unlinkSync(getLockPath());
  } catch {
    /* already gone */
  }
  return tryCreateExclusive(lock);
}

/** 释放锁（仅当当前进程/ownerKey 持有时）。 */
export function releaseSchedulerLock(ownerKey: string): void {
  const existing = readLock();
  if (!existing || existing.owner !== ownerKey) return;
  try {
    unlinkSync(getLockPath());
  } catch {
    /* ignore */
  }
}
