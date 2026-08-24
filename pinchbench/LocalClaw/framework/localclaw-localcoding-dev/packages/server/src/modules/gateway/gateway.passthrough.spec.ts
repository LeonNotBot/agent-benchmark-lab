import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GatewayController } from "./gateway.controller";

/**
 * 透传网关回归测试。
 *
 * 核心保护：Anthropic 上游的 tool_use 流必须**逐字节原样**回传给 CLI，
 * 不被解析 / 转换 / 丢弃——这是 sky 走网关「发一半」根因的回归防线。
 *
 * 上游真实事件结构来自实测抓取（sky.tinyandbeautiful.com /v1/messages 带工具请求）：
 *   content_block_start{tool_use} → input_json_delta → content_block_stop → message_delta{stop_reason:tool_use}
 */

// 实测抓取的 Anthropic tool_use SSE（精确字节，含工具 id/name 与参数分片）。
const TOOL_USE_SSE = [
  `event: message_start`,
  `data: {"type":"message_start","message":{"id":"msg_x","role":"assistant","content":[]}}`,
  ``,
  `event: content_block_start`,
  `data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"tooluse_mQxLtSIY","name":"get_weather","input":{}}}`,
  ``,
  `event: content_block_delta`,
  `data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"city\\": \\"Beijing\\"}"}}`,
  ``,
  `event: content_block_stop`,
  `data: {"type":"content_block_stop","index":0}`,
  ``,
  `event: message_delta`,
  `data: {"type":"message_delta","delta":{"stop_reason":"tool_use"}}`,
  ``,
].join("\n");

const GATEWAY_TOKEN = "localclaw-internal";
const REAL_KEY = "sk-real-upstream-key-xxxxx";

/** 构造一个 fake EndpointRegistryService，把模型解析到一个 anthropic endpoint。 */
function fakeRegistry(overrides: Partial<any> = {}) {
  return {
    resolveModel: vi.fn((modelId: string) => ({
      endpoint: { id: "sky", baseUrl: "https://sky.example.com", apiKey: REAL_KEY, apiType: "anthropic" },
      upstreamModel: modelId,
      model: { id: modelId },
    })),
    hasUsableEndpoint: vi.fn(() => true),
    getEnabled: vi.fn(() => []),
    ...overrides,
  } as any;
}

/** 构造一个捕获写入的 fake Express Response。 */
function fakeRes() {
  const chunks: string[] = [];
  const headers: Record<string, string> = {};
  const res: any = {
    statusCode: 200,
    body: undefined as any,
    status: vi.fn((c: number) => { res.statusCode = c; return res; }),
    setHeader: vi.fn((k: string, v: string) => { headers[k] = v; }),
    write: vi.fn((v: any) => { chunks.push(Buffer.from(v).toString("utf8")); return true; }),
    end: vi.fn(() => {}),
    json: vi.fn((o: any) => { res.body = o; return res; }),
    send: vi.fn((o: any) => { res.body = o; return res; }),
  };
  return { res, chunks, headers, getWritten: () => chunks.join("") };
}

/** 把字符串包成一个 web ReadableStream（带 getReader），模拟 upstream.body 单块下发。 */
function streamOf(text: string) {
  const bytes = new TextEncoder().encode(text);
  let sent = false;
  return {
    getReader() {
      return {
        read: async () => (sent ? { done: true, value: undefined } : ((sent = true), { done: false, value: bytes })),
      };
    },
  };
}

describe("GatewayController /v1/messages 透传", () => {
  let captured: { url: string; init: any } | null = null;

  beforeEach(() => {
    captured = null;
    // fetchWithRetry 内部用 global fetch；这里桩成返回 tool_use SSE。
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: any) => {
      captured = { url, init };
      return {
        ok: true,
        status: 200,
        headers: new Map([["content-type", "text/event-stream"]]) as any,
        body: streamOf(TOOL_USE_SSE),
      } as any;
    }));
  });

  afterEach(() => vi.unstubAllGlobals());

  function makeReq(body: any, headers: Record<string, any> = {}) {
    return {
      headers: { authorization: `Bearer ${GATEWAY_TOKEN}`, ...headers },
      body,
    } as any;
  }

  it("tool_use 流逐字节原样透传（不丢工具名/参数/结束原因）", async () => {
    const ctrl = new GatewayController(fakeRegistry());
    const { res, getWritten } = fakeRes();

    await ctrl.messages(
      makeReq({ model: "claude-haiku-4-5", max_tokens: 300, stream: true, messages: [] }),
      res,
    );

    const out = getWritten();
    // 原样字节：工具块、参数分片、结束原因都在
    expect(out).toBe(TOOL_USE_SSE);
    expect(out).toContain(`"type":"tool_use"`);
    expect(out).toContain(`"name":"get_weather"`);
    expect(out).toContain(`"type":"input_json_delta"`);
    expect(out).toContain(`"stop_reason":"tool_use"`);
    expect(res.end).toHaveBeenCalled();
  });

  it("打到上游 /v1/messages，注入真实 key 而非网关假 token", async () => {
    const ctrl = new GatewayController(fakeRegistry());
    const { res } = fakeRes();

    await ctrl.messages(
      makeReq({ model: "claude-haiku-4-5", max_tokens: 100, stream: true, messages: [] }),
      res,
    );

    expect(captured!.url).toBe("https://sky.example.com/v1/messages");
    expect(captured!.init.headers["x-api-key"]).toBe(REAL_KEY);
    // 网关假 token 不得泄漏到上游
    expect(JSON.stringify(captured!.init.headers)).not.toContain(GATEWAY_TOKEN);
  });

  it("max_tokens 超过模型 cap 时裁剪（haiku=32000）", async () => {
    const ctrl = new GatewayController(fakeRegistry());
    const { res } = fakeRes();

    await ctrl.messages(
      makeReq({ model: "claude-haiku-4-5", max_tokens: 128000, stream: true, messages: [] }),
      res,
    );

    const sentBody = JSON.parse(captured!.init.body);
    expect(sentBody.max_tokens).toBe(32000);
  });

  it("x-api-key 形式的网关鉴权也接受", async () => {
    const ctrl = new GatewayController(fakeRegistry());
    const { res, getWritten } = fakeRes();

    await ctrl.messages(
      { headers: { "x-api-key": GATEWAY_TOKEN }, body: { model: "claude-haiku-4-5", max_tokens: 100, messages: [] } } as any,
      res,
    );

    expect(getWritten()).toBe(TOOL_USE_SSE);
  });

  it("鉴权失败返回 401", async () => {
    const ctrl = new GatewayController(fakeRegistry());
    const { res } = fakeRes();

    await ctrl.messages(
      { headers: { authorization: "Bearer wrong" }, body: { model: "x", messages: [] } } as any,
      res,
    );

    expect(res.statusCode).toBe(401);
  });

  it("模型解析不到返回 400 model_not_found", async () => {
    const reg = fakeRegistry({ resolveModel: vi.fn(() => null), hasUsableEndpoint: vi.fn(() => true) });
    const ctrl = new GatewayController(reg);
    const { res } = fakeRes();

    await ctrl.messages(makeReq({ model: "ghost", messages: [] }), res);

    expect(res.statusCode).toBe(400);
    expect(res.body.error.code).toBe("model_not_found");
  });
});

describe("GatewayController /v1/chat/completions 协议错配防护", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, headers: new Map(), body: streamOf("") } as any)));
  });
  afterEach(() => vi.unstubAllGlobals());

  it("anthropic endpoint 走 OpenAI 路径时拒绝并提示用原生 /v1/messages", async () => {
    const ctrl = new GatewayController(fakeRegistry());
    const { res } = fakeRes();

    await ctrl.chatCompletions(
      { headers: { authorization: `Bearer ${GATEWAY_TOKEN}` }, body: { model: "claude-haiku-4-5", messages: [] } } as any,
      res,
    );

    expect(res.statusCode).toBe(400);
    expect(res.body.error.code).toBe("protocol_mismatch");
  });

  it("openai endpoint 走 Anthropic 路径(/v1/messages)时拒绝(反向守卫)", async () => {
    // resolveModel 命中一个 openai-compatible endpoint
    const reg = fakeRegistry({
      resolveModel: vi.fn((modelId: string) => ({
        endpoint: { id: "or", baseUrl: "https://openrouter.ai/api/v1", apiKey: REAL_KEY, apiType: "openai-compatible" },
        upstreamModel: modelId,
        model: { id: modelId },
      })),
    });
    const ctrl = new GatewayController(reg);
    const { res } = fakeRes();

    await ctrl.messages(
      { headers: { authorization: `Bearer ${GATEWAY_TOKEN}` }, body: { model: "gpt-4", messages: [] } } as any,
      res,
    );

    expect(res.statusCode).toBe(400);
    expect(res.body.error.code).toBe("protocol_mismatch");
    expect(res.body.error.message).toContain("/v1/chat/completions");
  });
});

// ── 真实上游 E2E（默认 skip；需 SKY_E2E=1 + ANTHROPIC_AUTH_TOKEN）──────────────
const E2E = !!process.env.SKY_E2E && !!process.env.ANTHROPIC_AUTH_TOKEN;
describe.skipIf(!E2E)("真实上游 tool_use 流（opt-in）", () => {
  it("sky 上游对带工具请求返回 content_block_start{tool_use} + input_json_delta", async () => {
    const base = (process.env.ANTHROPIC_BASE_URL || "https://sky.tinyandbeautiful.com").replace(/\/v1\/?$/, "");
    const resp = await fetch(`${base}/v1/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": process.env.ANTHROPIC_AUTH_TOKEN!,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5",
        max_tokens: 300,
        stream: true,
        tool_choice: { type: "tool", name: "get_weather" },
        tools: [{ name: "get_weather", description: "Get weather", input_schema: { type: "object", properties: { city: { type: "string" } }, required: ["city"] } }],
        messages: [{ role: "user", content: "What is the weather in Beijing?" }],
      }),
    });
    const text = await (resp as any).text();
    expect(text).toContain(`"type":"tool_use"`);
    expect(text).toContain(`"type":"input_json_delta"`);
  });
});
