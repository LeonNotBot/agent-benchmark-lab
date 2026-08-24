import "reflect-metadata";
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { getAgentSettingsPath } from "@lenovo/agent-sdk";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { GatewayController } from "./gateway.controller";
import { EndpointRegistryService } from "../routing/endpoint-registry.service";

/**
 * 配置矩阵端到端补测(opt-in,默认 skip,需 MATRIX_E2E=1)。
 * 验证自定义 openai-compatible 供应商经网关透传的运行时行为。
 */
const E2E = !!process.env.MATRIX_E2E;
const FAKE = "localclaw-internal";

function readSettings(): any {
  return JSON.parse(readFileSync(getAgentSettingsPath(), "utf8"));
}

@Module({ controllers: [GatewayController], providers: [EndpointRegistryService] })
class MiniGatewayModule {}

describe.skipIf(!E2E)("配置矩阵端到端", () => {
  it("自定义供应商(openai-compatible):upsert 全新 endpoint → 经网关透传 → tool_calls 完整", async () => {
    const PORT = 10097;
    const app = await NestFactory.create(MiniGatewayModule, { logger: false });
    await app.listen(PORT, "127.0.0.1");           // listen 后注册表已 onModuleInit
    const reg = app.get(EndpointRegistryService);

    const or = readSettings().endpoints.find((e: any) => e.id === "openrouter");
    expect(or?.apiKey).toBeTruthy();

    const customId = "my-custom-provider-test";
    reg.upsert({
      id: customId, label: "我的自定义供应商", apiType: "openai-compatible",
      baseUrl: or.baseUrl, apiKey: or.apiKey, enabled: true,
      models: [{ id: "deepseek/deepseek-v4-flash", label: "DS" }],
    } as any);

    try {
      const resp = await fetch(`http://127.0.0.1:${PORT}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${FAKE}` },
        body: JSON.stringify({
          model: "deepseek/deepseek-v4-flash", max_tokens: 300, stream: true, tool_choice: "auto",
          tools: [{ type: "function", function: { name: "get_weather", description: "查天气", parameters: { type: "object", properties: { city: { type: "string" } }, required: ["city"] } } }],
          messages: [{ role: "user", content: "北京天气？必须调用 get_weather" }],
        }),
      });
      expect(resp.status).toBe(200);
      let raw = ""; const r = (resp.body as any).getReader(); const dec = new TextDecoder();
      while (true) { const { done, value } = await r.read(); if (done) break; raw += dec.decode(value, { stream: true }); }
      let name = "", finish = "";
      for (const ln of raw.split("\n")) { if (!ln.startsWith("data:")) continue; const d = ln.slice(5).trim(); if (d === "[DONE]") continue;
        try { const j = JSON.parse(d); const tc = j.choices?.[0]?.delta?.tool_calls?.[0]; if (tc?.function?.name) name = tc.function.name; if (j.choices?.[0]?.finish_reason) finish = j.choices[0].finish_reason; } catch {} }
      console.log(`[custom] name="${name}" finish=${finish}`);
      expect(name).toBe("get_weather");
      expect(finish).toBe("tool_calls");
    } finally {
      reg.remove(customId);
      await app.close();
    }
  }, 40000);
});
