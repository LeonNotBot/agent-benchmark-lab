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

const TEST_CONFIG_DIR = join(tmpdir(), "localcoding-hybrid-boundary-test");
vi.mock("../claude-config-dir", () => ({
  ensureClaudeConfigDir: () => TEST_CONFIG_DIR,
  getClaudeConfigDir: () => TEST_CONFIG_DIR,
}));

import { RunnerSpawnService } from "../runner-spawn.service";
import { SmartHybridService } from "../../routing/smart-hybrid.service";

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
    id,
    cwd: tmpdir(),
    title: "hybrid-boundary",
    status: "idle",
    kind: "chat",
    pendingPermissions: new Map(),
    claudeSessionId: undefined as string | undefined,
  };
}

function writtenMessages(child: any): any[] {
  return child.stdin.write.mock.calls.map((c: any[]) => {
    try { return JSON.parse(String(c[0]).trim()); } catch { return null; }
  }).filter(Boolean);
}

async function flush(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

describe("RunnerSpawnService Smart Hybrid tool-result boundary switching", () => {
  let svc: RunnerSpawnService;
  let child: any;
  let onEvent: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    spawnMock.mockReset();
    child = makeFakeChild(3100);
    spawnMock.mockReturnValue(child);
    const smartHybrid = new SmartHybridService();
    vi.spyOn(smartHybrid, "prepareSessionCwd").mockImplementation(() => undefined);
    vi.spyOn(smartHybrid, "releaseIfHeld").mockImplementation(() => undefined);
    const taskWatcherStub = { start: vi.fn(), stop: vi.fn(), setEmitter: vi.fn() } as any;
    svc = new RunnerSpawnService(smartHybrid, taskWatcherStub);
    onEvent = vi.fn();
  });

  afterEach(() => vi.restoreAllMocks());

  it("waits for TaskCreate result before Qwen→Kimi and waits for completed TaskUpdate result before Kimi→Qwen", async () => {
    const session = makeSession("hybrid-boundary-1");
    await svc.run({
      prompt: "test",
      session,
      permissionMode: "default",
      onEvent,
      envOverrides: {
        CLAUDE_CODE_USE_OPENAI: "1",
        OPENAI_BASE_URL: "http://127.0.0.1:10086/v1",
        OPENAI_API_KEY: "gw",
        OPENAI_MODEL: "qwen/qwen3.6-27b",
        ANTHROPIC_MODEL: "qwen/qwen3.6-27b",
        CLAUDE_CODE_CRITICAL_MODEL: "moonshotai/kimi-k3",
      },
      routingDecision: {
        target: "local",
        modelName: "qwen/qwen3.6-27b",
        provider: "openrouter",
        reason: "smart-hybrid default",
        confidence: 1,
      },
    } as any);

    child.stdout.write(JSON.stringify({
      type: "assistant",
      message: {
        role: "assistant",
        content: [{
          type: "tool_use",
          id: "create-1",
          name: "TaskCreate",
          input: { subject: "critical", description: "critical", critical: true },
        }],
      },
    }) + "\n");
    await flush();

    expect(writtenMessages(child).filter(
      (m) => m.type === "control_request" && m.request?.subtype === "set_model",
    )).toHaveLength(0);

    child.stdout.write(JSON.stringify({
      type: "user",
      message: {
        role: "user",
        content: [{
          type: "tool_result",
          tool_use_id: "create-1",
          content: "[Model switched: qwen/qwen3.6-27b → moonshotai/kimi-k3]",
        }],
      },
    }) + "\n");
    await flush();

    let switches = writtenMessages(child).filter(
      (m) => m.type === "control_request" && m.request?.subtype === "set_model",
    );
    expect(switches.map((m) => m.request.model)).toEqual(["moonshotai/kimi-k3"]);

    child.stdout.write(JSON.stringify({
      type: "assistant",
      message: {
        role: "assistant",
        content: [{
          type: "tool_use",
          id: "update-1",
          name: "TaskUpdate",
          input: { taskId: "1", status: "completed" },
        }],
      },
    }) + "\n");
    await flush();

    switches = writtenMessages(child).filter(
      (m) => m.type === "control_request" && m.request?.subtype === "set_model",
    );
    expect(switches.map((m) => m.request.model)).toEqual(["moonshotai/kimi-k3"]);

    child.stdout.write(JSON.stringify({
      type: "user",
      message: {
        role: "user",
        content: [{
          type: "tool_result",
          tool_use_id: "update-1",
          content: "[Model switched: moonshotai/kimi-k3 → qwen/qwen3.6-27b]",
        }],
      },
    }) + "\n");
    await flush();

    switches = writtenMessages(child).filter(
      (m) => m.type === "control_request" && m.request?.subtype === "set_model",
    );
    expect(switches.map((m) => m.request.model)).toEqual([
      "moonshotai/kimi-k3",
      "qwen/qwen3.6-27b",
    ]);

    // The CLI may replay the same breadcrumb more than once. Direct set_model telemetry remains
    // authoritative for the whole turn, so every identical replay must stay suppressed.
    for (const content of [
      "[Model switched: qwen/qwen3.6-27b → moonshotai/kimi-k3]",
      "[Model switched: moonshotai/kimi-k3 → qwen/qwen3.6-27b]",
      "[Model switched: moonshotai/kimi-k3 → qwen/qwen3.6-27b]",
    ]) {
      child.stdout.write(JSON.stringify({
        type: "user",
        message: {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "breadcrumb-replay", content }],
        },
      }) + "\n");
      await flush();
    }

    const escalationEvents = onEvent.mock.calls
      .map((c) => c[0])
      .filter((e) => e?.type === "escalation.status");
    expect(escalationEvents.map((e) => e.payload.active)).toEqual([true, false]);
  });

  it("blocks substantive tools until TaskCreate carries an explicit critical decision", async () => {
    const session = makeSession("hybrid-gate-1");
    await svc.run({
      prompt: "research this",
      session,
      permissionMode: "default",
      onEvent,
      envOverrides: {
        CLAUDE_CODE_USE_OPENAI: "1",
        OPENAI_BASE_URL: "http://127.0.0.1:10086/v1",
        OPENAI_API_KEY: "gw",
        OPENAI_MODEL: "qwen/qwen3.6-27b",
        ANTHROPIC_MODEL: "qwen/qwen3.6-27b",
        CLAUDE_CODE_CRITICAL_MODEL: "moonshotai/kimi-k3",
      },
      routingDecision: {
        target: "local",
        modelName: "qwen/qwen3.6-27b",
        provider: "openrouter",
        reason: "smart-hybrid default",
        confidence: 1,
      },
    } as any);

    child.stdout.write(JSON.stringify({
      type: "control_request",
      request_id: "web-before",
      request: {
        subtype: "can_use_tool",
        tool_name: "WebSearch",
        tool_use_id: "web-use-before",
        input: { query: "test" },
      },
    }) + "\n");
    await flush();

    let response = writtenMessages(child).find(
      (m) => m.type === "control_response" && m.response?.request_id === "web-before",
    );
    expect(response?.response?.response?.behavior).toBe("deny");
    expect(response?.response?.response?.message).toContain("TaskCreate");
    expect(response?.response?.response?.message).toContain("critical: true");
    expect(response?.response?.response?.message).toContain("critical: false");

    child.stdout.write(JSON.stringify({
      type: "control_request",
      request_id: "create-missing-critical",
      request: {
        subtype: "can_use_tool",
        tool_name: "TaskCreate",
        tool_use_id: "create-missing-use",
        input: { subject: "route", description: "route" },
      },
    }) + "\n");
    await flush();

    response = writtenMessages(child).find(
      (m) => m.type === "control_response" &&
        m.response?.request_id === "create-missing-critical",
    );
    expect(response?.response?.response?.behavior).toBe("deny");

    child.stdout.write(JSON.stringify({
      type: "control_request",
      request_id: "create-false",
      request: {
        subtype: "can_use_tool",
        tool_name: "TaskCreate",
        tool_use_id: "create-false-use",
        input: { subject: "route", description: "route", critical: false },
      },
    }) + "\n");
    await flush();

    response = writtenMessages(child).find(
      (m) => m.type === "control_response" && m.response?.request_id === "create-false",
    );
    expect(response?.response?.response?.behavior).toBe("allow");

    child.stdout.write(JSON.stringify({
      type: "control_request",
      request_id: "web-after",
      request: {
        subtype: "can_use_tool",
        tool_name: "WebSearch",
        tool_use_id: "web-use-after",
        input: { query: "test" },
      },
    }) + "\n");
    await flush();

    response = writtenMessages(child).find(
      (m) => m.type === "control_response" && m.response?.request_id === "web-after",
    );
    expect(response?.response?.response?.behavior).toBe("allow");
  });

  it("unlocks the gate from a real assistant TaskCreate even when can_use_tool was skipped", async () => {
    const session = makeSession("hybrid-gate-assistant-decision");
    await svc.run({
      prompt: "research this",
      session,
      permissionMode: "default",
      onEvent,
      envOverrides: {
        CLAUDE_CODE_USE_OPENAI: "1",
        OPENAI_BASE_URL: "http://127.0.0.1:10086/v1",
        OPENAI_API_KEY: "gw",
        OPENAI_MODEL: "qwen/qwen3.6-27b",
        ANTHROPIC_MODEL: "qwen/qwen3.6-27b",
        CLAUDE_CODE_CRITICAL_MODEL: "moonshotai/kimi-k3",
      },
      routingDecision: {
        target: "local",
        modelName: "qwen/qwen3.6-27b",
        provider: "openrouter",
        reason: "smart-hybrid default",
        confidence: 1,
      },
    } as any);

    child.stdout.write(JSON.stringify({
      type: "assistant",
      message: {
        content: [{
          type: "tool_use",
          id: "create-direct",
          name: "TaskCreate",
          input: { subject: "route", description: "route", critical: false },
        }],
        model: "qwen/qwen3.6-27b",
      },
    }) + "\n");
    await flush();

    child.stdout.write(JSON.stringify({
      type: "control_request",
      request_id: "web-after-direct-create",
      request: {
        subtype: "can_use_tool",
        tool_name: "WebSearch",
        tool_use_id: "web-after-direct-create-use",
        input: { query: "test" },
      },
    }) + "\n");
    await flush();

    const response = writtenMessages(child).find(
      (m) => m.type === "control_response" &&
        m.response?.request_id === "web-after-direct-create",
    );
    expect(response?.response?.response?.behavior).toBe("allow");
  });

  it("never applies the routing gate while the critical model is active", async () => {
    const session = makeSession("hybrid-gate-kimi-active");
    await svc.run({
      prompt: "research this",
      session,
      permissionMode: "default",
      onEvent,
      envOverrides: {
        CLAUDE_CODE_USE_OPENAI: "1",
        OPENAI_BASE_URL: "http://127.0.0.1:10086/v1",
        OPENAI_API_KEY: "gw",
        OPENAI_MODEL: "qwen/qwen3.6-27b",
        ANTHROPIC_MODEL: "qwen/qwen3.6-27b",
        CLAUDE_CODE_CRITICAL_MODEL: "moonshotai/kimi-k3",
      },
      routingDecision: {
        target: "local",
        modelName: "qwen/qwen3.6-27b",
        provider: "openrouter",
        reason: "smart-hybrid default",
        confidence: 1,
      },
    } as any);

    child.stdout.write(JSON.stringify({
      type: "assistant",
      message: {
        content: [{
          type: "tool_use",
          id: "create-critical",
          name: "TaskCreate",
          input: { subject: "route", description: "route", critical: true },
        }],
        model: "qwen/qwen3.6-27b",
      },
    }) + "\n");
    await flush();

    child.stdout.write(JSON.stringify({
      type: "user",
      message: {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "create-critical", content: "1" }],
      },
    }) + "\n");
    await flush();

    const entry = (svc as any).processCache.get(session.id);
    expect(entry.currentModel).toBe("moonshotai/kimi-k3");
    entry.callbackRef.hybridRoutingDecisionMade = false;

    child.stdout.write(JSON.stringify({
      type: "control_request",
      request_id: "kimi-web",
      request: {
        subtype: "can_use_tool",
        tool_name: "WebSearch",
        tool_use_id: "kimi-web-use",
        input: { query: "test" },
      },
    }) + "\n");
    await flush();

    const response = writtenMessages(child).find(
      (m) => m.type === "control_response" && m.response?.request_id === "kimi-web",
    );
    expect(response?.response?.response?.behavior).toBe("allow");
  });

  it("protects a final Write from a late gate only after pre-decision read work was observed", async () => {
    const session = makeSession("hybrid-gate-late-delivery");
    await svc.run({
      prompt: "analyze the file and write a report",
      session,
      permissionMode: "acceptEdits",
      onEvent,
      envOverrides: {
        CLAUDE_CODE_USE_OPENAI: "1",
        OPENAI_BASE_URL: "http://127.0.0.1:10086/v1",
        OPENAI_API_KEY: "gw",
        OPENAI_MODEL: "qwen/qwen3.6-27b",
        ANTHROPIC_MODEL: "qwen/qwen3.6-27b",
        CLAUDE_CODE_CRITICAL_MODEL: "moonshotai/kimi-k3",
      },
      routingDecision: {
        target: "local",
        modelName: "qwen/qwen3.6-27b",
        provider: "openrouter",
        reason: "smart-hybrid default",
        confidence: 1,
      },
    } as any);

    // A first-action Write is still gated: V5d does not create a general bypass.
    child.stdout.write(JSON.stringify({
      type: "control_request",
      request_id: "write-first",
      request: {
        subtype: "can_use_tool",
        tool_name: "Write",
        tool_use_id: "write-first-use",
        input: { file_path: "report.md", content: "x" },
      },
    }) + "\n");
    await flush();

    let response = writtenMessages(child).find(
      (m) => m.type === "control_response" && m.response?.request_id === "write-first",
    );
    expect(response?.response?.response?.behavior).toBe("deny");

    // Read/Grep/Glob can bypass can_use_tool. Observe the real assistant stream instead.
    child.stdout.write(JSON.stringify({
      type: "assistant",
      message: {
        content: [{
          type: "tool_use",
          id: "read-direct",
          name: "Read",
          input: { file_path: "input.log" },
        }],
        model: "qwen/qwen3.6-27b",
      },
    }) + "\n");
    await flush();

    child.stdout.write(JSON.stringify({
      type: "control_request",
      request_id: "write-late",
      request: {
        subtype: "can_use_tool",
        tool_name: "Write",
        tool_use_id: "write-late-use",
        input: { file_path: "report.md", content: "done" },
      },
    }) + "\n");
    await flush();

    response = writtenMessages(child).find(
      (m) => m.type === "control_response" && m.response?.request_id === "write-late",
    );
    expect(response?.response?.response?.behavior).toBe("allow");
  });

  it("resets the routing gate on the next reused user turn", async () => {
    const session = makeSession("hybrid-gate-reset");
    const options = {
      prompt: "turn one",
      session,
      permissionMode: "default",
      onEvent,
      envOverrides: {
        CLAUDE_CODE_USE_OPENAI: "1",
        OPENAI_BASE_URL: "http://127.0.0.1:10086/v1",
        OPENAI_API_KEY: "gw",
        OPENAI_MODEL: "qwen/qwen3.6-27b",
        ANTHROPIC_MODEL: "qwen/qwen3.6-27b",
        CLAUDE_CODE_CRITICAL_MODEL: "moonshotai/kimi-k3",
      },
      routingDecision: {
        target: "local",
        modelName: "qwen/qwen3.6-27b",
        provider: "openrouter",
        reason: "smart-hybrid default",
        confidence: 1,
      },
    } as any;

    await svc.run(options);

    child.stdout.write(JSON.stringify({
      type: "control_request",
      request_id: "turn1-create",
      request: {
        subtype: "can_use_tool",
        tool_name: "TaskCreate",
        tool_use_id: "turn1-create-use",
        input: { subject: "route", description: "route", critical: false },
      },
    }) + "\n");
    await flush();

    await svc.run({ ...options, prompt: "turn two" });

    child.stdout.write(JSON.stringify({
      type: "control_request",
      request_id: "turn2-web",
      request: {
        subtype: "can_use_tool",
        tool_name: "WebSearch",
        tool_use_id: "turn2-web-use",
        input: { query: "again" },
      },
    }) + "\n");
    await flush();

    const response = writtenMessages(child).find(
      (m) => m.type === "control_response" && m.response?.request_id === "turn2-web",
    );
    expect(response?.response?.response?.behavior).toBe("deny");
  });


  it("forces Smart Hybrid bypassPermissions through can_use_tool so the gate cannot be skipped", async () => {
    const session = makeSession("hybrid-gate-bypass");
    await svc.run({
      prompt: "research this",
      session,
      permissionMode: "bypassPermissions",
      onEvent,
      envOverrides: {
        CLAUDE_CODE_USE_OPENAI: "1",
        OPENAI_BASE_URL: "http://127.0.0.1:10086/v1",
        OPENAI_API_KEY: "gw",
        OPENAI_MODEL: "qwen/qwen3.6-27b",
        ANTHROPIC_MODEL: "qwen/qwen3.6-27b",
        CLAUDE_CODE_CRITICAL_MODEL: "moonshotai/kimi-k3",
      },
      routingDecision: {
        target: "local",
        modelName: "qwen/qwen3.6-27b",
        provider: "openrouter",
        reason: "smart-hybrid default",
        confidence: 1,
      },
    } as any);

    const spawnArgs = spawnMock.mock.calls[0]?.[1] as string[];
    const modeIndex = spawnArgs.indexOf("--permission-mode");
    expect(modeIndex).toBeGreaterThanOrEqual(0);
    expect(spawnArgs[modeIndex + 1]).toBe("default");

    child.stdout.write(JSON.stringify({
      type: "control_request",
      request_id: "bypass-web-before",
      request: {
        subtype: "can_use_tool",
        tool_name: "WebSearch",
        tool_use_id: "bypass-web-use",
        input: { query: "test" },
      },
    }) + "\n");
    await flush();

    const response = writtenMessages(child).find(
      (m) => m.type === "control_response" && m.response?.request_id === "bypass-web-before",
    );
    expect(response?.response?.response?.behavior).toBe("deny");
  });

});
