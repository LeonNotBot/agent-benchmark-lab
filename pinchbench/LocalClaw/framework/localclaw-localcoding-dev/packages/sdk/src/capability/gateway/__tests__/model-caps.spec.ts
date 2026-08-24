import { describe, it, expect, vi, afterEach } from "vitest";
import { resolveOutputCap, clampMaxTokens } from "../model-caps";
import { logger } from "../../../util/logger";

describe("resolveOutputCap", () => {
  it("使用 endpoint 配置的 maxOutputTokens 优先", () => {
    expect(resolveOutputCap("claude-sonnet-4-6", 100000)).toBe(100000);
  });

  it("sonnet/opus 默认 64000", () => {
    expect(resolveOutputCap("claude-sonnet-4-6")).toBe(64000);
    expect(resolveOutputCap("claude-opus-4-7")).toBe(64000);
  });

  it("haiku 默认 32000", () => {
    expect(resolveOutputCap("claude-haiku-4-5")).toBe(32000);
  });

  it("第三方模型按前缀匹配", () => {
    expect(resolveOutputCap("deepseek/deepseek-v4-pro")).toBe(32000);
    expect(resolveOutputCap("openai/gpt-5.5")).toBe(64000);
  });

  it("未知模型回退到兜底(32768，当代模型安全下限)", () => {
    expect(resolveOutputCap("some-unknown-model")).toBe(32768);
  });

  it("configured 为 0 或负数时忽略，走默认表", () => {
    expect(resolveOutputCap("claude-sonnet-4-6", 0)).toBe(64000);
    expect(resolveOutputCap("claude-sonnet-4-6", -1)).toBe(64000);
  });
});

describe("resolveOutputCap 兜底告警（止血：不静默截断）", () => {
  afterEach(() => vi.restoreAllMocks());

  it("命中未知模型兜底时 warn，且消息含模型名与 cap", () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    resolveOutputCap("brand-new-model-x");
    expect(warn).toHaveBeenCalledOnce();
    const msg = String(warn.mock.calls[0][0]);
    expect(msg).toContain("brand-new-model-x");
    expect(msg).toContain("32768");
  });

  it("已知模型 / 已配置 maxOutputTokens 不告警", () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    resolveOutputCap("claude-sonnet-4-6");        // 命中内置表
    resolveOutputCap("anything", 100000);          // 用户已配置
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("clampMaxTokens", () => {
  it("超过 cap 时裁剪到 cap（复现 128000 > 64000 的报错场景）", () => {
    expect(clampMaxTokens(128000, 64000)).toBe(64000);
  });

  it("低于 cap 时保持原值", () => {
    expect(clampMaxTokens(8192, 64000)).toBe(8192);
  });

  it("缺失/非法 max_tokens 时返回 cap", () => {
    expect(clampMaxTokens(undefined, 64000)).toBe(64000);
    expect(clampMaxTokens(0, 64000)).toBe(64000);
    expect(clampMaxTokens("abc", 64000)).toBe(64000);
  });
});
