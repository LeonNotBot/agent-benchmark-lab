import "reflect-metadata";
import { describe, it, expect } from "vitest";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { GatewayController } from "./gateway.controller";
import { EndpointRegistryService } from "../routing/endpoint-registry.service";

/**
 * openrouter(openai-compatible)端到端透传测试(opt-in,默认 skip)。
 * 验证治本改动没碰坏 OpenAI 路径,且带工具的 tool_calls 流完整(OpenAI 侧的「发一半」防线)。
 * 触发:OR_E2E=1,且 settings.json 里 openrouter endpoint 有可用 key。
 */
const E2E = !!process.env.OR_E2E;
const PORT = 10098;
const FAKE_TOKEN = "localclaw-internal";
// settings.json 里 openrouter 真实拥有的模型之一(便宜快的)
const MODEL = process.env.OR_MODEL || "openai/gpt-5.4-mini";

@Module({ controllers: [GatewayController], providers: [EndpointRegistryService] })
class MiniGatewayModule {}

describe.skipIf(!E2E)("Gateway openrouter 端到端(opt-in)", () => {
  it("OpenAI 路径纯文本流完整(无回归)", async () => {
    const app = await NestFactory.create(MiniGatewayModule, { logger: false });
    await app.listen(PORT, "127.0.0.1");
    try {
      const resp = await fetch(`http://127.0.0.1:${PORT}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${FAKE_TOKEN}` },
        body: JSON.stringify({ model: MODEL, max_tokens: 200, stream: true, messages: [{ role: "user", content: "用一句话介绍杭州" }] }),
      });
      expect(resp.status).toBe(200);
      const reader = (resp.body as any).getReader(); const dec = new TextDecoder(); let raw = "", text = "", finish = "";
      while (true) { const { done, value } = await reader.read(); if (done) break; raw += dec.decode(value, { stream: true }); }
      for (const ln of raw.split("\n")) { if (!ln.startsWith("data:")) continue; const d = ln.slice(5).trim(); if (d === "[DONE]") continue;
        try { const j = JSON.parse(d); const dl = j.choices?.[0]; if (dl?.delta?.content) text += dl.delta.content; if (dl?.finish_reason) finish = dl.finish_reason; } catch {} }
      console.log(`[OR text] chars=${text.length} finish=${finish}`);
      expect(text.length).toBeGreaterThan(0);
      expect(finish).toBeTruthy();
    } finally { await app.close(); }
  }, 40000);

  it("OpenAI 路径带工具:tool_calls 流完整(id/name/arguments 不丢)", async () => {
    const app = await NestFactory.create(MiniGatewayModule, { logger: false });
    await app.listen(PORT + 1, "127.0.0.1");
    try {
      const resp = await fetch(`http://127.0.0.1:${PORT + 1}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${FAKE_TOKEN}` },
        body: JSON.stringify({
          model: MODEL, max_tokens: 300, stream: true,
          tool_choice: "auto",
          tools: [{ type: "function", function: { name: "get_weather", description: "查天气", parameters: { type: "object", properties: { city: { type: "string" } }, required: ["city"] } } }],
          messages: [{ role: "user", content: "北京天气怎么样？必须调用 get_weather 工具" }],
        }),
      });
      expect(resp.status).toBe(200);
      const reader = (resp.body as any).getReader(); const dec = new TextDecoder(); let raw = "";
      while (true) { const { done, value } = await reader.read(); if (done) break; raw += dec.decode(value, { stream: true }); }
      let name = "", args = "", finish = "";
      for (const ln of raw.split("\n")) { if (!ln.startsWith("data:")) continue; const d = ln.slice(5).trim(); if (d === "[DONE]") continue;
        try { const j = JSON.parse(d); const tc = j.choices?.[0]?.delta?.tool_calls?.[0]; if (tc?.function?.name) name = tc.function.name; if (tc?.function?.arguments) args += tc.function.arguments; if (j.choices?.[0]?.finish_reason) finish = j.choices[0].finish_reason; } catch {} }
      console.log(`[OR tools] name="${name}" args="${args}" finish=${finish}`);
      expect(name).toBe("get_weather");
      expect(args).toContain("city");
      expect(finish).toBe("tool_calls");
    } finally { await app.close(); }
  }, 40000);
});
