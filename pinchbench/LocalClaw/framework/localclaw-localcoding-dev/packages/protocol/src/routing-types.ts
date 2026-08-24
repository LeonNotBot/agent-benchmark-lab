// ── Routing types ──

export type ModelTarget = "cloud";

export type RoutingDecision = {
  target: ModelTarget;
  modelName: string;
  provider: "firstParty" | "openai" | "openrouter" | "anthropic";
  reason: string;
  confidence: number;
  /** 选中的 endpoint id；用于区分「全局 env 直连」(env-direct) 与走网关的普通 endpoint。 */
  endpointId?: string;
};

export type DeviceCapabilities = {
  gpuName: string | null;
  gpuVramMB: number;
  ramMB: number;
  cpuCores: number;
  platform: string;
};

/**
 * 路由偏好。
 *  - standard：普通端点选择——用用户选定的 model/endpoint，一个进程一个模型（对齐旗舰）。
 *  - smart-hybrid：混合叠加层——配「默认模型 + 关键任务升级模型」，运行时按任务关键性切换。
 *
 * 历史遗留值 "auto" / "cloud"（本地推理时代的产物，早已等价）统一归一化为 "standard"，
 * 见 client loadRoutingPreference / server template.service 的迁移逻辑。
 */
export type RoutingPreference = "standard" | "smart-hybrid";

export type ProviderType = "sky" | "openrouter" | "anthropic";

export type ModelSlot = {
  provider: ProviderType;
  model: string;
};

export type SelectedModel = {
  endpointId: string;
  model: string;
  /** @deprecated backward compat with old localStorage format */
  provider?: string;
};

/**
 * 当前活跃的云端模型快照。供渠道（IM）查询「现在用的是哪个大模型」时返回真值，
 * 与 UI 实际选择保持一致。modelName 为上游真实模型 id，label 为可读名（反查 endpoint
 * 的 ModelConfig.label，缺失时回退 modelName）。
 */
export type ActiveCloudModel = {
  modelName: string;
  endpointId?: string;
  label: string;
};

export type EscalationHistoryEntry = {
  timestamp: number;
  model: string;
  active: boolean;
  sessionId?: string;
};

/** @deprecated Use EndpointConfig-based SmartHybridConfig instead */
export type SmartHybridConfigLegacy = {
  defaultModel: { provider: ProviderType; model: string };
  upgradeModel: { provider: ProviderType; model: string };
};

export type SmartHybridConfig = {
  defaultModel: { endpointId: string; model: string };
  upgradeModel: { endpointId: string; model: string };
};

export type PromptComplexity = "simple" | "medium" | "complex";

export type ClassificationResult = {
  score: number;
  complexity: PromptComplexity;
};

// ── Endpoint Registry types ──

export type ApiType = "anthropic" | "openai-compatible";

/**
 * 部署渠道：决定「如何抵达上游 + 鉴权方式」，与 apiType（线格式）正交。
 *  - gateway：经本地网关透传，真实 key 由网关注入（anthropic/openai/未来 azure-openai）
 *  - direct ：CLI 直连上游、绕过网关（现有 env-direct 的一般化）
 *  - bedrock/vertex/foundry：CLI 原生直连（AWS SigV4 / GCP OAuth / Azure Foundry），
 *    网关无法代签，必须直连。当前仅框架占位，未落地。
 */
export type DeploymentChannel = "gateway" | "direct" | "bedrock" | "vertex" | "foundry";

export type ModelConfig = {
  /** 公开路由键：客户端/CLI 发的 body.model，全局唯一。网关靠它查表路由。 */
  id: string;
  /**
   * 发给真实上游的模型名。缺省 = id（对齐 LiteLLM 的 litellm_params.model）。
   * 用于「公开 id 与上游真实名解耦」：同一真实模型可在多个 endpoint 以不同
   * 公开 id 暴露（如 bedrock/sonnet、vertex/sonnet 都 upstreamModel=claude-sonnet-4-6）。
   */
  upstreamModel?: string;
  label?: string;
  tags?: string[];
  /** 输出 token 上限。请求的 max_tokens 超过此值时由 gateway 裁剪。 */
  maxOutputTokens?: number;
};

export type EndpointConfig = {
  id: string;
  label: string;
  apiType: ApiType;
  baseUrl: string;
  apiKey: string;
  models: ModelConfig[];
  enabled: boolean;
  /** 部署渠道，决定如何抵达上游。缺省按 gateway（env-direct 例外按 direct）。 */
  channel?: DeploymentChannel;
  /** Azure OpenAI 扩展点：deployment 复用 model.id，api-version 在此。当前仅定义不消费。 */
  azure?: { apiVersion: string };
};

export type EndpointInfo = Omit<EndpointConfig, "apiKey"> & {
  hasApiKey: boolean;
};

/**
 * 新建 endpoint 的入参：id 可选。
 * - 自定义新建：省略 id，由服务端铸内部主键（用户不可见，对齐 LiteLLM /model/new）。
 * - 预设新建：携带预设的系统 id（如 "deepseek"），保留可读、且供「隐藏已添加预设」判定。
 * 服务端对「提供的 id 已占用」会回退铸新 id（防御撞名）。
 */
export type EndpointCreateInput = Omit<EndpointConfig, "id"> & { id?: string };

/**
 * 局部更新 endpoint 的入参：除 id 外全部可选，未提供的字段保持原值。
 * apiKey 省略或空串 = 不修改已存 key（前端列表脱敏，编辑时空 key 表示「不动」）。
 */
export type EndpointUpdateInput = Partial<Omit<EndpointConfig, "id">>;

// ── Deploy types ──

export type RemoteDeployStatus =
  | "idle"
  | "connecting"
  | "uploading"
  | "building"
  | "running"
  | "stopped"
  | "error";

export type SshDeployConfig = {
  host: string;
  port: number;
  username: string;
  authType: "password" | "privateKey";
  password: string;
  privateKeyPath: string;
  remotePath: string;
  imageName: string;
  portMapping: string;
  envVars: string;
};