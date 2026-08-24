import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "events";
import { PassThrough } from "stream";
import { tmpdir } from "os";
import { join } from "path";

// ── mock 外部副作用：CLI 进程 spawn + 配置目录 ──────────────────
const spawnMock = vi.fn();
vi.mock("child_process", () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
  spawnSync: vi.fn(() => ({ status: 0, stdout: "", stderr: "" })),
  execSync: vi.fn(),
}));

const TEST_CONFIG_DIR = join(tmpdir(), "localcoding-lru-test");
vi.mock("../claude-config-dir", () => ({
  ensureClaudeConfigDir: () => TEST_CONFIG_DIR,
  getClaudeConfigDir: () => TEST_CONFIG_DIR,
}));

import { RunnerSpawnService } from "../runner-spawn.service";

function makeFakeChild(pid: number) {
  const child = new EventEmitter() as any;
  child.pid = pid;
  child.killed = false;
  child.stdin = { write: vi.fn(), end: vi.fn() };
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = vi.fn(() => { child.killed = true; return true; });
  return child;
}

function makeSession(id: string, status = "idle") {
  return {
    id,
    cwd: "/proj", // 同 cwd + 同 env → fingerprint 一致，复用判定只取决于是否还在缓存
    title: "t",
    status,
    kind: "chat",
    pendingPermissions: new Map(),
    claudeSessionId: undefined as string | undefined,
  };
}

function makeOptions(session: any) {
  return {
    prompt: "hello",
    session,
    permissionMode: "default",
    onEvent: vi.fn(),
    onSessionUpdate: vi.fn(),
  } as any;
}

/**
 * LRU 热进程池测试。默认 MAX_WARM_PROCESSES=3（模块常量，未设 env）。
 * 关键不变量：按进程数卡、只淘汰空闲、running 永不淘汰、全程不读内存。
 */
describe("RunnerSpawnService 热进程池 LRU（默认 N=3）", () => {
  let svc: RunnerSpawnService;
  let pidSeq: number;
  let t: number;

  beforeEach(() => {
    // 只伪造 Date，让每次 spawn 的 lastActivity 严格递增，「最老」无歧义；
    // 不伪造 setTimeout，避免 idle/stale 计时器逻辑受影响。
    t = 1_700_000_000_000;
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(t);

    pidSeq = 1000;
    spawnMock.mockReset();
    spawnMock.mockImplementation(() => makeFakeChild(pidSeq++));
    const smartHybridStub = {
      prepareSessionCwd: vi.fn(),
      releaseSessionCwd: vi.fn(),
      releaseIfHeld: vi.fn(),
      isActive: () => false,
    } as any;
    const taskWatcherStub = { start: vi.fn(), stop: vi.fn(), setEmitter: vi.fn() } as any;
    svc = new RunnerSpawnService(smartHybridStub, taskWatcherStub);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  /** spawn 一个新 session 并推进时钟，使各进程 lastActivity 递增。 */
  async function spawnSession(id: string, status = "idle") {
    const session = makeSession(id, status);
    await svc.run(makeOptions(session));
    t += 1000;
    vi.setSystemTime(t);
    return session;
  }

  it("超出 N 个空闲进程 → 回收最老的那个（再次访问触发 respawn）", async () => {
    await spawnSession("s1"); // 最老
    await spawnSession("s2");
    await spawnSession("s3");
    expect(spawnMock).toHaveBeenCalledTimes(3); // 池未满，3 个都在

    await spawnSession("s4"); // 第 4 个 → 触发 LRU，淘汰最老的 s1
    expect(spawnMock).toHaveBeenCalledTimes(4);

    // s2 仍在缓存 → 复用，不 respawn
    await svc.run(makeOptions(makeSession("s2")));
    expect(spawnMock).toHaveBeenCalledTimes(4);

    // s1 已被淘汰 → 缓存未命中，重新 spawn
    await svc.run(makeOptions(makeSession("s1")));
    expect(spawnMock).toHaveBeenCalledTimes(5);
  });

  it("running 进程永不被淘汰，允许池临时超过 N", async () => {
    // 4 个全部 running
    await spawnSession("r1", "running");
    await spawnSession("r2", "running");
    await spawnSession("r3", "running");
    await spawnSession("r4", "running"); // 超 N，但都 running → 不杀任何一个
    expect(spawnMock).toHaveBeenCalledTimes(4);

    // 全部仍在缓存：逐个复用，无一 respawn（证明无人被淘汰）
    for (const id of ["r1", "r2", "r3", "r4"]) {
      await svc.run(makeOptions(makeSession(id, "running")));
    }
    expect(spawnMock).toHaveBeenCalledTimes(4);
  });

  it("混合场景：只淘汰空闲中最老的，running 受保护", async () => {
    await spawnSession("idle-old", "idle");   // 最老，空闲 → 应被淘汰
    await spawnSession("run-mid", "running");  // running → 受保护
    await spawnSession("idle-new", "idle");    // 较新空闲
    await spawnSession("trigger", "idle");     // 第 4 个，触发收敛

    // running 的 run-mid 仍在 → 复用
    await svc.run(makeOptions(makeSession("run-mid", "running")));
    // 较新空闲 idle-new 仍在 → 复用
    await svc.run(makeOptions(makeSession("idle-new")));
    expect(spawnMock).toHaveBeenCalledTimes(4); // 以上都没 respawn

    // 最老空闲 idle-old 被淘汰 → respawn
    await svc.run(makeOptions(makeSession("idle-old")));
    expect(spawnMock).toHaveBeenCalledTimes(5);
  });

  it("不变量：LRU 收敛过程不读取任何进程内存", async () => {
    const memSpy = vi.spyOn(process, "memoryUsage");
    await spawnSession("m1");
    await spawnSession("m2");
    await spawnSession("m3");
    await spawnSession("m4"); // 触发 enforceLruCap
    expect(memSpy).not.toHaveBeenCalled();
  });

  it("error 进程优先淘汰：即便比 completed 进程更新，也先被回收", async () => {
    // 顺序＝时间升序：completed-old 最老，error-new 较新但 error → 应优先淘汰
    await spawnSession("completed-old", "completed"); // 最老的空闲 completed
    await spawnSession("error-new", "error");          // 较新，但 error → 优先淘汰候选
    await spawnSession("keep", "completed");
    await spawnSession("trigger", "completed");        // 第 4 个，触发一次收敛（keepSessionId）

    const cache: Map<string, any> = (svc as any).processCache;
    // 直接检查缓存（不再调 run()，避免触发新一轮收敛干扰断言）：
    // error-new 被优先淘汰，completed-old 因此存活（标准 LRU 下它最老本该先走）
    expect(cache.has("error-new")).toBe(false);
    expect(cache.has("completed-old")).toBe(true);
    expect(cache.has("keep")).toBe(true);
    expect(cache.has("trigger")).toBe(true);
    expect(cache.size).toBe(3);
  });
});
