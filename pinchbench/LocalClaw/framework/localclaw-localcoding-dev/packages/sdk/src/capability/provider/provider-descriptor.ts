/**
 * @internal 供应商描述符（ProviderDescriptor）—— 声明式的「上游接入知识」。
 *
 * 把原先散落在 5 处的供应商特例（anthropic-base-url 的 host 分支、model.controller
 * 的 /models 拼接、gateway 两条 chat 路径的 URL/auth、endpoint-registry 的 test
 * 路径）收敛成一份「挂在 endpoint 上的纯数据」。test / listModels / chat 三条路径
 * 统一经 resolveUpstream() 要 { url, upstreamModel, auth }，从结构上消除三路 drift。
 *
 * ── 设计原则（实测/旗舰对标后锁定）──
 *   1. baseUrl 是「字面前缀」，不做隐式路径注入：resolveUrl 只在前缀后追加标准子
 *      路径，不自作主张剥/补 /v1（剥补正是 DeepSeek 404 的根因）。挂载点差异
 *      （openrouter=api/v1、qwen=compatible-mode/v1、zhipu=api/paas/v4、doubao=api/v3）
 *      全部吸收进 baseUrl 字符串，由 preset 携带——故这些「标准 shape」上游无需各自
 *      descriptor，统一走 generic-openai。
 *   2. descriptor 只编码「path shape 偏离标准」的上游：DeepSeek（listModels 跨协议
 *      跳到 OpenAI 侧 /v1/models，实测 anthropic 侧 /anthropic/v1/models → 404）；
 *      将来的 Azure（/openai/deployments/{model}/...?api-version=）。挂载点不同 ≠
 *      shape 偏离。
 *   3. auth 随「实际打到的协议侧」变，而非 endpoint 声明的 apiType：DeepSeek 的
 *      listModels 落在 OpenAI 侧 → Bearer；messages 落在 anthropic 侧 → x-api-key。
 *      故 auth 是 authFor(purpose) 而非静态字段。
 *   4. 模型名（deepseek-v4-pro 等）不进 descriptor——变得最快；由 preset 出厂默认 +
 *      listModels 握手拉真值。descriptor 只碰几乎不变的拓扑/auth。
 *
 * 不过度工程：不做 LiteLLM 那种插件化注册表。内置表只含「shape 偏离」的少数家 +
 * 两个 generic 兜底；主流供应商靠 preset 覆盖，不靠 descriptor 膨胀。
 */

import type { ApiType, EndpointConfig, ModelConfig } from "@lenovo/agent-protocol";

/**
 * 上游请求的用途。同一 endpoint 在不同用途下子路径/鉴权可能不同——这正是 DeepSeek
 * 的坑：listModels 落 OpenAI 侧 /v1/models（Bearer），messages 落 anthropic 侧
 * /anthropic/v1/messages（x-api-key）。
 *  - "chat"       OpenAI 兼容对话补全（POST {base}/chat/completions）
 *  - "messages"   Anthropic 原生消息（POST {base}/v1/messages）
 *  - "listModels" 拉取模型列表（GET {base}/models 或 anthropic /v1/models）
 */
export type ProviderPurpose = "chat" | "messages" | "listModels";

/** 鉴权头形态。anthropic→x-api-key；openai 兼容→Bearer；Azure OpenAI→api-key 头。 */
export type ProviderAuth = "x-api-key" | "bearer" | "api-key";

/**
 * resolveUrl 的可选上下文：少数上游的 URL 依赖模型名或版本号。
 *  - model      : 上游模型名。Azure OpenAI 把 deployment（=模型名）嵌进 URL 路径。
 *  - apiVersion : Azure OpenAI 必需的 ?api-version= 查询参数（存于 endpoint.azure）。
 * 绝大多数上游忽略此参数（URL 只由 baseUrl+purpose 决定）。
 */
export type ResolveUrlOpts = { model?: string; apiVersion?: string };

/**
 * 供应商描述符：一家上游「如何抵达 + 如何鉴权」的声明式知识。
 *
 * 解析入口是 resolveUrl(baseUrl, purpose, opts?) + authFor(purpose)；二者按用途给出
 * 完整 URL 与鉴权形态。所有「补 /anthropic」「拼 /models」「deployment 入路径」等
 * 特例都关进这里。
 */
export type ProviderDescriptor = {
  /** 稳定标识，与 endpoint preset id 对齐（anthropic / deepseek / azure-openai / ...）。 */
  id: string;
  /** 人类可读名，仅用于日志与诊断。 */
  label: string;
  /**
   * 命中判定：用归一化后的 host 判断该 endpoint 属于哪家。返回 true 即采用此 descriptor。
   * 内置表按顺序匹配，第一个命中者胜出；都不命中则回落 generic（按 apiType 决定默认形态）。
   */
  matchHost: (host: string) => boolean;
  /**
   * 该用途的鉴权头形态。随「实际打到的协议侧」决定。
   */
  authFor: (purpose: ProviderPurpose) => ProviderAuth;
  /**
   * 由用户填写的 baseUrl + 用途（+ 可选 model/apiVersion）解析出完整请求 URL。
   * 必须幂等：对已归一化的 baseUrl 再次解析结果不变。
   * 非法 URL 不抛错——保持既有可诊断行为，交由上游 fetch 报错。
   */
  resolveUrl: (baseUrl: string, purpose: ProviderPurpose, opts?: ResolveUrlOpts) => string;
};

// ── URL 归一化小工具（纯函数，无副作用）──

/** 去尾斜杠。供 endpoint baseUrl 归一化复用（迁移去重、descriptor 解析同口径）。 */
export function stripTrailingSlash(s: string): string {
  return s.replace(/\/+$/, "");
}

/** 剥掉尾部的 /v1（含可选尾斜杠）。仅用于「需要从 anthropic 侧回到 OpenAI 侧根」的场景。 */
function stripV1(s: string): string {
  return stripTrailingSlash(s).replace(/\/v1$/, "");
}

/** 安全取 host（小写）；非法 URL 返回空串，由调用方决定回落。 */
function safeHost(url: string): string {
  try {
    return new URL(url.trim()).host.toLowerCase();
  } catch {
    return "";
  }
}

// ════════════════════════════════════════════════════════════════
//  内置 descriptor 表（仅含「shape 偏离标准」的少数家）
// ════════════════════════════════════════════════════════════════

/**
 * 标准 Anthropic 原生上游（api.anthropic.com）。base 为字面前缀。
 *  - messages  : {base}/v1/messages   （x-api-key）
 *  - listModels: {base}/v1/models      （x-api-key）
 *  - chat      : 不适用，按 messages 处理（anthropic 上游无 OpenAI 路径）
 */
const ANTHROPIC_DESCRIPTOR: ProviderDescriptor = {
  id: "anthropic",
  label: "Anthropic 官方",
  matchHost: (host) => host === "api.anthropic.com",
  authFor: () => "x-api-key",
  resolveUrl: (baseUrl, purpose) => {
    // Anthropic 根约定：剥 /v1（很多配置/seed 习惯带 /v1，如 sky 存 `${base}/v1`），
    // 再按用途追加 /v1/messages | /v1/models。否则 /v1 结尾会拼出 /v1/v1/...。
    const root = stripV1(baseUrl);
    return purpose === "listModels" ? `${root}/v1/models` : `${root}/v1/messages`;
  },
};

/**
 * DeepSeek 官方——唯一的真 shape 偏离（实测坐实，2026-06）。
 * 它一家开两套标准接口：OpenAI 侧（/v1/*，Bearer）与 Anthropic 侧（/anthropic/v1/*，x-api-key）。
 * 偏离点：anthropic 侧未实现 Models API（GET /anthropic/v1/models → 404 实测），
 * 故 listModels 必须跨到 OpenAI 侧 /v1/models（→ 200，返回 deepseek-v4-flash/pro）。
 * chat/messages 是标准 anthropic，落 {anthropic 根}/v1/messages。
 *
 * 用户填的 baseUrl 可能是 .../anthropic（切到 anthropic 类型）或 .../v1（openai 预设）。
 * resolveUrl 把两种输入都归一到正确用途路径，幂等。
 */
const DEEPSEEK_DESCRIPTOR: ProviderDescriptor = {
  id: "deepseek",
  label: "DeepSeek 官方",
  matchHost: (host) => host === "api.deepseek.com",
  // 每个用途落在它自己的协议侧：chat/listModels 在 OpenAI 侧（Bearer），
  // messages 在 anthropic 侧（x-api-key）。
  authFor: (purpose) => (purpose === "messages" ? "x-api-key" : "bearer"),
  resolveUrl: (baseUrl, purpose) => {
    // 先剥到「主机根」（去 /v1、去尾斜杠、去已有的 /anthropic），再按用途落到对应侧。
    const root = stripV1(baseUrl).replace(/\/anthropic$/, "");
    if (purpose === "messages") return `${root}/anthropic/v1/messages`; // anthropic 侧
    if (purpose === "listModels") return `${root}/v1/models`;            // OpenAI 侧（anthropic 侧无此端点，实测 404）
    return `${root}/v1/chat/completions`;                                // chat → OpenAI 侧
  },
};

/**
 * Azure OpenAI——OpenAI 线格式，但 URL/auth 双重偏离（微软官方文档核实，2026-06）：
 *   - URL : {base}/openai/deployments/{deployment}/chat/completions?api-version=xxx
 *           deployment 即模型名（model.id）；api-version 存于 endpoint.azure.apiVersion。
 *   - auth: api-key 头（既非 Bearer 也非 x-api-key）。
 *   - base: 资源端点形如 https://<resource>.openai.azure.com（不带 /v1）。
 * 首个「URL 依赖模型名 + 版本号」的 descriptor，故 resolveUrl 消费 opts.model /
 * opts.apiVersion。listModels：{base}/openai/deployments?api-version=xxx（返回部署列表）。
 */
const AZURE_DESCRIPTOR: ProviderDescriptor = {
  id: "azure-openai",
  label: "Azure OpenAI",
  matchHost: (host) => host.endsWith(".openai.azure.com"),
  authFor: () => "api-key",
  resolveUrl: (baseUrl, purpose, opts) => {
    const root = stripTrailingSlash(baseUrl);
    const ver = opts?.apiVersion ? `?api-version=${encodeURIComponent(opts.apiVersion)}` : "";
    if (purpose === "listModels") {
      // 列出该资源下的部署（deployment 即可用模型）。
      return `${root}/openai/deployments${ver}`;
    }
    // chat/messages 走 OpenAI 兼容补全；deployment 名嵌入路径（由 resolveUpstream 传入 model）。
    const deployment = encodeURIComponent(opts?.model ?? "");
    return `${root}/openai/deployments/${deployment}/chat/completions${ver}`;
  },
};

/** @internal 内置 descriptor 表（顺序即匹配优先级）。仅 shape 偏离者在此。 */
export const PROVIDER_DESCRIPTORS: ProviderDescriptor[] = [
  ANTHROPIC_DESCRIPTOR,
  DEEPSEEK_DESCRIPTOR,
  AZURE_DESCRIPTOR,
];

// ════════════════════════════════════════════════════════════════
//  generic 兜底（未命中内置表时，按 apiType 给确定形态）
// ════════════════════════════════════════════════════════════════

/**
 * 通用 OpenAI 兼容上游。base 为字面前缀，**不做隐式 /v1 剥补**——挂载点差异
 * （api/v1、compatible-mode/v1、api/paas/v4、api/v3）已在 baseUrl 里，由 preset 携带。
 *  - chat      : {base}/chat/completions   （Bearer）
 *  - listModels: {base}/models             （Bearer）
 * openrouter / qwen / zhipu / doubao / moonshot / openai / gemini / sky(修好后) 均走此。
 */
function genericOpenAI(): ProviderDescriptor {
  return {
    id: "generic-openai",
    label: "通用 OpenAI 兼容上游",
    matchHost: () => false,
    authFor: () => "bearer",
    resolveUrl: (baseUrl, purpose) => {
      const base = stripTrailingSlash(baseUrl);
      return purpose === "listModels" ? `${base}/models` : `${base}/chat/completions`;
    },
  };
}

/**
 * 通用 Anthropic 上游。base 为字面前缀。sky（自有代理，修好 quirks 后）归此。
 *  - messages  : {base}/v1/messages   （x-api-key）
 *  - listModels: {base}/v1/models      （x-api-key）
 */
function genericAnthropic(): ProviderDescriptor {
  return {
    id: "generic-anthropic",
    label: "通用 Anthropic 上游",
    matchHost: () => false,
    authFor: () => "x-api-key",
    resolveUrl: (baseUrl, purpose) => {
      // 同 ANTHROPIC_DESCRIPTOR：剥 /v1 取根，再按用途追加（sky 等 seed 带 /v1）。
      const root = stripV1(baseUrl);
      return purpose === "listModels" ? `${root}/v1/models` : `${root}/v1/messages`;
    },
  };
}

/** @internal 按 apiType 取 generic 兜底 descriptor。 */
export function genericDescriptor(apiType: ApiType): ProviderDescriptor {
  return apiType === "anthropic" ? genericAnthropic() : genericOpenAI();
}

/**
 * 为一个 endpoint 选定 descriptor：先按 host 在内置表里匹配，命中即用；
 * 否则按 apiType 回落到 generic。永不抛错——非法 baseUrl 的 host 为空，走 generic。
 */
export function resolveDescriptor(
  endpoint: Pick<EndpointConfig, "baseUrl" | "apiType">,
): ProviderDescriptor {
  const host = safeHost(endpoint.baseUrl);
  if (host) {
    const hit = PROVIDER_DESCRIPTORS.find((d) => d.matchHost(host));
    if (hit) return hit;
  }
  return genericDescriptor(endpoint.apiType);
}

// ════════════════════════════════════════════════════════════════
//  resolveUpstream —— 三路径（test / listModels / chat）的唯一真源
// ════════════════════════════════════════════════════════════════

/** resolveUpstream 的产物：一次请求需要的 URL + 上游模型名 + 鉴权形态。 */
export type ResolvedUpstream = {
  /** 完整请求 URL（已按 purpose 拼好子路径）。 */
  url: string;
  /** 发给上游的模型名（upstreamModel ?? id）；listModels 用途下为 undefined。 */
  upstreamModel?: string;
  /** 该 purpose 的鉴权头形态。 */
  auth: ProviderAuth;
};

/**
 * 把「endpoint + 模型 + 用途」解析成一次上游请求的全部要素。**三条路径共用此函数**，
 * 确保 URL / 模型名 / auth 三者同源，杜绝 drift（如「测试成功但对话失败」）。
 *
 * @param endpoint  目标 endpoint（取 baseUrl/apiType 选 descriptor，取 apiKey 由调用方注入头）
 * @param model     该次请求的模型配置；listModels 用途可传 undefined
 * @param purpose   用途，决定子路径与 auth
 */
export function resolveUpstream(
  endpoint: Pick<EndpointConfig, "baseUrl" | "apiType" | "azure">,
  model: Pick<ModelConfig, "id" | "upstreamModel"> | undefined,
  purpose: ProviderPurpose,
): ResolvedUpstream {
  const desc = resolveDescriptor(endpoint);
  // 发上游真名：upstreamModel 缺省回落公开 id（对齐 LiteLLM litellm_params.model）。
  const upstreamModel = model ? model.upstreamModel ?? model.id : undefined;
  return {
    // model/apiVersion 仅 Azure 等「URL 依赖模型/版本」的 descriptor 消费，其余忽略。
    url: desc.resolveUrl(endpoint.baseUrl, purpose, {
      model: upstreamModel,
      apiVersion: endpoint.azure?.apiVersion,
    }),
    upstreamModel,
    auth: desc.authFor(purpose),
  };
}

/**
 * 按 auth 形态构造鉴权头。调用方传真实 apiKey；返回可直接 spread 进 fetch headers。
 * 集中此处，避免三路径各自手写 x-api-key / Bearer 而漂移。
 */
export function authHeaders(auth: ProviderAuth, apiKey: string): Record<string, string> {
  switch (auth) {
    case "x-api-key":
      return { "x-api-key": apiKey };
    case "api-key": // Azure OpenAI
      return { "api-key": apiKey };
    case "bearer":
    default:
      return { Authorization: `Bearer ${apiKey}` };
  }
}
