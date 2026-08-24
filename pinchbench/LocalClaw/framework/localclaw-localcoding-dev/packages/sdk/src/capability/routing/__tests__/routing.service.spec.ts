import { describe, it, expect, beforeEach, vi } from "vitest";

// buildGatewayEnv/buildGatewayAnthropicEnv/buildDirectEnv 是 smart-hybrid 模块的纯函数，
// mock 成可辨识的标记，让 buildEnvForDecision 的分支断言聚焦「走了哪条路」而非 env 细节。
vi.mock("../smart-hybrid.service", () => ({
  SmartHybridService: class {},
  buildGatewayEnv: (model: string) => ({ __via: "gateway", model }),
  buildGatewayAnthropicEnv: (model: string) => ({ __via: "gateway-anthropic", model }),
  buildDirectEnv: (model: string) => ({ __via: "direct", model }),
  buildBedrockEnv: () => { throw new Error("bedrock stub"); },
  buildVertexEnv: () => { throw new Error("vertex stub"); },
  buildFoundryEnv: () => { throw new Error("foundry stub"); },
}));

import { RoutingService } from "../routing.service";

// ── 轻量假依赖：只实现 RoutingService 实际调用到的方法 ──
function makeDeps(over: {
  usableEndpoint?: boolean;
  hasUsableEndpoint?: boolean;
  firstUsableModel?: string | null;
  endpointApiType?: "anthropic" | "openai-compatible";
  endpointChannel?: "gateway" | "direct" | "bedrock" | "vertex" | "foundry";
} = {}) {
  const device = {
    getCapabilities: () => ({ gpuName: null, gpuVramMB: 0, ramMB: 8000, cpuCores: 8, platform: "win32" } as any),
  };
  const smartHybrid = {
    configure: vi.fn(),
    isActive: vi.fn(() => false),
    getConfig: vi.fn(() => null),
    buildEnvOverrides: vi.fn(() => ({ __via: "smart-hybrid" })),
  };
  const endpoints = {
    hasUsableEndpoint: () => over.hasUsableEndpoint ?? over.usableEndpoint ?? false,
    getFirstUsableModel: () => over.firstUsableModel ?? null,
    findModelLabel: (modelId: string) => `label:${modelId}`,
    // apiType 默认 openai-compatible（与 resolveApiType 的保守回落一致），可按用例覆盖。
    getById: (id: string) => ({ id, apiType: over.endpointApiType ?? "openai-compatible", channel: over.endpointChannel }),
    resolveModel: (modelId: string) => ({
      endpoint: { id: "ep1", apiType: over.endpointApiType ?? "openai-compatible" },
      upstreamModel: modelId,
      model: { id: modelId },
    }),
  };
  return { device, smartHybrid, endpoints };
}

function makeService(over = {}) {
  const d = makeDeps(over);
  const svc = new RoutingService(
    d.device as any, d.smartHybrid as any, d.endpoints as any,
  );
  return { svc, ...d };
}

describe("RoutingService 偏好管理", () => {
  it("setPreference 写入并可读回；smart-hybrid 触发 configure", () => {
    const { svc, smartHybrid } = makeService();
    svc.setPreference({ preference: "standard", modelOverride: "m1" });
    expect(svc.getPreference()).toBe("standard");
    expect(smartHybrid.configure).toHaveBeenCalledWith(null);

    svc.setPreference({ preference: "smart-hybrid", smartHybridConfig: { x: 1 } as any });
    expect(smartHybrid.configure).toHaveBeenLastCalledWith({ x: 1 });
  });
});

describe("RoutingService 路由决策", () => {
  it("standard 偏好 → 云端决策，用 modelOverride", async () => {
    const { svc } = makeService({ firstUsableModel: "claude-x" });
    svc.setPreference({ preference: "standard", modelOverride: "my-model" });
    const d = await svc.route();
    expect(d.target).toBe("cloud");
    expect(d.modelName).toBe("my-model");
  });

  it("历史遗留的 local 偏好 → 回退云端默认模型（local 路由已移除）", async () => {
    const { svc } = makeService({ firstUsableModel: "fallback-cloud" });
    // 旧 settings/会话可能残留 preference="local"/"auto"/"cloud"；归一化为 standard 路径，不崩。
    svc.setPreference({ preference: "local" as any });
    const d = await svc.route();
    expect(d.target).toBe("cloud");
    expect(d.modelName).toBe("fallback-cloud");
  });

  it("smart-hybrid 激活 → 走网关默认模型", async () => {
    const { svc, smartHybrid } = makeService();
    smartHybrid.isActive.mockReturnValue(true);
    smartHybrid.getConfig.mockReturnValue({ defaultModel: { model: "gw-model", endpointId: "ep1" } } as any);
    svc.setPreference({ preference: "smart-hybrid" });
    const d = await svc.route();
    expect(d.target).toBe("cloud");
    expect(d.modelName).toBe("gw-model");
  });

  it("standard 默认（未设 modelOverride）→ 云端首个可用模型", async () => {
    const { svc } = makeService({ firstUsableModel: "auto-cloud" });
    const d = await svc.route();
    expect(d.target).toBe("cloud");
    expect(d.modelName).toBe("auto-cloud");
  });

  it("forceCloudDecision 始终云端", async () => {
    const { svc } = makeService({ firstUsableModel: "cloud-x" });
    const d = await svc.forceCloudDecision();
    expect(d.target).toBe("cloud");
  });
});

describe("RoutingService.buildEnvForDecision", () => {
  it("openai-compatible endpoint → OpenAI 网关 env", () => {
    const { svc } = makeService({ endpointApiType: "openai-compatible" });
    const env = svc.buildEnvForDecision({ target: "cloud", modelName: "m", endpointId: "ep1" } as any);
    expect(env).toEqual({ __via: "gateway", model: "m" });
  });

  it("anthropic endpoint → Anthropic 原生网关 env（透传，零转换）", () => {
    const { svc } = makeService({ endpointApiType: "anthropic" });
    const env = svc.buildEnvForDecision({ target: "cloud", modelName: "m", endpointId: "ep1" } as any);
    expect(env).toEqual({ __via: "gateway-anthropic", model: "m" });
  });

  it("无 endpointId 时按模型名反查 apiType（standard 路径）", () => {
    const { svc } = makeService({ endpointApiType: "anthropic" });
    const env = svc.buildEnvForDecision({ target: "cloud", modelName: "m" } as any);
    expect(env).toEqual({ __via: "gateway-anthropic", model: "m" });
  });

  it("channel 缺省（undefined）等价于 gateway，行为不变", () => {
    const { svc } = makeService({ endpointApiType: "openai-compatible", endpointChannel: undefined });
    const env = svc.buildEnvForDecision({ target: "cloud", modelName: "m", endpointId: "ep1" } as any);
    expect(env).toEqual({ __via: "gateway", model: "m" });
  });

  it("channel=direct → 直连 env", () => {
    const { svc } = makeService({ endpointChannel: "direct" });
    const env = svc.buildEnvForDecision({ target: "cloud", modelName: "m", endpointId: "ep1" } as any);
    expect(env).toEqual({ __via: "direct", model: "m" });
  });

  it("channel=bedrock/vertex/foundry → 未落地，抛 stub 错误", () => {
    for (const ch of ["bedrock", "vertex", "foundry"] as const) {
      const { svc } = makeService({ endpointChannel: ch });
      expect(() => svc.buildEnvForDecision({ target: "cloud", modelName: "m", endpointId: "ep1" } as any))
        .toThrowError(`${ch} stub`);
    }
  });

  it("smart-hybrid 激活 → 走 smart-hybrid env（按 default 模型 apiType 选协议）", () => {
    const { svc, smartHybrid } = makeService();
    smartHybrid.isActive.mockReturnValue(true);
    smartHybrid.getConfig.mockReturnValue({
      defaultModel: { endpointId: "ep1", model: "m" },
      upgradeModel: { endpointId: "ep1", model: "u" },
    } as any);
    svc.setPreference({ preference: "smart-hybrid" });
    const env = svc.buildEnvForDecision({ target: "cloud", modelName: "m" } as any);
    expect(env).toEqual({ __via: "smart-hybrid" });
    // 协议由 default 模型 endpoint 的 apiType 决定，传给 buildEnvOverrides；
    // 第二参为 smart-hybrid 配置（default/upgrade 模型），供 gateway 侧路由决策。
    expect(smartHybrid.buildEnvOverrides).toHaveBeenCalledWith("openai-compatible", {
      defaultModel: { endpointId: "ep1", model: "m" },
      upgradeModel: { endpointId: "ep1", model: "u" },
    });
  });
});

describe("RoutingService — getActiveCloudModel（渠道查询真值）", () => {
  it("跟随 setPreference 的 modelOverride，反查 label", () => {
    const { svc } = makeService({ firstUsableModel: "claude-x" });
    svc.setPreference({ preference: "standard", modelOverride: "my-model", endpointId: "ep1" });
    const active = svc.getActiveCloudModel();
    expect(active.modelName).toBe("my-model");
    expect(active.endpointId).toBe("ep1");
    expect(active.label).toBe("label:my-model");
  });

  it("未设 override 时回退到 firstUsableModel", () => {
    const { svc } = makeService({ hasUsableEndpoint: true, firstUsableModel: "fallback-x" });
    const active = svc.getActiveCloudModel();
    expect(active.modelName).toBe("fallback-x");
  });

  it("onActiveModelChange:setPreference 后通知监听器最新模型", () => {
    const { svc } = makeService({ firstUsableModel: "claude-x" });
    const seen: string[] = [];
    const off = svc.onActiveModelChange((m) => seen.push(m.modelName));
    svc.setPreference({ preference: "standard", modelOverride: "model-a" });
    svc.setPreference({ preference: "standard", modelOverride: "model-b" });
    off();
    svc.setPreference({ preference: "standard", modelOverride: "model-c" });
    expect(seen).toEqual(["model-a", "model-b"]); // 取消后不再收到
  });
});

