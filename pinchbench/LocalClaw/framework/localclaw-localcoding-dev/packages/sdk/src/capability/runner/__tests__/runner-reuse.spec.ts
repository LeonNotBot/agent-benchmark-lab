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

const TEST_CONFIG_DIR = join(tmpdir(), "localcoding-a2-test");
vi.mock("../claude-config-dir", () => ({
  ensureClaudeConfigDir: () => TEST_CONFIG_DIR,
  getClaudeConfigDir: () => TEST_CONFIG_DIR,
}));

import { RunnerSpawnService } from "../runner-spawn.service";

/** 造一个假的 CLI 子进程：可写 stdin、可读 stdout/stderr、可发 exit 事件。 */
function makeFakeChild(pid: number) {
  const child = new EventEmitter() as any;
  child.pid = pid;
  child.killed = false;
  child.stdin = { write: vi.fn(), end: vi.fn() };
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = vi.fn(() => {
    child.killed = true;
    return true;
  });
  return child;
}

function makeSession(id: string, cwd: string) {
  return {
    id,
    cwd,
    title: "t",
    status: "idle",
    pendingPermissions: new Map(),
    claudeSessionId: undefined as string | undefined,
  };
}

function makeOptions(session: any, resumeSessionId?: string) {
  return {
    prompt: "hello",
    session,
    resumeSessionId,
    permissionMode: "default",
    onEvent: vi.fn(),
    onSessionUpdate: vi.fn(),
  } as any;
}

describe("RunnerSpawnService 进程复用（A2 真实行为）", () => {
  let svc: RunnerSpawnService;
  let pidSeq: number;

  beforeEach(() => {
    pidSeq = 1000;
    spawnMock.mockReset();
    spawnMock.mockImplementation(() => makeFakeChild(pidSeq++));
    // SmartHybrid 桩：只需这两个方法在本用例被触达时不报错
    const smartHybridStub = {
      prepareSessionCwd: vi.fn(),
      releaseSessionCwd: vi.fn(),
      releaseIfHeld: vi.fn(),
      isActive: () => false,
    } as any;
    // TaskSnapshotWatcher 桩：进程复用用例不涉及任务监听，空实现即可
    const taskWatcherStub = {
      start: vi.fn(),
      stop: vi.fn(),
      setEmitter: vi.fn(),
    } as any;
    svc = new RunnerSpawnService(smartHybridStub, taskWatcherStub);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("turn1 冷 spawn；turn2 仅 resumeSessionId 变化 → 复用同一进程（不再 spawn）", async () => {
    const session = makeSession("s1", "/proj");

    // turn1：首轮，无 resume
    await svc.run(makeOptions(session, undefined));
    expect(spawnMock).toHaveBeenCalledTimes(1);

    // turn1 结束拿到 claudeSessionId，turn2 带上它（这是 A2 之前会触发重建的关键变化）
    await svc.run(makeOptions(session, "claude-session-S1"));

    // A2 核心断言：turn2 没有重新 spawn，而是复用 turn1 的活进程
    expect(spawnMock).toHaveBeenCalledTimes(1);
  });

  it("回归保护：cwd 变化 → 触发重建（再次 spawn）", async () => {
    const session = makeSession("s2", "/proj");
    await svc.run(makeOptions(session, undefined));
    expect(spawnMock).toHaveBeenCalledTimes(1);

    // 切换 cwd（spawn-time 参数变化）→ 必须重建
    session.cwd = "/proj-other";
    await svc.run(makeOptions(session, "claude-session-S2"));
    expect(spawnMock).toHaveBeenCalledTimes(2);
  });

  it("OpenAI 换模型 → 复用进程 + set_model（不再重建；CLI set_model handler 已 patch 同步 OPENAI_MODEL）", async () => {
    const session = makeSession("s3", "/proj");
    const o1 = makeOptions(session, undefined);
    o1.envOverrides = { CLAUDE_CODE_USE_OPENAI: "1", OPENAI_MODEL: "m1" };
    o1.routingDecision = { target: "cloud", modelName: "m1", provider: "openai", reason: "t", confidence: 1 };
    await svc.run(o1);
    expect(spawnMock).toHaveBeenCalledTimes(1);

    const o2 = makeOptions(session, "claude-session-S3");
    o2.envOverrides = { CLAUDE_CODE_USE_OPENAI: "1", OPENAI_MODEL: "m2" }; // 换模型
    o2.routingDecision = { target: "cloud", modelName: "m2", provider: "openai", reason: "t", confidence: 1 };
    await svc.run(o2);
    // 模型名已从 fingerprint 剔除（MODEL_ONLY_ENV_KEYS 含 OPENAI_MODEL）→ 复用，不 respawn
    expect(spawnMock).toHaveBeenCalledTimes(1);
  });

  it("permissionMode 变化 → 复用进程 + 发 set_permission_mode（不再重建）", async () => {
    const session = makeSession("s4", "/proj");
    let firstChild: any;
    spawnMock.mockImplementationOnce(() => { firstChild = makeFakeChild(pidSeq++); return firstChild; });

    const o1 = makeOptions(session, undefined);
    o1.permissionMode = "default";
    await svc.run(o1);
    expect(spawnMock).toHaveBeenCalledTimes(1);

    // 换模式 → 复用同进程，不 respawn
    const o2 = makeOptions(makeSession("s4", "/proj"), "claude-session-S4");
    o2.permissionMode = "plan";
    await svc.run(o2);
    expect(spawnMock).toHaveBeenCalledTimes(1);

    // 第二轮应写过一条 set_permission_mode control_request，mode=plan
    const msgs = firstChild.stdin.write.mock.calls
      .map((c: any[]) => { try { return JSON.parse(String(c[0]).trim()); } catch { return null; } })
      .filter(Boolean);
    const idx = msgs.findIndex(
      (m: any) => m.type === "control_request" && m.request?.subtype === "set_permission_mode" && m.request?.mode === "plan",
    );
    const lastUserIdx = msgs.map((m: any) => m.type).lastIndexOf("user");
    expect(idx).toBeGreaterThanOrEqual(0);   // 发了 set_permission_mode
    expect(idx).toBeLessThan(lastUserIdx);   // 在最后一条 user message 之前
  });
});
