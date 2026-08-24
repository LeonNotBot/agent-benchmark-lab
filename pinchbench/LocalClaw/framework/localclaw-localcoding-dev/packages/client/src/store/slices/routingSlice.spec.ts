import { describe, it, expect } from "vitest";
import { isUsableSelection, resolveRunConfig } from "./routingSlice";

const usable = [
  { id: "sky", models: [{ id: "claude-sonnet-4-6" }, { id: "claude-haiku-4-5" }] },
  { id: "openrouter", models: [{ id: "deepseek/deepseek-v4-pro" }] },
];

describe("isUsableSelection", () => {
  it("命中：endpoint + model 都在表内 → true", () => {
    expect(isUsableSelection(usable, "sky", "claude-sonnet-4-6")).toBe(true);
    expect(isUsableSelection(usable, "openrouter", "deepseek/deepseek-v4-pro")).toBe(true);
  });

  it("endpoint 被删（id 不在表内）→ false", () => {
    expect(isUsableSelection(usable, "deleted-ep", "claude-sonnet-4-6")).toBe(false);
  });

  it("model 改名（endpoint 在但 model 不在）→ false", () => {
    expect(isUsableSelection(usable, "sky", "claude-opus-4-7")).toBe(false);
  });

  it("空 endpointId / 空 model / 空表 → false", () => {
    expect(isUsableSelection(usable, undefined, "claude-sonnet-4-6")).toBe(false);
    expect(isUsableSelection(usable, "sky", undefined)).toBe(false);
    expect(isUsableSelection(usable, "", "")).toBe(false);
    expect(isUsableSelection([], "sky", "claude-sonnet-4-6")).toBe(false);
  });
});

// resolveRunConfig 原子取值：每层归约成完整 RunTarget 再整层竞争（会话 > draft > selectedModel）。
describe("resolveRunConfig 运行目标解析", () => {
  it("会话单模型优先于 draft 与 selectedModel", () => {
    const r = resolveRunConfig(
      { model: "s-model", endpointId: "s-ep" },
      { model: "d-model", endpointId: "d-ep" },
      { model: "g-model", endpointId: "g-ep" },
    );
    expect(r.target).toEqual({ kind: "single", model: "s-model", endpointId: "s-ep" });
  });

  it("无会话字段时回落 draft，再回落全局 selectedModel", () => {
    expect(resolveRunConfig(undefined, { model: "d", endpointId: "de" }, { model: "g", endpointId: "ge" }).target)
      .toEqual({ kind: "single", model: "d", endpointId: "de" });
    expect(resolveRunConfig(undefined, undefined, { model: "g", endpointId: "ge" }).target)
      .toEqual({ kind: "single", model: "g", endpointId: "ge" });
  });

  it("会话选 smartHybrid → 返回 hybrid target", () => {
    const sh = { defaultModel: { endpointId: "sky", model: "claude-haiku-4-5" }, upgradeModel: { endpointId: "sky", model: "claude-sonnet-4-6" } };
    const r = resolveRunConfig({ smartHybrid: sh } as any, undefined, { model: "g", endpointId: "ge" });
    expect(r.target).toEqual({ kind: "hybrid", config: sh });
  });

  it("原子性：会话选 SH，draft 有单模型 → 不跨层混，取会话的 hybrid（裂缝回归）", () => {
    const sh = { defaultModel: { endpointId: "sky", model: "claude-haiku-4-5" }, upgradeModel: { endpointId: "sky", model: "claude-sonnet-4-6" } };
    const r = resolveRunConfig({ smartHybrid: sh } as any, { model: "d", endpointId: "de" }, undefined);
    // 关键：draft 的 model 绝不能漏进来
    expect(r.target).toEqual({ kind: "hybrid", config: sh });
  });

  it("三层都无完整 target → target 为 null（强约束，发送应被拦）", () => {
    expect(resolveRunConfig(undefined, undefined, undefined).target).toBeNull();
    // 半残单模型（只有 model 无 endpointId）不构成完整 target
    expect(resolveRunConfig({ model: "x" } as any, undefined, undefined).target).toBeNull();
  });

  it("permissionMode 正交：独立逐层回退，与 target 无关", () => {
    const r = resolveRunConfig({ permissionMode: "plan" } as any, undefined, { model: "g", endpointId: "ge" });
    expect(r.permissionMode).toBe("plan");
    expect(r.target).toEqual({ kind: "single", model: "g", endpointId: "ge" });
  });
});
