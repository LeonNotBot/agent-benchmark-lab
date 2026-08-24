import "reflect-metadata";
import { describe, it, expect } from "vitest";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { GatewayController } from "./gateway.controller";
import { EndpointRegistryService } from "../routing/endpoint-registry.service";

/**
 * 真·端到端透传测试（opt-in，默认 skip）。
 *
 * 启一个**最小但完整的 Nest HTTP 应用**（真实 GatewayController + 真实
 * EndpointRegistryService 读 ~/.localclaw/settings.json），监听本地端口，
 * 然后用真实 HTTP 打 /v1/messages，经完整 HTTP 栈 + 透传路由 → 真实 sky 上游，
 * 断言带工具请求的 tool_use 流逐字节完整回传。
 *
 * 这覆盖单元 spec 覆盖不到的一层：Nest 路由 + body 解析 + 真实注册表 + 真上游。
 * 唯一比生产少的是 CLI 那一跳（CLI 本就只是 HTTP 客户端，行为等价于这里的 fetch）。
 *
 * 触发：SKY_E2E=1 且 settings.json 里存在一个 anthropic 协议、有 key 的 endpoint
 * （或 ANTHROPIC_AUTH_TOKEN/BASE_URL 可 seed 出 sky）。
 */
const E2E = !!process.env.SKY_E2E;
const PORT = 10099;
const FAKE_TOKEN = "localclaw-internal";

@Module({ controllers: [GatewayController], providers: [EndpointRegistryService] })
class MiniGatewayModule {}

describe.skipIf(!E2E)("Gateway 真端到端透传（opt-in）", () => {
  it("CLI 原生 Anthropic 带工具请求经网关透传 → tool_use 零损耗", async () => {
    const app = await NestFactory.create(MiniGatewayModule, { logger: false });
    await app.listen(PORT, "127.0.0.1");
    try {
      const resp = await fetch(`http://127.0.0.1:${PORT}/v1/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": FAKE_TOKEN,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-haiku-4-5",
          max_tokens: 300,
          stream: true,
          tool_choice: { type: "tool", name: "get_weather" },
          tools: [{ name: "get_weather", description: "查天气", input_schema: { type: "object", properties: { city: { type: "string" } }, required: ["city"] } }],
          messages: [{ role: "user", content: "北京天气？" }],
        }),
      });

      expect(resp.status).toBe(200);
      expect(resp.headers.get("content-type") || "").toContain("event-stream");

      const reader = (resp.body as any).getReader();
      const dec = new TextDecoder();
      let raw = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        raw += dec.decode(value, { stream: true });
      }

      // 逐字节透传：工具块、参数分片、结束原因全部到达
      expect(raw).toContain('"type":"tool_use"');
      expect(raw).toContain('"name":"get_weather"');
      expect(raw).toContain('"type":"input_json_delta"');
      expect(raw).toContain('"stop_reason":"tool_use"');
    } finally {
      await app.close();
    }
  }, 30000);
});
