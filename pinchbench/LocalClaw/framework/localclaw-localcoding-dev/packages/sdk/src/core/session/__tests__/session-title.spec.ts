import { describe, it, expect, vi, beforeEach } from "vitest";
import BetterSqlite3 from "better-sqlite3";
import { runSdkMigrations } from "../../../database/database.migrations";

/**
 * generateSessionTitle 降级契约测试。
 *
 * 该方法调用 LLM(unstable_v2_prompt),返回什么标题不可断言;但接入方真正依赖的
 * 契约是稳定的:**永远返回非空 string,LLM 失败/超时也绝不抛错**。这里用 vi.mock
 * 拦截 LLM,锁住「成功取 result」「失败回退截断输入」「null 输入回退默认」三条契约。
 */

// 模块级 mock:拦截 SDK 的 LLM 调用。各用例用 mockImpl 改写行为。
const promptMock = vi.fn();
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  unstable_v2_prompt: (...args: unknown[]) => promptMock(...args),
}));

// 在 mock 之后再 import 被测类,确保拿到打桩后的依赖
const { SessionService } = await import("../session.service");

let svc: InstanceType<typeof SessionService>;
beforeEach(() => {
  const db = new BetterSqlite3(":memory:");
  runSdkMigrations(db);
  svc = new SessionService(db);
  promptMock.mockReset();
});

describe("generateSessionTitle — 降级契约", () => {
  it("null 输入直接回退到 New Session,不调用 LLM", async () => {
    expect(await svc.generateSessionTitle(null)).toBe("New Session");
    expect(promptMock).not.toHaveBeenCalled();
  });

  it("LLM 成功:返回去空白后的标题", async () => {
    promptMock.mockResolvedValue({ result: "  贪吃蛇游戏  " });
    expect(await svc.generateSessionTitle("帮我写贪吃蛇")).toBe("贪吃蛇游戏");
  });

  it("LLM 抛错:回退到截断的用户输入,绝不抛错", async () => {
    promptMock.mockRejectedValue(new Error("LLM down"));
    const long = "字".repeat(50); // 确保 >40,触发截断分支
    const title = await svc.generateSessionTitle(long);
    expect(title).toBe(long.slice(0, 40) + "...");
    expect(title.length).toBe(43);
  });

  it("LLM 抛错且输入较短:原样返回,不加省略号", async () => {
    promptMock.mockRejectedValue(new Error("LLM down"));
    expect(await svc.generateSessionTitle("短输入")).toBe("短输入");
  });

  it("LLM 返回空串:同样回退到输入(不返回空标题)", async () => {
    promptMock.mockResolvedValue({ result: "   " });
    expect(await svc.generateSessionTitle("短输入")).toBe("短输入");
  });
});
