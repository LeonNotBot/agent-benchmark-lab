import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * createAgent 端到端冒烟测试。
 *
 * 跑通门面全链路：createAgent → 启动 Nest context（真实装配 Runner/Session/Routing
 * 依赖闭包）→ 创建会话 → 落库 → onEvent 事件流 → AsyncIterable 消费。
 * 唯一 stub 的边界是 RunnerService.prototype.createRunner（它最终 spawn CLI 子进程），
 * 由 spy 经 onEvent 推送消息——不连真模型、不起进程，但验证「接入方按 README
 * 几行代码能否跑通」。RunnerService 实例本身是真实的，DI 装配若坏会立即暴露。
 */
import { createAgent } from "../create-agent";
import { RunnerService } from "../../capability/runner/runner.service";

// stub 进程边界：按入参 onEvent 同步推一条 stream.message + completed。
let createRunnerSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  createRunnerSpy = vi
    .spyOn(RunnerService.prototype, "createRunner")
    .mockImplementation(async (input: any) => {
      input.onEvent({
        type: "stream.message",
        payload: { message: { type: "assistant", text: "hello from stub" } },
      });
      input.onEvent({ type: "session.status", payload: { status: "completed" } });
      return { handle: { abort: vi.fn() }, envOverrides: {} } as any;
    });
});
afterEach(() => createRunnerSpy.mockRestore());

async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const m of it) out.push(m);
  return out;
}

describe("createAgent 冒烟", () => {
  it("用内存库跑通一次对话，收到消息流并以 completed 结束", async () => {
    const agent = await createAgent({ dbPath: ":memory:" });
    try {
      const messages = await collect(agent.run({ prompt: "写个贪吃蛇" }));
      expect(messages.length).toBeGreaterThan(0);
      expect((messages[0] as any).text).toBe("hello from stub");
      expect(agent.lastSessionId).toBeTruthy();
      expect(createRunnerSpy).toHaveBeenCalledTimes(1);
      expect((createRunnerSpy.mock.calls[0][0] as any).prompt).toBe("写个贪吃蛇");
    } finally {
      await agent.dispose();
    }
  });

  it("续接会话：第二次 run 传入 sessionId 复用同一会话", async () => {
    const agent = await createAgent({ dbPath: ":memory:" });
    try {
      await collect(agent.run({ prompt: "第一轮" }));
      const sid = agent.lastSessionId;
      await collect(agent.run({ prompt: "第二轮", sessionId: sid }));
      expect(agent.lastSessionId).toBe(sid);
      expect(createRunnerSpy).toHaveBeenCalledTimes(2);
    } finally {
      await agent.dispose();
    }
  });

  it("缺少 db/dbPath 时抛出明确错误", async () => {
    await expect(createAgent({})).rejects.toThrow(/db 或 dbPath/);
  });
});
