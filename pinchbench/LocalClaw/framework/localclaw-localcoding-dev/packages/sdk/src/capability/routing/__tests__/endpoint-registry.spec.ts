import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { EndpointRegistryService, ModelIdConflictError, EndpointNotFoundError, findModelIdConflicts } from "../endpoint-registry.service";
import { DEFAULT_CLAUDE_MODELS } from "../endpoint-presets";
import type { EndpointConfig } from "@lenovo/agent-protocol";

// 拦截 settings.json 读写：用内存对象替代真实文件，避免测试污染用户配置。
// EndpointRegistryService 依赖 SDK 的 config/agent-settings（以 readLocalClawSettings
// 别名 import），故 mock 必须打到该模块的真实导出名 readAgentSettings/writeAgentSettings。
const settingsStore: { current: Record<string, unknown> } = { current: {} };
vi.mock("../../../config/agent-settings", () => ({
  readAgentSettings: () => ({ ...settingsStore.current }),
  writeAgentSettings: (s: Record<string, unknown>) => { settingsStore.current = s; },
}));

// 拦截 logger 以断言「改动4A：档位模糊匹配命中即告警」。
const warnSpy = vi.fn();
vi.mock("../../../util/logger", () => ({
  logger: { log: vi.fn(), warn: (...a: unknown[]) => warnSpy(...a), error: vi.fn() },
}));

// 构造一个干净的 service（不触发 onModuleInit，由各用例自行 setAll）
function makeService() {
  settingsStore.current = {};
  return new EndpointRegistryService();
}

const cloud = (over: Partial<EndpointConfig> = {}): EndpointConfig => ({
  id: "or", label: "OpenRouter", apiType: "openai-compatible",
  baseUrl: "https://openrouter.ai/api/v1", apiKey: "sk-x", enabled: true,
  models: [{ id: "m1" }], ...over,
});

describe("EndpointRegistryService 可用性判断", () => {
  let svc: EndpointRegistryService;
  beforeEach(() => { svc = makeService(); });

  it("无 endpoint 时 hasUsableEndpoint=false", () => {
    svc.setAll([]);
    expect(svc.hasUsableEndpoint()).toBe(false);
    expect(svc.getFirstUsableModel()).toBe(null);
  });

  it("云端 endpoint 缺 key 不算可用", () => {
    svc.setAll([cloud({ apiKey: "" })]);
    expect(svc.hasUsableEndpoint()).toBe(false);
  });

  it("云端 endpoint 无模型不算可用", () => {
    svc.setAll([cloud({ models: [] })]);
    expect(svc.hasUsableEndpoint()).toBe(false);
  });

  it("disabled 不算可用", () => {
    svc.setAll([cloud({ enabled: false })]);
    expect(svc.hasUsableEndpoint()).toBe(false);
  });

  it("本地 endpoint 无需 key 即可用", () => {
    svc.setAll([cloud({ id: "ollama", baseUrl: "http://127.0.0.1:11434/v1", apiKey: "" })]);
    expect(svc.hasUsableEndpoint()).toBe(true);
    expect(svc.getFirstUsableModel()).toBe("m1");
  });

  it("getFirstUsableModel 跳过不可用、返回首个可用模型", () => {
    svc.setAll([
      cloud({ id: "bad", apiKey: "", models: [{ id: "x" }] }),
      cloud({ id: "good", apiKey: "sk", models: [{ id: "good-model" }] }),
    ]);
    expect(svc.getFirstUsableModel()).toBe("good-model");
  });
});

describe("create / update（资源级，id 服务端生成）", () => {
  let svc: EndpointRegistryService;
  beforeEach(() => { svc = makeService(); });

  it("create 无 id → 铸 ep_ 内部主键并返回完整对象", () => {
    svc.setAll([]);
    const ep = svc.create({ label: "自定义", apiType: "openai-compatible", baseUrl: "http://x/v1", apiKey: "k", enabled: true, models: [{ id: "m1" }] });
    expect(ep.id).toMatch(/^ep_[0-9a-f]{6}$/);
    expect(svc.getById(ep.id)?.label).toBe("自定义");
  });

  it("create 带预设 id（未占用）→ 沿用该可读 id", () => {
    svc.setAll([]);
    const ep = svc.create({ id: "deepseek", label: "DeepSeek", apiType: "openai-compatible", baseUrl: "http://x/v1", apiKey: "k", enabled: true, models: [{ id: "m1" }] });
    expect(ep.id).toBe("deepseek");
  });

  it("create 带已占用 id → 回退铸新 id（防撞名）", () => {
    svc.setAll([cloud({ id: "deepseek", models: [{ id: "m1" }] })]);
    const ep = svc.create({ id: "deepseek", label: "另一个", apiType: "openai-compatible", baseUrl: "http://y/v1", apiKey: "k", enabled: true, models: [{ id: "m2" }] });
    expect(ep.id).not.toBe("deepseek");
    expect(ep.id).toMatch(/^ep_[0-9a-f]{6}$/);
  });

  it("update 改 label，id 稳定、apiKey 省略不丢", () => {
    const ep = svc.create({ label: "旧", apiType: "openai-compatible", baseUrl: "http://x/v1", apiKey: "secret", enabled: true, models: [{ id: "m1" }] });
    const upd = svc.update(ep.id, { label: "新" });          // 不传 apiKey
    expect(upd.id).toBe(ep.id);
    expect(upd.label).toBe("新");
    expect(svc.getById(ep.id)?.apiKey).toBe("secret");        // 旧 key 保留
  });

  it("update 传新 apiKey → 覆盖旧 key", () => {
    const ep = svc.create({ label: "x", apiType: "openai-compatible", baseUrl: "http://x/v1", apiKey: "old", enabled: true, models: [{ id: "m1" }] });
    svc.update(ep.id, { apiKey: "new" });
    expect(svc.getById(ep.id)?.apiKey).toBe("new");
  });

  it("update 不存在的 id → 抛 EndpointNotFoundError", () => {
    expect(() => svc.update("ep_nope", { label: "x" })).toThrowError(EndpointNotFoundError);
  });
});

describe("remove / upsert", () => {
  let svc: EndpointRegistryService;
  beforeEach(() => { svc = makeService(); });

  it("upsert 覆盖同 id、新增不同 id", () => {
    svc.setAll([cloud()]);
    svc.upsert(cloud({ label: "覆盖" }));
    expect(svc.getAll()).toHaveLength(1);
    expect(svc.getById("or")?.label).toBe("覆盖");
    svc.upsert(cloud({ id: "another", models: [{ id: "m2" }] }));
    expect(svc.getAll()).toHaveLength(2);
  });

  it("upsert 新增引入撞名 → 抛 ModelIdConflictError", () => {
    svc.setAll([cloud({ id: "a", models: [{ id: "dup" }] })]);
    expect(() => svc.upsert(cloud({ id: "b", models: [{ id: "dup" }] }))).toThrowError(ModelIdConflictError);
    // 抛错后不应写入
    expect(svc.getById("b")).toBeUndefined();
  });

  it("remove 删除存在的返回 true、不存在返回 false", () => {
    svc.setAll([cloud()]);
    expect(svc.remove("or")).toBe(true);
    expect(svc.remove("nope")).toBe(false);
    expect(svc.getAll()).toHaveLength(0);
  });
});

describe("testEndpoint 真实路径 + HTML/渠道检测", () => {
  let svc: EndpointRegistryService;
  beforeEach(() => { svc = makeService(); });
  afterEach(() => { vi.restoreAllMocks(); });

  const stubFetch = (status: number, body: string, contentType: string) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(body, { status, headers: { "content-type": contentType } }),
    ));
  };

  it("上游返回 HTML（baseUrl 漏 /v1）→ 提示检查 Base URL", async () => {
    svc.setAll([cloud({ baseUrl: "https://sky.example.com" })]);
    stubFetch(200, "<!doctype html><html></html>", "text/html");
    const r = await svc.testEndpoint("or");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Base URL/);
  });

  it("无可用渠道（distributor）→ 报上游无此模型渠道", async () => {
    svc.setAll([cloud()]);
    stubFetch(503, '{"error":{"message":"分组下模型无可用渠道（distributor）"}}', "application/json");
    const r = await svc.testEndpoint("or");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/渠道/);
  });

  it("401 → 鉴权失败", async () => {
    svc.setAll([cloud()]);
    stubFetch(401, '{"error":"unauthorized"}', "application/json");
    const r = await svc.testEndpoint("or");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/鉴权/);
  });

  it("正常 JSON 响应 → ok", async () => {
    svc.setAll([cloud()]);
    stubFetch(200, '{"choices":[]}', "application/json");
    const r = await svc.testEndpoint("or");
    expect(r.ok).toBe(true);
  });

  it("无模型时直接报错，不发请求", async () => {
    svc.setAll([cloud({ models: [] })]);
    const r = await svc.testEndpoint("or");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/模型/);
  });

  // ── Phase 2.5 测试忠实度：信封结构判定 + 4xx 分级 ──
  it("400 + 模型名无效错误信封（anthropic）→ 失败并回传上游原文", async () => {
    svc.setAll([cloud({ apiType: "anthropic", baseUrl: "https://api.deepseek.com/anthropic" })]);
    stubFetch(
      400,
      '{"type":"error","error":{"type":"invalid_request_error","message":"supported model names are deepseek-v4-pro, deepseek-v4-flash"}}',
      "application/json",
    );
    const r = await svc.testEndpoint("or");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/supported model|无此模型/);
  });

  it("400 + model_not_found（openai 错误信封）→ 失败", async () => {
    svc.setAll([cloud()]);
    stubFetch(400, '{"error":{"code":"model_not_found","message":"The model does not exist"}}', "application/json");
    const r = await svc.testEndpoint("or");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/无此模型|does not exist/);
  });

  it("200 + anthropic thinking-only 截断信封（零 text，stop_reason:max_tokens）→ ok（不误伤）", async () => {
    svc.setAll([cloud({ apiType: "anthropic", baseUrl: "https://api.deepseek.com/anthropic" })]);
    stubFetch(
      200,
      '{"type":"message","role":"assistant","content":[{"type":"thinking","thinking":"..."}],"stop_reason":"max_tokens"}',
      "application/json",
    );
    const r = await svc.testEndpoint("or");
    expect(r.ok).toBe(true);
  });

  it("200 但响应体不是合法 JSON（非 HTML）→ 判失败", async () => {
    svc.setAll([cloud()]);
    stubFetch(200, "not json at all", "application/json");
    const r = await svc.testEndpoint("or");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/JSON/);
  });
});

describe("持久化到 settings.json（单一数据源）", () => {
  let svc: EndpointRegistryService;
  beforeEach(() => { svc = makeService(); });

  it("setAll 写入 settings.json 的 endpoints 字段", () => {
    svc.setAll([cloud()]);
    expect(Array.isArray(settingsStore.current.endpoints)).toBe(true);
    expect((settingsStore.current.endpoints as any[])).toHaveLength(1);
    expect((settingsStore.current.endpoints as any[])[0].id).toBe("or");
  });

  it("persist 保留 settings.json 其余字段", () => {
    settingsStore.current = { techStack: { enabled: true }, mcpServers: { x: 1 } };
    svc.setAll([cloud()]);
    // 不破坏已有字段
    expect(settingsStore.current.techStack).toEqual({ enabled: true });
    expect(settingsStore.current.mcpServers).toEqual({ x: 1 });
    expect((settingsStore.current.endpoints as any[])).toHaveLength(1);
  });

  it("onModuleInit 从 settings.json 加载", () => {
    settingsStore.current = { endpoints: [cloud({ id: "loaded" })] };
    const s2 = new EndpointRegistryService();
    s2.onModuleInit();
    expect(s2.getById("loaded")).toBeDefined();
  });

  it("onModuleInit 清理历史误存的 env-direct 脏数据", () => {
    settingsStore.current = {
      endpoints: [cloud({ id: "real" }), cloud({ id: "env-direct", apiType: "anthropic" })],
    };
    const s2 = new EndpointRegistryService();
    s2.onModuleInit();
    expect(s2.getById("real")).toBeDefined();
    expect(s2.getById("env-direct")).toBeUndefined();
  });
});

describe("公开模型 id 唯一性校验", () => {
  let svc: EndpointRegistryService;
  beforeEach(() => { svc = makeService(); });

  it("跨 enabled endpoint 撞名 → setAll 抛 ModelIdConflictError", () => {
    const epA = cloud({ id: "a", apiKey: "sk", models: [{ id: "gpt-4" }] });
    const epB = cloud({ id: "b", apiKey: "sk", models: [{ id: "gpt-4" }] });
    expect(() => svc.setAll([epA, epB])).toThrowError(ModelIdConflictError);
    try {
      svc.setAll([epA, epB]);
    } catch (e) {
      const err = e as ModelIdConflictError;
      expect(err.conflicts).toHaveLength(1);
      expect(err.conflicts[0].modelId).toBe("gpt-4");
      expect(err.conflicts[0].endpointIds.sort()).toEqual(["a", "b"]);
    }
  });

  it("setAll 同样校验唯一", () => {
    const epA = cloud({ id: "a", apiKey: "sk", models: [{ id: "dup" }] });
    const epB = cloud({ id: "b", apiKey: "sk", models: [{ id: "dup" }] });
    expect(() => svc.setAll([epA, epB])).toThrowError(ModelIdConflictError);
  });

  it("create 引入跨服务撞名 → 抛 ModelIdConflictError，且不写入", () => {
    svc.setAll([cloud({ id: "a", apiKey: "sk", models: [{ id: "dup" }] })]);
    expect(() => svc.create({ label: "b", apiType: "openai-compatible", baseUrl: "http://x/v1", apiKey: "sk", enabled: true, models: [{ id: "dup" }] })).toThrowError(ModelIdConflictError);
    expect(svc.getAll()).toHaveLength(1);
  });

  it("disabled endpoint 不参与唯一性校验", () => {
    const epA = cloud({ id: "a", apiKey: "sk", models: [{ id: "shared" }] });
    const epB = cloud({ id: "b", apiKey: "sk", enabled: false, models: [{ id: "shared" }] });
    expect(() => svc.setAll([epA, epB])).not.toThrow();
  });

  it("不同 id 不冲突", () => {
    const epA = cloud({ id: "a", apiKey: "sk", models: [{ id: "m-a" }] });
    const epB = cloud({ id: "b", apiKey: "sk", models: [{ id: "m-b" }] });
    expect(() => svc.setAll([epA, epB])).not.toThrow();
    expect(svc.getAll()).toHaveLength(2);
  });

  it("findModelIdConflicts 纯函数：无冲突返回空数组", () => {
    expect(findModelIdConflicts([
      cloud({ id: "a", models: [{ id: "x" }] }),
      cloud({ id: "b", models: [{ id: "y" }] }),
    ])).toEqual([]);
  });
});

describe("resolveModel upstreamModel 解耦", () => {
  let svc: EndpointRegistryService;
  beforeEach(() => { svc = makeService(); });

  it("公开 id 与上游真实名解耦：upstreamModel 设置时精确匹配返回它", () => {
    svc.setAll([cloud({
      apiKey: "sk",
      models: [{ id: "bedrock/sonnet", upstreamModel: "claude-sonnet-4-6" }],
    })]);
    const r = svc.resolveModel("bedrock/sonnet");
    expect(r?.upstreamModel).toBe("claude-sonnet-4-6");
    expect(r?.model.id).toBe("bedrock/sonnet");
  });

  it("缺省 upstreamModel 时回落公开 id（兼容历史数据）", () => {
    svc.setAll([cloud({ apiKey: "sk", models: [{ id: "gpt-4" }] })]);
    expect(svc.resolveModel("gpt-4")?.upstreamModel).toBe("gpt-4");
  });

  it("档位模糊匹配也用 upstreamModel", () => {
    svc.setAll([cloud({
      apiKey: "sk", apiType: "anthropic",
      models: [{ id: "my-haiku", upstreamModel: "claude-haiku-4-5" }],
    })]);
    const r = svc.resolveModel("claude-3-5-haiku-20241022");
    expect(r?.upstreamModel).toBe("claude-haiku-4-5");
  });
});

describe("撞名只告警不改数据 + 存量撞名放行", () => {
  beforeEach(() => { settingsStore.current = {}; });

  it("加载含撞名的历史数据时不改名、不动数据（只告警）", () => {
    settingsStore.current = {
      endpoints: [
        { id: "a", label: "A", apiType: "openai-compatible", baseUrl: "https://a", apiKey: "sk", enabled: true, models: [{ id: "shared" }] },
        { id: "b", label: "B", apiType: "openai-compatible", baseUrl: "https://b", apiKey: "sk", enabled: true, models: [{ id: "shared" }, { id: "uniq" }] },
      ],
    };
    const svc = new EndpointRegistryService();
    svc.onModuleInit();
    // 数据原样保留，不静默改名
    expect(svc.getById("a")?.models.map(m => m.id)).toEqual(["shared"]);
    expect(svc.getById("b")?.models.map(m => m.id)).toEqual(["shared", "uniq"]);
  });

  it("存量撞名放行：update 无关 endpoint 不被存量冲突误挡", () => {
    settingsStore.current = {
      endpoints: [
        { id: "a", label: "A", apiType: "openai-compatible", baseUrl: "https://a", apiKey: "sk", enabled: true, models: [{ id: "shared" }] },
        { id: "b", label: "B", apiType: "openai-compatible", baseUrl: "https://b", apiKey: "sk", enabled: true, models: [{ id: "shared" }] },
        { id: "c", label: "C", apiType: "openai-compatible", baseUrl: "https://c", apiKey: "sk", enabled: true, models: [{ id: "uniq" }] },
      ],
    };
    const svc = new EndpointRegistryService();
    svc.onModuleInit();
    // a/b 存量撞 "shared"。用户只改了无关的 c——不应被存量撞名挡住。
    expect(() => svc.update("c", { label: "C2" })).not.toThrow();
    expect(svc.getById("c")?.label).toBe("C2");
  });

  it("新引入的撞名仍被拒绝（即便存量已有别的撞名）", () => {
    settingsStore.current = {
      endpoints: [
        { id: "a", label: "A", apiType: "openai-compatible", baseUrl: "https://a", apiKey: "sk", enabled: true, models: [{ id: "shared" }] },
        { id: "b", label: "B", apiType: "openai-compatible", baseUrl: "https://b", apiKey: "sk", enabled: true, models: [{ id: "shared" }] },
      ],
    };
    const svc = new EndpointRegistryService();
    svc.onModuleInit();
    // 在存量撞名(shared)之外，update b 新引入一个 "newdup" 撞名（也加到 b 自身？不——撞 a）。
    // 这里给 a 也加 newdup 制造新撞名：先给 a 加 newdup，再 update b 加 newdup → 新引入冲突。
    svc.update("a", { models: [{ id: "shared" }, { id: "newdup" }] });
    try {
      svc.update("b", { models: [{ id: "shared" }, { id: "newdup" }] });
      throw new Error("应当抛 ModelIdConflictError");
    } catch (e) {
      expect(e).toBeInstanceOf(ModelIdConflictError);
      const err = e as ModelIdConflictError;
      // 只报新引入的 newdup，不报存量 shared
      expect(err.conflicts.map(c => c.modelId)).toEqual(["newdup"]);
    }
  });
});

describe("加载 + 空壳 ollama 自愈（不再从 env seed 默认端点）", () => {
  const ENV_KEYS = ["ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL", "OPENAI_API_KEY", "OPENAI_BASE_URL"];
  let saved: Record<string, string | undefined>;
  beforeEach(() => {
    settingsStore.current = {};
    saved = {};
    for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
  });
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("无任何 env 的全新安装 → 零 endpoint", () => {
    const svc = new EndpointRegistryService();
    svc.onModuleInit();
    expect(svc.getAll()).toHaveLength(0);
    expect(svc.hasUsableEndpoint()).toBe(false);
  });

  it("有 sky env 的全新安装 → 仍是零 endpoint（env 不再被快照成端点）", () => {
    // 回归锁定：seedDefaults 已删除。env 变量是运行时覆盖层，绝不读出来种端点 +
    // persist 写盘。这正是修掉「异常空读 → 摧毁性 re-seed 覆盖用户配置」数据丢失 bug
    // 的根因之刀——根本不存在 seed 路径。
    process.env.ANTHROPIC_AUTH_TOKEN = "sk-sky";
    process.env.ANTHROPIC_BASE_URL = "https://sky.example.com";
    process.env.OPENAI_API_KEY = "sk-or";
    const svc = new EndpointRegistryService();
    svc.onModuleInit();
    expect(svc.getAll()).toHaveLength(0);
    // 不写盘：settings 仍是空对象，没有被 seed 出来的 endpoints / endpointsSeeded 标记。
    expect(settingsStore.current.endpoints).toBeUndefined();
    expect((settingsStore.current as any).endpointsSeeded).toBeUndefined();
  });

  it("空读保护：文件读空（{}）+ 有 env，绝不覆盖写盘（前数据丢失 bug 的回归锁）", () => {
    // 旧 bug：settings 文件瞬时读空 → 判定首次启动 → seedDefaults + persist 覆盖用户配置。
    // 删 seed 后，空读只是「内存零端点」，不触发任何写盘，磁盘真实配置下次干净重启自动恢复。
    process.env.ANTHROPIC_AUTH_TOKEN = "sk-sky";
    process.env.ANTHROPIC_BASE_URL = "https://sky.example.com";
    settingsStore.current = {}; // 模拟异常空读
    const svc = new EndpointRegistryService();
    svc.onModuleInit();
    expect(svc.getAll()).toHaveLength(0);
    expect(settingsStore.current.endpoints).toBeUndefined(); // 零写盘
  });

  it("存量自愈：旧版固化的空壳 ollama 在加载时被剔除并回写磁盘", () => {
    settingsStore.current = {
      endpoints: [
        { id: "local-ollama", label: "本地 Ollama", apiType: "openai-compatible", baseUrl: "http://127.0.0.1:11434/v1", apiKey: "ollama", enabled: true, models: [] },
        { id: "real", label: "Real", apiType: "openai-compatible", baseUrl: "https://r", apiKey: "sk", enabled: true, models: [{ id: "m1" }] },
      ],
    };
    const svc = new EndpointRegistryService();
    svc.onModuleInit();
    expect(svc.getById("local-ollama")).toBeUndefined();
    expect(svc.getById("real")).toBeDefined();
    expect((settingsStore.current.endpoints as any[]).map(e => e.id)).toEqual(["real"]);
  });

  it("保留用户手动填了模型的 local-ollama 配置（只剔空壳）", () => {
    settingsStore.current = {
      endpoints: [
        { id: "local-ollama", label: "本地 Ollama", apiType: "openai-compatible", baseUrl: "http://127.0.0.1:11434/v1", apiKey: "ollama", enabled: true, models: [{ id: "qwen2.5" }] },
      ],
    };
    const svc = new EndpointRegistryService();
    svc.onModuleInit();
    expect(svc.getById("local-ollama")?.models.map(m => m.id)).toEqual(["qwen2.5"]);
  });
});

describe("resolveModel 档位模糊匹配（改动4A：命中即告警）", () => {
  let svc: EndpointRegistryService;
  beforeEach(() => { svc = makeService(); warnSpy.mockClear(); });

  it("精确匹配 → 不告警", () => {
    svc.setAll([cloud({ id: "sky", apiType: "anthropic", models: [{ id: "claude-haiku-4-5" }] })]);
    const r = svc.resolveModel("claude-haiku-4-5");
    expect(r?.model.id).toBe("claude-haiku-4-5");
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("档位模糊命中（非精确）→ 返回同档模型并告警", () => {
    svc.setAll([cloud({ id: "sky", apiType: "anthropic", models: [{ id: "claude-haiku-4-5" }] })]);
    // 死引用/CLI 内置别名：含 haiku 关键字但非精确 id
    const r = svc.resolveModel("claude-3-5-haiku-20241022");
    expect(r?.model.id).toBe("claude-haiku-4-5");
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0][0])).toContain("模糊路由");
  });

  it("无任何同档模型 → 返回 null，不告警", () => {
    svc.setAll([cloud({ id: "sky", apiType: "anthropic", models: [{ id: "claude-sonnet-4-6" }] })]);
    expect(svc.resolveModel("gpt-5.5")).toBe(null);
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

describe("directEnv → endpoint 一次性迁移（迁移先于 seed；判据=模型 id 撞名，无 upstream 去重）", () => {
  let svc: EndpointRegistryService;
  // 迁移现在在 load/seed **之前**跑，不再有「seed 污染测试」问题 —— 迁移写完
  // settings.endpoints 后，load/seed 看到非空就跳过 seed。但为防万一，仍隔离 env。
  const ENV_KEYS = ["ANTHROPIC_BASE_URL", "ANTHROPIC_AUTH_TOKEN", "OPENAI_API_KEY", "OPENAI_BASE_URL"];
  let savedEnv: Record<string, string | undefined> = {};
  beforeEach(() => {
    savedEnv = {};
    for (const k of ENV_KEYS) { savedEnv[k] = process.env[k]; delete process.env[k]; }
    svc = makeService();
    warnSpy.mockClear();
  });
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  });

  it("完整 directEnv + 无既有 endpoint → create 新 endpoint，id 由 mintId 防撞，删 directEnv", () => {
    settingsStore.current = {
      directEnv: {
        ANTHROPIC_BASE_URL: "https://api.anthropic.com/v1",
        ANTHROPIC_AUTH_TOKEN: "sk-test",
        ANTHROPIC_MODELS: [
          { id: "claude-sonnet-4-6", label: "Sonnet" },
          { id: "claude-opus-4-7", label: "Opus" },
        ],
      },
    };
    svc.onModuleInit();
    const settings = settingsStore.current as any;
    expect(settings.directEnv).toBeUndefined(); // 迁移成功 → 已删
    expect(settings.directEnvArchived).toBeUndefined(); // 成功路径不归档
    expect(Array.isArray(settings.endpoints)).toBe(true);
    const migrated = settings.endpoints.find((e: any) => e.label === "Claude 默认服务");
    expect(migrated).toBeDefined();
    expect(migrated.apiType).toBe("anthropic");
    expect(migrated.baseUrl).toBe("https://api.anthropic.com/v1");
    expect(migrated.enabled).toBe(true);
    expect(migrated.models).toHaveLength(2);
    expect(migrated.id).toMatch(/^ep_[a-f0-9]{6}$/); // mintId 格式
  });

  it("directEnv 只有 ANTHROPIC_MODEL（单值）→ 单模型 endpoint", () => {
    settingsStore.current = {
      directEnv: {
        ANTHROPIC_BASE_URL: "https://sky.example.com",
        ANTHROPIC_AUTH_TOKEN: "sk-sky",
        ANTHROPIC_MODEL: "claude-haiku-4-5",
      },
    };
    svc.onModuleInit();
    const migrated = (settingsStore.current as any).endpoints.find((e: any) => e.label === "Claude 默认服务");
    expect(migrated?.models).toHaveLength(1);
    expect(migrated?.models[0].id).toBe("claude-haiku-4-5");
  });

  it("directEnv 无模型字段 → 回退默认三档（DEFAULT_CLAUDE_MODELS）", () => {
    settingsStore.current = {
      directEnv: {
        ANTHROPIC_BASE_URL: "https://relay.example.com",
        ANTHROPIC_AUTH_TOKEN: "sk-relay",
      },
    };
    svc.onModuleInit();
    const migrated = (settingsStore.current as any).endpoints.find((e: any) => e.label === "Claude 默认服务");
    expect(migrated?.models).toHaveLength(3);
    expect(migrated?.models.map((m: any) => m.id)).toEqual([
      "claude-sonnet-4-6",
      "claude-opus-4-7",
      "claude-haiku-4-5",
    ]);
  });

  it("directEnv 与 process.env 同上游（内网用户典型场景）→ 仅迁移建 1 个，无重复", () => {
    // 回归锁定：旧版「seed→migrate」顺序下，同一份 env 会建 sky(seed) + "Claude 默认服务"
    // (migrate)两个 endpoint，模型 id 撞上 → 静默归档。seedDefaults 删除后，env 不再种
    // 任何端点，directEnv 迁移是 env 凭据进入配置的唯一合法路径 → 只有迁移建的 1 个。
    process.env.ANTHROPIC_BASE_URL = "https://sky.example.com";
    process.env.ANTHROPIC_AUTH_TOKEN = "sk-common";
    settingsStore.current = {
      directEnv: {
        ANTHROPIC_BASE_URL: "https://sky.example.com/v1/", // 同上游（/v1 不对称已吸收）
        ANTHROPIC_AUTH_TOKEN: "sk-common",
      },
    };
    svc.onModuleInit();
    const settings = settingsStore.current as any;
    expect(settings.directEnv).toBeUndefined(); // 迁移成功删除
    expect(settings.directEnvArchived).toBeUndefined(); // 不归档
    expect(settings.endpoints).toHaveLength(1); // 只有迁移建的 1 个
    const migrated = settings.endpoints[0];
    expect(migrated.label).toBe("Claude 默认服务");
    expect(migrated.apiType).toBe("anthropic");
    expect(migrated.models).toHaveLength(3); // DEFAULT_CLAUDE_MODELS
    delete process.env.ANTHROPIC_BASE_URL;
    delete process.env.ANTHROPIC_AUTH_TOKEN;
  });

  it("directEnv 全部模型 id 都被既有 enabled endpoint 占用 → 归档，不建死 endpoint", () => {
    // 既有 endpoint 占了 DEFAULT_CLAUDE_MODELS 全三档；directEnv 无 ANTHROPIC_MODELS → 回退同三档
    // → survivors 为空 → 候选每个模型都会被遮蔽，是真·死 endpoint，故归档（凭据留档备查）。
    settingsStore.current = {
      endpoints: [
        {
          id: "my-anthropic",
          label: "我的 Claude",
          apiType: "anthropic",
          baseUrl: "https://api.anthropic.com/v1",
          apiKey: "sk-manual",
          enabled: true,
          models: [
            { id: "claude-sonnet-4-6" },
            { id: "claude-opus-4-7" },
            { id: "claude-haiku-4-5" },
          ],
        },
      ],
      directEnv: {
        ANTHROPIC_BASE_URL: "https://api.anthropic.com",
        ANTHROPIC_AUTH_TOKEN: "sk-old-directenv",
      },
    };
    svc.onModuleInit();
    const settings = settingsStore.current as any;
    expect(settings.directEnv).toBeUndefined();
    expect(settings.directEnvArchived).toBeDefined();
    expect(settings.directEnvArchived._archivedReason).toMatch(/已被现有服务占用/);
    expect(settings.directEnvArchived.ANTHROPIC_AUTH_TOKEN).toBe("sk-old-directenv"); // 凭据留档
    expect(settings.endpoints).toHaveLength(1); // 只有既有的，未建死 endpoint
    expect(settings.endpoints[0].id).toBe("my-anthropic");
    expect(settings.endpoints[0].apiKey).toBe("sk-manual"); // 未被 directEnv 的 key 覆盖
    expect(warnSpy).toHaveBeenCalledWith(expect.stringMatching(/归档至 directEnvArchived/));
  });

  it("directEnv 部分模型 id 被占用 → 只迁未被占的 survivors，不连累兄弟模型（#1 回归）", () => {
    // #1 回归：早期版本「任一模型撞名 → 归档整个 directEnv」会连累候选里可达的兄弟模型。
    // 既有 endpoint 只占 claude-opus-4-7；directEnv 无 ANTHROPIC_MODELS → 回退三档。
    // opus 被占（经既有 owner 仍可达），sonnet+haiku 未被占 → 迁移只 append survivors 这两个。
    settingsStore.current = {
      endpoints: [
        {
          id: "my-anthropic",
          label: "我的 Claude",
          apiType: "anthropic",
          baseUrl: "https://api.anthropic.com/v1",
          apiKey: "sk-manual",
          enabled: true,
          models: [{ id: "claude-opus-4-7" }],
        },
      ],
      directEnv: {
        ANTHROPIC_BASE_URL: "https://sky.example.com",
        ANTHROPIC_AUTH_TOKEN: "sk-sky",
      },
    };
    svc.onModuleInit();
    const settings = settingsStore.current as any;
    expect(settings.directEnv).toBeUndefined(); // 迁移成功
    expect(settings.directEnvArchived).toBeUndefined(); // 未归档（有 survivors）
    expect(settings.endpoints).toHaveLength(2);
    const migrated = settings.endpoints.find((e: any) => e.label === "Claude 默认服务");
    expect(migrated).toBeDefined();
    // 只含 survivors：被占的 claude-opus-4-7 被剔除，不造影子 id
    expect(migrated.models.map((m: any) => m.id).sort()).toEqual([
      "claude-haiku-4-5",
      "claude-sonnet-4-6",
    ]);
    // 不引入新撞名：opus 仍只被既有 endpoint 拥有
    expect(findModelIdConflicts(settings.endpoints as any)).toEqual([]);
  });

  it("directEnv 模型 id 被异上游服务占用 → 同样归档（判据是占用,不看 host）", () => {
    // directEnv 指向 sky、用标准名 claude-sonnet-4-6（单模型）；用户另配了一个不同上游的网关
    // 也用了同名。判据只问「id 是否已被 enabled endpoint 占用」——单模型且被占 → survivors 空 →
    // 归档,与 host 是否相同无关。归档保留凭据、不污染路由。
    settingsStore.current = {
      endpoints: [
        {
          id: "other-gw",
          label: "另一个网关",
          apiType: "anthropic",
          baseUrl: "https://other-gateway.example.com/v1",
          apiKey: "sk-other",
          enabled: true,
          models: [{ id: "claude-sonnet-4-6" }],
        },
      ],
      directEnv: {
        ANTHROPIC_BASE_URL: "https://sky.example.com",
        ANTHROPIC_AUTH_TOKEN: "sk-sky",
        ANTHROPIC_MODEL: "claude-sonnet-4-6", // 与 other-gw 占用的 id 相同（唯一模型）
      },
    };
    svc.onModuleInit();
    const settings = settingsStore.current as any;
    expect(settings.directEnv).toBeUndefined();
    expect(settings.directEnvArchived).toBeDefined();
    expect(settings.directEnvArchived._archivedReason).toMatch(/已被现有服务占用.*改名后可恢复/);
    expect(settings.directEnvArchived.ANTHROPIC_AUTH_TOKEN).toBe("sk-sky"); // 凭据留档
    expect(settings.endpoints).toHaveLength(1); // 未建死 endpoint
    expect(settings.endpoints[0].id).toBe("other-gw");
  });

  it("存量撞名被占用 id（两个 enabled endpoint 已共用同名）→ 候选仍归档，不建第三个死 endpoint", () => {
    // #1 回归：旧实现用 newModelIdConflicts（豁免存量撞名）做判据 → 两个既有 endpoint 已撞名
    // claude-opus-4-7 时，候选撞的是「存量」被豁免 → 误判无冲突 → append 第三个死 endpoint。
    // 新判据用 ownedModelIds 集合求交，只问「是否已被占用」，不管撞名新旧 → 正确归档。
    settingsStore.current = {
      endpoints: [
        { id: "a", label: "A", apiType: "anthropic", baseUrl: "https://a.com/v1", apiKey: "sk", enabled: true, models: [{ id: "claude-opus-4-7" }] },
        { id: "b", label: "B", apiType: "anthropic", baseUrl: "https://b.com/v1", apiKey: "sk", enabled: true, models: [{ id: "claude-opus-4-7" }] }, // 与 a 存量撞名
      ],
      directEnv: {
        ANTHROPIC_BASE_URL: "https://sky.example.com",
        ANTHROPIC_AUTH_TOKEN: "sk-sky",
        ANTHROPIC_MODEL: "claude-opus-4-7", // 撞的是已存量撞名的 id
      },
    };
    svc.onModuleInit();
    const settings = settingsStore.current as any;
    expect(settings.directEnvArchived).toBeDefined(); // 归档,不 append
    expect(settings.directEnvArchived._archivedReason).toMatch(/claude-opus-4-7.*已被现有服务占用/);
    expect(settings.endpoints).toHaveLength(2); // 仍是 a/b 两个,未建第三个死 endpoint
    expect(settings.endpoints.some((e: any) => e.label === "Claude 默认服务")).toBe(false);
  });

  it("既有 endpoints 含即将被 sanitize 清掉的脏 env-direct → 不据脏数据误判占用（#2 回归）", () => {
    // #2 回归：迁移在 sanitize 之前跑。若直接拿 raw settings.endpoints 判占用，一条残留的
    // 启用 env-direct（带 claude id）会让 directEnv 被误归档,而该脏行随后又被 sanitizeLoaded
    // 清掉 → 用户两头落空。修复:迁移内先 sanitizeLoaded 再判,与 load 同口径。
    settingsStore.current = {
      endpoints: [
        // 脏数据:残留的虚拟 env-direct（应仅动态合成,绝不入库;sanitizeLoaded 会无条件剔除）
        { id: "env-direct", label: "残留直连", apiType: "anthropic", baseUrl: "https://x/v1", apiKey: "k", enabled: true, models: [{ id: "claude-opus-4-7" }] },
      ],
      directEnv: {
        ANTHROPIC_BASE_URL: "https://sky.example.com",
        ANTHROPIC_AUTH_TOKEN: "sk-sky",
        // 无 ANTHROPIC_MODELS → 回退 DEFAULT_CLAUDE_MODELS（含 claude-opus-4-7）
      },
    };
    svc.onModuleInit();
    const settings = settingsStore.current as any;
    // 脏 env-direct 被 sanitize 清掉,不计入占用 → 迁移成功 append,不误归档
    expect(settings.directEnv).toBeUndefined();
    expect(settings.directEnvArchived).toBeUndefined();
    const migrated = settings.endpoints.find((e: any) => e.label === "Claude 默认服务");
    expect(migrated).toBeDefined();
    expect(migrated.models).toHaveLength(3); // DEFAULT_CLAUDE_MODELS,未被脏行误判
    expect(settings.endpoints.some((e: any) => e.id === "env-direct")).toBe(false); // 脏行已清
  });

  it("directEnv 同上游、模型完全不重叠 → append（不再被 upstream 伪去重丢模型）", () => {
    // 关键回归：旧 upstream dedup 会把同上游的 directEnv 归档，丢掉它独有的模型。删 dedup 后
    // 只认撞名——模型不重叠则 append，两个 endpoint 都指向同上游、各自路由正常，能力不丢。
    settingsStore.current = {
      endpoints: [
        {
          id: "sky-existing",
          label: "Sky 既有",
          apiType: "anthropic",
          baseUrl: "https://sky.example.com/v1",
          apiKey: "sk-sky",
          enabled: true,
          models: [{ id: "claude-opus-4-7" }],
        },
      ],
      directEnv: {
        ANTHROPIC_BASE_URL: "https://sky.example.com", // 同上游
        ANTHROPIC_AUTH_TOKEN: "sk-sky",
        ANTHROPIC_MODEL: "my-custom-model", // 既有 endpoint 没有的独有模型，不撞名
      },
    };
    svc.onModuleInit();
    const settings = settingsStore.current as any;
    expect(settings.directEnv).toBeUndefined(); // 迁移成功删除
    expect(settings.directEnvArchived).toBeUndefined(); // 未归档
    expect(settings.endpoints).toHaveLength(2); // append，不丢模型
    const migrated = settings.endpoints.find((e: any) => e.label === "Claude 默认服务");
    expect(migrated.models.map((m: any) => m.id)).toEqual(["my-custom-model"]);
  });

  it("既有 endpoint 缺 models 字段（脏/旧 schema）→ 迁移不崩，仍正常迁移（永不失败契约）", () => {
    // ownedModelIds / findModelIdConflicts 用 `?? []` 兜底 ep.models 缺失。手编/旧 schema 可能
    // 落一条无 models 的 enabled endpoint；若无兜底,迁移会 `for...of undefined` 抛错、boot 失败。
    settingsStore.current = {
      endpoints: [
        // 缺 models 字段的脏行（类型上必填,但磁盘 JSON 可被手编破坏）
        { id: "broken", label: "坏行", apiType: "anthropic", baseUrl: "https://x/v1", apiKey: "k", enabled: true } as any,
      ],
      directEnv: {
        ANTHROPIC_BASE_URL: "https://sky.example.com",
        ANTHROPIC_AUTH_TOKEN: "sk-sky",
        ANTHROPIC_MODEL: "my-model",
      },
    };
    expect(() => svc.onModuleInit()).not.toThrow();
    const settings = settingsStore.current as any;
    expect(settings.directEnv).toBeUndefined(); // 迁移成功,未因脏行崩溃
    const migrated = settings.endpoints.find((e: any) => e.label === "Claude 默认服务");
    expect(migrated?.models.map((m: any) => m.id)).toEqual(["my-model"]);
  });

  it("directEnv 缺 TOKEN（有 URL）→ 归档不删，保留凭据", () => {
    settingsStore.current = {
      endpoints: [],
      directEnv: {
        ANTHROPIC_BASE_URL: "https://example.com",
        // 缺 ANTHROPIC_AUTH_TOKEN
      },
    };
    svc.onModuleInit();
    const settings = settingsStore.current as any;
    expect(settings.directEnv).toBeUndefined(); // 已从原位删除
    expect(settings.directEnvArchived).toBeDefined(); // 归档到此字段
    expect(settings.directEnvArchived.ANTHROPIC_BASE_URL).toBe("https://example.com");
    expect(settings.directEnvArchived._archivedReason).toMatch(/缺少必需键.*ANTHROPIC_AUTH_TOKEN/);
    expect((settings.endpoints ?? []).some((e: any) => e.label === "Claude 默认服务")).toBe(false);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringMatching(/归档至 directEnvArchived/));
  });

  it("directEnv 缺 URL（有 TOKEN）→ 归档，不销毁 token（#3 修复）", () => {
    settingsStore.current = {
      endpoints: [],
      directEnv: {
        ANTHROPIC_AUTH_TOKEN: "sk-valid-but-no-url",
        // 缺 ANTHROPIC_BASE_URL
      },
    };
    svc.onModuleInit();
    const settings = settingsStore.current as any;
    expect(settings.directEnvArchived).toBeDefined();
    expect(settings.directEnvArchived.ANTHROPIC_AUTH_TOKEN).toBe("sk-valid-but-no-url");
    expect(settings.directEnvArchived._archivedReason).toMatch(/缺少必需键.*ANTHROPIC_BASE_URL/);
  });

  it("无 directEnv 字段 → 迁移跳过，不影响正常加载", () => {
    settingsStore.current = {
      endpoints: [cloud()],
    };
    svc.onModuleInit();
    expect(svc.hasUsableEndpoint()).toBe(true);
  });

  it("迁移幂等：重启后 directEnv 已删、endpoint 已存在 → 不重复迁移", () => {
    settingsStore.current = {
      endpoints: [
        {
          id: "ep_abc123",
          label: "Claude 默认服务",
          apiType: "anthropic",
          baseUrl: "https://api.anthropic.com",
          apiKey: "sk-test",
          enabled: true,
          models: [{ id: "claude-sonnet-4-6" }],
        },
      ],
    };
    svc.onModuleInit();
    expect((settingsStore.current as any).endpoints).toHaveLength(1);
  });

  it("model.label 非字符串时归一化为 id（#4 修复）", () => {
    settingsStore.current = {
      directEnv: {
        ANTHROPIC_BASE_URL: "https://example.com",
        ANTHROPIC_AUTH_TOKEN: "sk-x",
        ANTHROPIC_MODELS: [
          { id: "m1", label: 42 }, // 数字 label
          { id: "m2" }, // 无 label
        ],
      },
    };
    svc.onModuleInit();
    const migrated = (settingsStore.current as any).endpoints.find((e: any) => e.label === "Claude 默认服务");
    expect(migrated.models[0].label).toBe("m1"); // 数字被归一化为 id
    expect(migrated.models[1].label).toBe("m2"); // 缺 label 回退 id
  });

  it("DEFAULT_CLAUDE_MODELS 非共享引用：迁移回退的 models 与导出常量不是同一数组", () => {
    // seedDefaults 已删，但 DEFAULT_CLAUDE_MODELS 仍是 directEnv 迁移的回退模型源
    // （parseDirectEnvModels 用 [...DEFAULT_CLAUDE_MODELS]）。克隆不变式照样要守。
    settingsStore.current = {
      directEnv: {
        ANTHROPIC_BASE_URL: "https://sky.example.com",
        ANTHROPIC_AUTH_TOKEN: "sk-test",
        // 无 ANTHROPIC_MODELS / ANTHROPIC_MODEL → 回退 DEFAULT_CLAUDE_MODELS
      },
    };
    svc.onModuleInit(); // 迁移建 "Claude 默认服务"，models 来自 DEFAULT_CLAUDE_MODELS 克隆
    const migrated = (settingsStore.current as any).endpoints.find((e: any) => e.label === "Claude 默认服务");
    expect(migrated?.models).toHaveLength(3);
    // 就地污染迁移端点的 models（模拟外部代码 push）
    migrated.models.push({ id: "polluted-model", label: "污染" });
    // 导出常量不应被污染（证明回退时做了克隆，非共享引用）
    expect(DEFAULT_CLAUDE_MODELS).toHaveLength(3);
    expect(DEFAULT_CLAUDE_MODELS.some((m) => m.id === "polluted-model")).toBe(false);
  });
});


describe("testEndpointByConfig（preview 路径，不依赖 registry）", () => {
  let svc: EndpointRegistryService;
  beforeEach(() => { svc = makeService(); });
  afterEach(() => { vi.restoreAllMocks(); });

  const stubFetch = (status: number, body: string, contentType: string) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(body, { status, headers: { "content-type": contentType } }),
    ));
  };

  it("不依赖 registry 状态（空表也能测）", async () => {
    svc.setAll([]); // registry 为空
    stubFetch(200, '{"choices":[{"message":{"content":"pong"}}]}', "application/json");
    const r = await svc.testEndpointByConfig(cloud());
    expect(r.ok).toBe(true);
  });

  it("空模型列表早退", async () => {
    const r = await svc.testEndpointByConfig(cloud({ models: [] }));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/至少一个模型/);
  });

  it("成功信封判定（OpenAI）", async () => {
    stubFetch(200, '{"choices":[{"message":{"content":"pong"}}]}', "application/json");
    const r = await svc.testEndpointByConfig(cloud());
    expect(r.ok).toBe(true);
  });

  it("成功信封判定（Anthropic）", async () => {
    stubFetch(200, '{"type":"message","content":[{"type":"text","text":"pong"}]}', "application/json");
    const r = await svc.testEndpointByConfig(cloud({ apiType: "anthropic" }));
    expect(r.ok).toBe(true);
  });
});
