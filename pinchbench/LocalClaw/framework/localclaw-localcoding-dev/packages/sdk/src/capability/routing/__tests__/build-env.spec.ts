import { describe, it, expect } from "vitest";
import { buildGatewayEnv, buildGatewayAnthropicEnv, buildDirectEnv } from "../smart-hybrid.service";

describe("buildGatewayEnv（OpenAI 网关模式）", () => {
  it("设 CLAUDE_CODE_USE_OPENAI=1 指向本地网关", () => {
    const env = buildGatewayEnv("claude-sonnet-4-6");
    expect(env.CLAUDE_CODE_USE_OPENAI).toBe("1");
    expect(env.OPENAI_BASE_URL).toContain("127.0.0.1");
    expect(env.OPENAI_MODEL).toBe("claude-sonnet-4-6");
  });

  it("不钉 OPENAI_DEFAULT_HAIKU_MODEL —— 让 CLI fallback 自动跟随 OPENAI_MODEL（换模型不馊）", () => {
    // 回归锁:钉成独立副本后,运行时 set_model 只改 OPENAI_MODEL、这个副本不跟上 →
    // 换模型后小请求(compact/标题)发旧主模型名 = 馊。不钉 → CLI getDefaultHaikuModel()
    // fallback 到实时 OPENAI_MODEL,永远是当前主模型(上游认得的精确 id)。
    const env = buildGatewayEnv("claude-sonnet-4-6");
    expect(env.OPENAI_DEFAULT_HAIKU_MODEL).toBeUndefined();
  });
});

describe("buildGatewayAnthropicEnv（Anthropic 原生网关模式）", () => {
  it("指向网关但不设 CLAUDE_CODE_USE_OPENAI（CLI 走原生协议、网关透传、零转换）", () => {
    const env = buildGatewayAnthropicEnv("claude-opus-4-8");
    // 关键：不进 OpenAI 模式 —— 这是 tool_use 不被吞的根本
    expect(env.CLAUDE_CODE_USE_OPENAI).toBeUndefined();
    expect(env.OPENAI_BASE_URL).toBeUndefined();
    // ANTHROPIC_BASE_URL 指向网关根（不含 /v1，CLI 自补 /v1/messages）
    expect(env.ANTHROPIC_BASE_URL).toContain("127.0.0.1");
    expect(env.ANTHROPIC_BASE_URL).not.toMatch(/\/v1\/?$/);
    // 用网关假 token，真实上游 key 由网关注入（多用户隔离）
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe("localclaw-internal");
    expect(env.ANTHROPIC_MODEL).toBe("claude-opus-4-8");
    expect(env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe("claude-opus-4-8");
  });
});

describe("buildDirectEnv（直连模式）", () => {
  it("不设 CLAUDE_CODE_USE_OPENAI / OPENAI_*，只钉主模型", () => {
    const env = buildDirectEnv("claude-opus-4-8");
    expect(env.CLAUDE_CODE_USE_OPENAI).toBeUndefined();
    expect(env.OPENAI_BASE_URL).toBeUndefined();
    expect(env.ANTHROPIC_MODEL).toBe("claude-opus-4-8");
    expect(env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe("claude-opus-4-8");
  });

  it("不含 OPENAI 标记是关键：buildSpawnEnv 据此保留 ANTHROPIC_BASE_URL/TOKEN", () => {
    // 直连模式 env 里没有 CLAUDE_CODE_USE_OPENAI=1，
    // 因此 buildSpawnEnv 的删除分支不触发，process.env 的 ANTHROPIC_* 得以继承给 CLI
    const env = buildDirectEnv("m");
    expect(env.CLAUDE_CODE_USE_OPENAI).not.toBe("1");
  });
});
