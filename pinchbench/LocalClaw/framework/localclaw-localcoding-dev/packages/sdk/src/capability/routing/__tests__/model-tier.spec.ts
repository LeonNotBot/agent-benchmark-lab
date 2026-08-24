import { describe, it, expect } from "vitest";
import { modelTier } from "../endpoint-registry.service";

describe("modelTier", () => {
  it("识别 haiku 各种别名", () => {
    expect(modelTier("claude-haiku-4-5")).toBe("haiku");
    expect(modelTier("claude-3-5-haiku-20241022")).toBe("haiku");
    expect(modelTier("claude-3-5-haiku-latest")).toBe("haiku");
  });

  it("识别 sonnet / opus", () => {
    expect(modelTier("claude-sonnet-4-6")).toBe("sonnet");
    expect(modelTier("claude-opus-4-7")).toBe("opus");
  });

  it("未知模型返回 null", () => {
    expect(modelTier("gpt-5.5")).toBe(null);
    expect(modelTier("deepseek/deepseek-v4")).toBe(null);
  });
});
