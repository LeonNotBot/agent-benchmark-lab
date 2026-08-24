import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "events";
import { PassThrough } from "stream";
import { tmpdir } from "os";
import { join } from "path";

const spawnMock = vi.fn();
vi.mock("child_process", () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
  spawnSync: vi.fn(() => ({ status: 0, stdout: "", stderr: "" })),
  execSync: vi.fn(),
}));

const TEST_CONFIG_DIR = join(tmpdir(), "localcoding-prewarm-test");
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

function makeSession(id: string) {
  return {
    id, cwd: "/proj", title: "t", status: "idle", kind: "chat",
    pendingPermissions: new Map(),
    claudeSessionId: undefined as string | undefined,
  };
}

function makeOptions(session: any, extra: Record<string, unknown> = {}) {
  return {
    prompt: "hello", session, permissionMode: "default",
    onEvent: vi.fn(), onSessionUpdate: vi.fn(), ...extra,
  } as any;
}

describe("RunnerSpawnService 预热（prewarm）", () => {
  let svc: RunnerSpawnService;
  let children: any[];

  beforeEach(() => {
    children = [];
    spawnMock.mockReset();
    spawnMock.mockImplementation(() => { const c = makeFakeChild(1000 + children.length); children.push(c); return c; });
    const smartHybridStub = { prepareSessionCwd: vi.fn(), releaseSessionCwd: vi.fn(), releaseIfHeld: vi.fn(), isActive: () => false } as any;
    const taskWatcherStub = { start: vi.fn(), stop: vi.fn(), setEmitter: vi.fn() } as any;
    svc = new RunnerSpawnService(smartHybridStub, taskWatcherStub);
  });

  afterEach(() => vi.restoreAllMocks());

  it("prewarm spawn 进程但不发送 user message", () => {
    const session = makeSession("p1");
    svc.prewarm(makeOptions(session));

    expect(spawnMock).toHaveBeenCalledTimes(1);
    // 预热不发任何 stdin（run() 才会 sendUserMessage）
    expect(children[0].stdin.write).not.toHaveBeenCalled();
  });

  it("prewarm 后 run() 复用同一进程（不 respawn），并发出 user message", async () => {
    const session = makeSession("p2");
    svc.prewarm(makeOptions(session));
    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(children[0].stdin.write).not.toHaveBeenCalled();

    // 同 session、同 fingerprint 的真实 run → 命中预热进程
    await svc.run(makeOptions(session));
    expect(spawnMock).toHaveBeenCalledTimes(1); // 未 respawn = 复用成功
    // 复用路径发出了 user message
    expect(children[0].stdin.write).toHaveBeenCalled();
  });

  // 回归：应用重启后 prewarm 冷进程（无 --resume、无会话上下文）不可被「带 resume 的续聊」
  // 复用——否则 --resume 被跳过、历史丢失。须销毁并冷 spawn 走真正的 --resume。
  it("带 resumeSessionId 的 run 不复用 prewarm 冷进程，而是重建并带 --resume", async () => {
    const session = makeSession("p-resume");
    svc.prewarm(makeOptions(session));
    expect(spawnMock).toHaveBeenCalledTimes(1);

    // 模拟续聊：带上一轮的 claudeSessionId 做 resume
    await svc.run(makeOptions(session, { resumeSessionId: "prior-claude-sid" }));

    // 关键：必须重建（spawn 2 次），而非复用预热进程
    expect(spawnMock).toHaveBeenCalledTimes(2);
    // 新进程的 CLI 参数必须含 --resume <id>
    const lastArgs = spawnMock.mock.calls[1][1] as string[];
    expect(lastArgs).toContain("--resume");
    expect(lastArgs[lastArgs.indexOf("--resume") + 1]).toBe("prior-claude-sid");
  });

  // 对照：run() 真正起的进程（establishedConversation=true）可被后续带 resume 的续聊复用。
  it("run 起的进程可被后续带 resume 的续聊复用（不重建）", async () => {
    const session = makeSession("p-est");
    await svc.run(makeOptions(session)); // 首轮真 spawn，建立上下文
    expect(spawnMock).toHaveBeenCalledTimes(1);

    await svc.run(makeOptions(session, { resumeSessionId: "sid-x" }));
    expect(spawnMock).toHaveBeenCalledTimes(1); // 复用，不重建
  });

  it("prewarm 幂等：已有缓存进程时跳过，不重复 spawn", () => {
    const session = makeSession("p3");
    svc.prewarm(makeOptions(session));
    svc.prewarm(makeOptions(session));
    svc.prewarm(makeOptions(session));
    expect(spawnMock).toHaveBeenCalledTimes(1);
  });

  it("prewarm 不读取任何进程内存", () => {
    const memSpy = vi.spyOn(process, "memoryUsage");
    svc.prewarm(makeOptions(makeSession("p4")));
    expect(memSpy).not.toHaveBeenCalled();
  });

  it("预热了却没人用的进程：就绪窗口后解除 prewarmInFlight 并启动 idle timer（防永生泄漏）", () => {
    vi.useFakeTimers();
    try {
      const session = makeSession("p5");
      svc.prewarm(makeOptions(session));
      const cache: Map<string, any> = (svc as any).processCache;
      const entry = cache.get("p5");
      // 就绪窗口内：仍受保护
      expect(entry.prewarmInFlight).toBe(true);
      expect(entry.idleTimer).toBeUndefined();

      // CLI 在收到消息前零 stdout —— 不喂任何 stdout，只推进时间
      vi.advanceTimersByTime(8 * 1000 + 50);

      // 就绪窗口后：解除保护 + 启动 idle timer（此后可被 LRU/idle 回收）
      expect(entry.prewarmInFlight).toBe(false);
      expect(entry.prewarmTimer).toBeUndefined();
      expect(entry.idleTimer).toBeDefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("prewarmInFlight 的进程不被 LRU 淘汰（就绪前受保护）", () => {
    vi.useFakeTimers();
    try {
      // MAX_WARM_PROCESSES 默认 3：塞 3 个预热进程，第 4 个触发收敛
      for (let i = 0; i < 4; i++) svc.prewarm(makeOptions(makeSession(`pf${i}`)));
      const cache: Map<string, any> = (svc as any).processCache;
      // 全部 prewarmInFlight=true → 谁都不能淘汰 → 允许临时超过 N
      expect(cache.size).toBe(4);
      for (let i = 0; i < 4; i++) {
        expect(cache.get(`pf${i}`)?.prewarmInFlight).toBe(true);
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it("run() 复用预热中的进程会撤掉就绪计时器，复用后不再受预热保护", async () => {
    vi.useFakeTimers();
    try {
      const session = makeSession("p6");
      svc.prewarm(makeOptions(session));
      const cache: Map<string, any> = (svc as any).processCache;
      const entry = cache.get("p6");
      expect(entry.prewarmInFlight).toBe(true);
      expect(entry.prewarmTimer).toBeDefined();

      await svc.run(makeOptions(session));

      // 复用后：预热态解除、就绪计时器已撤（避免与正常 idle/no-output 计时器重复）
      expect(entry.prewarmInFlight).toBe(false);
      expect(entry.prewarmTimer).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});
