import { describe, it, expect } from "vitest";
import {
  PROVIDER_DESCRIPTORS,
  genericDescriptor,
  resolveDescriptor,
  resolveUpstream,
  authHeaders,
  type ProviderDescriptor,
} from "./provider-descriptor";
import { ENDPOINT_PRESETS } from "../routing/endpoint-presets";

/** 按 id 取内置 descriptor，找不到即测试失败（避免 undefined 静默通过）。 */
function byId(id: string): ProviderDescriptor {
  const d = PROVIDER_DESCRIPTORS.find((x) => x.id === id);
  if (!d) throw new Error(`descriptor not found: ${id}`);
  return d;
}

describe("ProviderDescriptor — resolveUrl（断言用 key 实测坐实的拓扑）", () => {
  describe("DeepSeek（唯一 shape 偏离：listModels 跨到 OpenAI 侧）", () => {
    const ds = byId("deepseek");

    it("listModels：实测 GET https://api.deepseek.com/v1/models → 200（Bearer）", () => {
      expect(ds.resolveUrl("https://api.deepseek.com/anthropic", "listModels")).toBe(
        "https://api.deepseek.com/v1/models",
      );
      expect(ds.resolveUrl("https://api.deepseek.com/v1", "listModels")).toBe(
        "https://api.deepseek.com/v1/models",
      );
      expect(ds.resolveUrl("https://api.deepseek.com", "listModels")).toBe(
        "https://api.deepseek.com/v1/models",
      );
      expect(ds.authFor("listModels")).toBe("bearer");
    });

    it("messages：实测 POST https://api.deepseek.com/anthropic/v1/messages → 200（x-api-key）", () => {
      expect(ds.resolveUrl("https://api.deepseek.com/anthropic", "messages")).toBe(
        "https://api.deepseek.com/anthropic/v1/messages",
      );
      expect(ds.resolveUrl("https://api.deepseek.com/v1", "messages")).toBe(
        "https://api.deepseek.com/anthropic/v1/messages",
      );
      expect(ds.authFor("messages")).toBe("x-api-key");
    });

    it("幂等：已是 /anthropic 的 baseUrl 不被重复追加", () => {
      expect(ds.resolveUrl("https://api.deepseek.com/anthropic", "messages")).toBe(
        "https://api.deepseek.com/anthropic/v1/messages",
      );
      expect(ds.resolveUrl("https://api.deepseek.com/anthropic/", "messages")).toBe(
        "https://api.deepseek.com/anthropic/v1/messages",
      );
    });

    it("chat 落 OpenAI 侧 /v1/chat/completions（Bearer）；messages 落 anthropic 侧", () => {
      // DeepSeek 两侧并存：openai-compatible 配置走 chat → OpenAI 侧
      expect(ds.resolveUrl("https://api.deepseek.com/v1", "chat")).toBe(
        "https://api.deepseek.com/v1/chat/completions",
      );
      expect(ds.authFor("chat")).toBe("bearer");
      // anthropic 配置走 messages → anthropic 侧
      expect(ds.resolveUrl("https://api.deepseek.com/anthropic", "messages")).toBe(
        "https://api.deepseek.com/anthropic/v1/messages",
      );
      expect(ds.authFor("messages")).toBe("x-api-key");
    });
  });

  describe("Anthropic 官方", () => {
    const a = byId("anthropic");
    it("messages → {base}/v1/messages，listModels → {base}/v1/models，全 x-api-key", () => {
      expect(a.resolveUrl("https://api.anthropic.com", "messages")).toBe(
        "https://api.anthropic.com/v1/messages",
      );
      expect(a.resolveUrl("https://api.anthropic.com", "listModels")).toBe(
        "https://api.anthropic.com/v1/models",
      );
      expect(a.authFor("messages")).toBe("x-api-key");
      expect(a.authFor("listModels")).toBe("x-api-key");
    });
  });

  it("内置表只含 shape 偏离者（anthropic + deepseek + azure-openai），不为标准上游膨胀", () => {
    expect(PROVIDER_DESCRIPTORS.map((d) => d.id).sort()).toEqual([
      "anthropic",
      "azure-openai",
      "deepseek",
    ]);
  });

  describe("Azure OpenAI（URL 依赖 deployment + api-version，auth=api-key 头）", () => {
    const az = byId("azure-openai");
    const base = "https://my-res.openai.azure.com";

    it("chat：{base}/openai/deployments/{model}/chat/completions?api-version=", () => {
      expect(az.resolveUrl(base, "chat", { model: "gpt-5.5", apiVersion: "2024-10-21" })).toBe(
        "https://my-res.openai.azure.com/openai/deployments/gpt-5.5/chat/completions?api-version=2024-10-21",
      );
    });

    it("listModels：{base}/openai/deployments?api-version=", () => {
      expect(az.resolveUrl(base, "listModels", { apiVersion: "2024-10-21" })).toBe(
        "https://my-res.openai.azure.com/openai/deployments?api-version=2024-10-21",
      );
    });

    it("auth 为 api-key 头形态（既非 Bearer 也非 x-api-key）", () => {
      expect(az.authFor("chat")).toBe("api-key");
      expect(authHeaders("api-key", "k123")).toEqual({ "api-key": "k123" });
    });

    it("host 命中 *.openai.azure.com → azure-openai descriptor", () => {
      expect(resolveDescriptor({ baseUrl: base, apiType: "openai-compatible" }).id).toBe(
        "azure-openai",
      );
    });

    it("resolveUpstream 把 model + endpoint.azure.apiVersion 串进 URL", () => {
      const r = resolveUpstream(
        { baseUrl: base, apiType: "openai-compatible", azure: { apiVersion: "2024-10-21" } },
        { id: "gpt-5.5" },
        "chat",
      );
      expect(r.url).toBe(
        "https://my-res.openai.azure.com/openai/deployments/gpt-5.5/chat/completions?api-version=2024-10-21",
      );
      expect(r.auth).toBe("api-key");
      expect(r.upstreamModel).toBe("gpt-5.5");
    });
  });
});

describe("resolveDescriptor — host 命中优先，否则按 apiType 回落 generic", () => {
  it("api.deepseek.com → deepseek", () => {
    expect(
      resolveDescriptor({ baseUrl: "https://api.deepseek.com/v1", apiType: "openai-compatible" }).id,
    ).toBe("deepseek");
  });
  it("api.anthropic.com → anthropic", () => {
    expect(
      resolveDescriptor({ baseUrl: "https://api.anthropic.com", apiType: "anthropic" }).id,
    ).toBe("anthropic");
  });
  it("openrouter.ai → generic-openai（标准 OpenAI 兼容，无需专属）", () => {
    expect(
      resolveDescriptor({ baseUrl: "https://openrouter.ai/api/v1", apiType: "openai-compatible" }).id,
    ).toBe("generic-openai");
  });
  it("sky 内网域名 + anthropic 类型 → generic-anthropic（修好 quirks 后归此）", () => {
    expect(
      resolveDescriptor({ baseUrl: "https://sky.example.com", apiType: "anthropic" }).id,
    ).toBe("generic-anthropic");
  });
  it("非法 baseUrl 不抛错，按 apiType 回落 generic", () => {
    expect(resolveDescriptor({ baseUrl: "not a url", apiType: "openai-compatible" }).id).toBe(
      "generic-openai",
    );
  });
});

describe("generic — 字面前缀追加，不做隐式 /v1 剥补（修复 404 根因）", () => {
  it("openai 兼容：各家挂载点差异全靠 baseUrl 字符串吸收", () => {
    const g = genericDescriptor("openai-compatible");
    expect(g.authFor("chat")).toBe("bearer");
    // openrouter
    expect(g.resolveUrl("https://openrouter.ai/api/v1", "chat")).toBe(
      "https://openrouter.ai/api/v1/chat/completions",
    );
    expect(g.resolveUrl("https://openrouter.ai/api/v1", "listModels")).toBe(
      "https://openrouter.ai/api/v1/models",
    );
    // qwen compatible-mode/v1
    expect(g.resolveUrl("https://dashscope.aliyuncs.com/compatible-mode/v1", "listModels")).toBe(
      "https://dashscope.aliyuncs.com/compatible-mode/v1/models",
    );
    // zhipu api/paas/v4 —— 不以 /v1 结尾，旧 stripV1 逻辑会拼错成 .../v4/v1/models
    expect(g.resolveUrl("https://open.bigmodel.cn/api/paas/v4", "listModels")).toBe(
      "https://open.bigmodel.cn/api/paas/v4/models",
    );
    // doubao api/v3
    expect(g.resolveUrl("https://ark.cn-beijing.volces.com/api/v3", "chat")).toBe(
      "https://ark.cn-beijing.volces.com/api/v3/chat/completions",
    );
  });

  it("anthropic 通用：x-api-key + /v1/messages | /v1/models", () => {
    const g = genericDescriptor("anthropic");
    expect(g.authFor("messages")).toBe("x-api-key");
    expect(g.resolveUrl("https://sky.example.com", "messages")).toBe(
      "https://sky.example.com/v1/messages",
    );
    expect(g.resolveUrl("https://sky.example.com", "listModels")).toBe(
      "https://sky.example.com/v1/models",
    );
  });

  it("anthropic 根约定：baseUrl 带 /v1（sky seed）剥掉后再加，不拼成 /v1/v1/...", () => {
    const g = genericDescriptor("anthropic");
    // sky 的 seed 存 `${skyBase}/v1`；messages 应是 .../v1/messages 而非 .../v1/v1/messages
    expect(g.resolveUrl("https://sky.example.com/v1", "messages")).toBe(
      "https://sky.example.com/v1/messages",
    );
    expect(g.resolveUrl("https://sky.example.com/v1/", "listModels")).toBe(
      "https://sky.example.com/v1/models",
    );
    // 内置 anthropic descriptor 同此约定
    const a = byId("anthropic");
    expect(a.resolveUrl("https://api.anthropic.com/v1", "messages")).toBe(
      "https://api.anthropic.com/v1/messages",
    );
  });
});

describe("resolveUpstream — 三路径唯一真源（url + upstreamModel + auth 同源）", () => {
  it("DeepSeek messages：anthropic 侧 URL + x-api-key + upstreamModel 回落 id", () => {
    const r = resolveUpstream(
      { baseUrl: "https://api.deepseek.com/anthropic", apiType: "anthropic" },
      { id: "deepseek-v4-pro" },
      "messages",
    );
    expect(r.url).toBe("https://api.deepseek.com/anthropic/v1/messages");
    expect(r.auth).toBe("x-api-key");
    expect(r.upstreamModel).toBe("deepseek-v4-pro");
  });

  it("DeepSeek listModels：跳 OpenAI 侧 + Bearer + 无模型名", () => {
    const r = resolveUpstream(
      { baseUrl: "https://api.deepseek.com/anthropic", apiType: "anthropic" },
      undefined,
      "listModels",
    );
    expect(r.url).toBe("https://api.deepseek.com/v1/models");
    expect(r.auth).toBe("bearer");
    expect(r.upstreamModel).toBeUndefined();
  });

  it("upstreamModel 显式时优先于公开 id（公开名与上游真名解耦）", () => {
    const r = resolveUpstream(
      { baseUrl: "https://api.deepseek.com/anthropic", apiType: "anthropic" },
      { id: "deepseek-anthropic/v4-pro", upstreamModel: "deepseek-v4-pro" },
      "messages",
    );
    expect(r.upstreamModel).toBe("deepseek-v4-pro");
  });

  it("generic openai chat：字面追加 + Bearer", () => {
    const r = resolveUpstream(
      { baseUrl: "https://open.bigmodel.cn/api/paas/v4", apiType: "openai-compatible" },
      { id: "glm-4" },
      "chat",
    );
    expect(r.url).toBe("https://open.bigmodel.cn/api/paas/v4/chat/completions");
    expect(r.auth).toBe("bearer");
  });
});

describe("authHeaders — 集中构造鉴权头", () => {
  it("x-api-key 形态", () => {
    expect(authHeaders("x-api-key", "sk-xxx")).toEqual({ "x-api-key": "sk-xxx" });
  });
  it("bearer 形态", () => {
    expect(authHeaders("bearer", "sk-xxx")).toEqual({ Authorization: "Bearer sk-xxx" });
  });
});

describe("内置 preset 全部路由到预期 descriptor（主流家走 generic，不需专属）", () => {
  it("每个 preset 的 baseUrl 解析出正确 descriptor + chat URL 标准追加", () => {
    for (const p of ENDPOINT_PRESETS) {
      // 模板 baseUrl（如 Azure 的 <resource> 占位）含非法 URL 字符，用户必须改写后才
      // 能路由命中——用真实占位替换后再断言，反映「用户填好资源名」的真实状态。
      const baseUrl = p.baseUrlIsTemplate
        ? p.baseUrl.replace(/<[^>]+>/g, "myres")
        : p.baseUrl;
      const d = resolveDescriptor({ baseUrl, apiType: p.apiType });
      const expected =
        p.id === "deepseek" ? "deepseek" :
        p.id === "anthropic" ? "anthropic" :
        p.id === "azure-openai" ? "azure-openai" :
        "generic-openai";
      expect(`${p.id}:${d.id}`).toBe(`${p.id}:${expected}`);
    }
  });

  it("openai 兼容 preset 的 chat URL = baseUrl + /chat/completions（挂载点由 baseUrl 承载）", () => {
    const cases: Record<string, string> = {
      qwen: "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
      zhipu: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
      doubao: "https://ark.cn-beijing.volces.com/api/v3/chat/completions",
      gemini: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    };
    for (const [id, url] of Object.entries(cases)) {
      const p = ENDPOINT_PRESETS.find((x) => x.id === id)!;
      const r = resolveUpstream({ baseUrl: p.baseUrl, apiType: p.apiType }, { id: "m" }, "chat");
      expect(`${id}:${r.url}`).toBe(`${id}:${url}`);
      expect(r.auth).toBe("bearer");
    }
  });
});
