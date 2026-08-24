import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchWithRetry } from "../fetch-with-retry";

function resp(status: number, bodyText = ""): Response {
  return new Response(bodyText || (status === 200 ? "ok" : "err"), { status });
}

describe("fetchWithRetry", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  async function run(responses: Response[]) {
    const fetchMock = vi.fn();
    responses.forEach((r) => fetchMock.mockResolvedValueOnce(r));
    vi.stubGlobal("fetch", fetchMock);
    const p = fetchWithRetry("http://x/v1/chat/completions", {}, { a: 1 });
    await vi.runAllTimersAsync();
    return { result: await p, calls: fetchMock.mock.calls.length };
  }

  it("首次 200 不重试", async () => {
    const { result, calls } = await run([resp(200)]);
    expect(result.status).toBe(200);
    expect(calls).toBe(1);
  });

  it("间歇 400 Improperly formed request 会重试，最终成功", async () => {
    const { result, calls } = await run([
      resp(400, '{"error":{"message":"Improperly formed request."}}'),
      resp(200),
    ]);
    expect(result.status).toBe(200);
    expect(calls).toBe(2);
  });

  it("5xx 会重试", async () => {
    const { result, calls } = await run([resp(503), resp(200)]);
    expect(result.status).toBe(200);
    expect(calls).toBe(2);
  });

  it("非可重试 400（普通格式错误）不重试", async () => {
    const { result, calls } = await run([resp(400, '{"error":{"message":"invalid model"}}')]);
    expect(result.status).toBe(400);
    expect(calls).toBe(1);
  });

  it("持续 400 Improperly 用尽重试后返回最后一次响应", async () => {
    const bad = () => resp(400, '{"error":{"message":"Improperly formed request."}}');
    const { result, calls } = await run([bad(), bad(), bad(), bad(), bad()]);
    expect(result.status).toBe(400);
    expect(calls).toBe(4); // MAX_ATTEMPTS
  });
});
