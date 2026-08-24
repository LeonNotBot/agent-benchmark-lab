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

const TEST_CONFIG_DIR = join(tmpdir(), "localcoding-setmodel-test");
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

/**
 * 构造一次 run 的 options。
 * apiType="anthropic" → 走网关 anthropic env（无 CLAUDE_CODE_USE_OPENAI），可运行时切模型；
 * apiType="openai"    → 走网关 openai env（CLAUDE_CODE_USE_OPENAI=1），换模型仍重建。
 */
function makeOptions(session: any, model: string, apiType: "anthropic" | "openai" = "anthropic") {
  const envOverrides =
    apiType === "anthropic"
      ? { ANTHROPIC_BASE_URL: "http://127.0.0.1:10086", ANTHROPIC_AUTH_TOKEN: "gw", ANTHROPIC_MODEL: model, ANTHROPIC_DEFAULT_HAIKU_MODEL: model }
      : { CLAUDE_CODE_USE_OPENAI: "1", OPENAI_BASE_URL: "http://127.0.0.1:10086", OPENAI_API_KEY: "gw", OPENAI_MODEL: model, ANTHROPIC_MODEL: model, OPENAI_DEFAULT_HAIKU_MODEL: model };
  return {
    prompt: "hello", session, permissionMode: "default",
    onEvent: vi.fn(), onSessionUpdate: vi.fn(),
    envOverrides,
    routingDecision: { target: "cloud", modelName: model, provider: "anthropic", reason: "test", confidence: 1 },
  } as any;
}

/** 取某个 child 写入 stdin 的所有 JSON 消息。 */
function writtenMessages(child: any): any[] {
  return child.stdin.write.mock.calls.map((c: any[]) => {
    try { return JSON.parse(String(c[0]).trim()); } catch { return null; }
  }).filter(Boolean);
}

describe("RunnerSpawnService 运行时换模型（set_model，不重建）", () => {
  let svc: RunnerSpawnService;
  let children: any[];

  beforeEach(() => {
    children = [];
    spawnMock.mockReset();
    spawnMock.mockImplementation(() => { const c = makeFakeChild(2000 + children.length); children.push(c); return c; });
    const smartHybridStub = { prepareSessionCwd: vi.fn(), releaseSessionCwd: vi.fn(), releaseIfHeld: vi.fn(), isActive: () => false } as any;
    const taskWatcherStub = { start: vi.fn(), stop: vi.fn(), setEmitter: vi.fn() } as any;
    svc = new RunnerSpawnService(smartHybridStub, taskWatcherStub);
  });

  afterEach(() => vi.restoreAllMocks());

  it("anthropic 路径换模型：复用同一进程并发 set_model（不 respawn）", async () => {
    const session = makeSession("m1");
    await svc.run(makeOptions(session, "claude-haiku-4-5"));
    expect(spawnMock).toHaveBeenCalledTimes(1);

    // 同 session、同连接、换模型 → 复用进程
    await svc.run(makeOptions(makeSession("m1"), "claude-sonnet-4-6"));
    expect(spawnMock).toHaveBeenCalledTimes(1); // 未 respawn = 复用成功

    // 第二轮应写过一条 set_model control_request，model 为新模型，且先于 user message
    const msgs = writtenMessages(children[0]);
    const setModelIdx = msgs.findIndex(
      (m) => m.type === "control_request" && m.request?.subtype === "set_model" && m.request?.model === "claude-sonnet-4-6",
    );
    const lastUserIdx = msgs.map((m) => m.type).lastIndexOf("user");
    expect(setModelIdx).toBeGreaterThanOrEqual(0);          // 发了 set_model
    expect(setModelIdx).toBeLessThan(lastUserIdx);          // set_model 在最后一条 user message 之前
  });

  it("anthropic 路径同模型复用：不发多余 set_model", async () => {
    const session = makeSession("m2");
    await svc.run(makeOptions(session, "claude-haiku-4-5"));
    await svc.run(makeOptions(makeSession("m2"), "claude-haiku-4-5")); // 同模型
    expect(spawnMock).toHaveBeenCalledTimes(1); // 复用

    const setModelCount = writtenMessages(children[0]).filter(
      (m) => m.type === "control_request" && m.request?.subtype === "set_model",
    ).length;
    expect(setModelCount).toBe(0); // 模型没变，不应发 set_model
  });

  it("换连接（endpoint/token 变）：仍 respawn，不走 set_model", async () => {
    const session = makeSession("m3");
    const opt1 = makeOptions(session, "claude-haiku-4-5");
    await svc.run(opt1);
    expect(spawnMock).toHaveBeenCalledTimes(1);

    // 换 token（连接类变化）→ envHash 变 → fingerprint 变 → 重建
    const opt2 = makeOptions(makeSession("m3"), "claude-haiku-4-5");
    opt2.envOverrides.ANTHROPIC_AUTH_TOKEN = "different-token";
    await svc.run(opt2);
    expect(spawnMock).toHaveBeenCalledTimes(2); // respawn
  });

  it("openai 兼容路径换模型：复用进程 + set_model（CLI handler 已 patch 同步 OPENAI_MODEL，与 anthropic 统一）", async () => {
    const session = makeSession("m4");
    await svc.run(makeOptions(session, "deepseek/deepseek-v4-flash", "openai"));
    expect(spawnMock).toHaveBeenCalledTimes(1);

    // 模型名从 fingerprint 剔除 → 复用，发 set_model 在进程内切换（实测出站模型随之切换）
    await svc.run(makeOptions(makeSession("m4"), "qwen/qwen3.6-plus", "openai"));
    expect(spawnMock).toHaveBeenCalledTimes(1); // 复用，不 respawn

    const msgs = writtenMessages(children[0]);
    const setModelIdx = msgs.findIndex(
      (m) => m.type === "control_request" && m.request?.subtype === "set_model" && m.request?.model === "qwen/qwen3.6-plus",
    );
    expect(setModelIdx).toBeGreaterThanOrEqual(0); // 发了 set_model 切到新模型
  });

  it("预热（haiku）+ run（sonnet）：复用预热进程并发 set_model（F3 根除）", async () => {
    const session = makeSession("m5");
    svc.prewarm(makeOptions(session, "claude-haiku-4-5"));
    expect(spawnMock).toHaveBeenCalledTimes(1);

    // 预热用 haiku，用户实际发 sonnet → 复用预热进程（fingerprint 与模型无关）+ set_model
    await svc.run(makeOptions(makeSession("m5"), "claude-sonnet-4-6"));
    expect(spawnMock).toHaveBeenCalledTimes(1); // 复用预热进程，未 respawn

    const msgs = writtenMessages(children[0]);
    const hasSetSonnet = msgs.some(
      (m) => m.type === "control_request" && m.request?.subtype === "set_model" && m.request?.model === "claude-sonnet-4-6",
    );
    expect(hasSetSonnet).toBe(true);
  });
});
