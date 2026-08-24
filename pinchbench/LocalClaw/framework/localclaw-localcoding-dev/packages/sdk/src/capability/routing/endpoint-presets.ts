import type { ApiType, ModelConfig } from "@lenovo/agent-protocol";

/**
 * Anthropic 默认三档模型。统一事实源：用于 anthropic 预设、和 directEnv 迁移回退，
 * 使模型版本升级时只需改一处（之前多处硬编码，易漂移）。
 * @internal
 */
export const DEFAULT_CLAUDE_MODELS: ModelConfig[] = [
  { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", tags: ["smart", "coding"] },
  { id: "claude-opus-4-7", label: "Claude Opus 4.7", tags: ["reasoning", "critical"] },
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5", tags: ["fast"] },
];

/** @internal 内置服务商预设：用户选一个即自动填好 apiType / baseUrl / 模型列表，只需补 apiKey。 */
export type EndpointPreset = {
  id: string;
  label: string;
  apiType: ApiType;
  baseUrl: string;
  /** 申请 / 查看 apiKey 的页面，供 UI 给出跳转引导 */
  apiKeyUrl?: string;
  /** 是否本地服务（本地服务无需 apiKey） */
  local?: boolean;
  /** Azure OpenAI 默认 api-version；选中预设后写入 endpoint.azure，UI 可改。 */
  azure?: { apiVersion: string };
  /** 提示用户必须改写 baseUrl（如 Azure 资源名占位），UI 据此高亮引导。 */
  baseUrlIsTemplate?: boolean;
  models: ModelConfig[];
};

/** @internal */
export const ENDPOINT_PRESETS: EndpointPreset[] = [
  {
    id: "anthropic",
    label: "Anthropic 官方",
    apiType: "anthropic",
    baseUrl: "https://api.anthropic.com",
    apiKeyUrl: "https://console.anthropic.com/settings/keys",
    models: [...DEFAULT_CLAUDE_MODELS], // 克隆避免共享可变引用
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    apiType: "openai-compatible",
    baseUrl: "https://openrouter.ai/api/v1",
    apiKeyUrl: "https://openrouter.ai/keys",
    models: [
      { id: "anthropic/claude-sonnet-4.6", label: "Claude Sonnet 4.6", tags: ["smart", "coding"] },
      { id: "anthropic/claude-opus-4.7", label: "Claude Opus 4.7", tags: ["reasoning", "critical"] },
      { id: "openai/gpt-5.5", label: "GPT 5.5", tags: ["smart"] },
      { id: "deepseek/deepseek-v4-pro", label: "DeepSeek V4 Pro", tags: ["smart", "critical"] },
      { id: "google/gemini-3.1-flash-lite", label: "Gemini 3.1 Flash Lite", tags: ["fast"] },
    ],
  },
  {
    id: "deepseek",
    label: "DeepSeek 官方",
    apiType: "openai-compatible",
    baseUrl: "https://api.deepseek.com/v1",
    apiKeyUrl: "https://platform.deepseek.com/api_keys",
    models: [
      { id: "deepseek-v4-pro", label: "DeepSeek V4 Pro", tags: ["smart", "reasoning", "critical"] },
      { id: "deepseek-v4-flash", label: "DeepSeek V4 Flash", tags: ["fast", "coding"] },
    ],
  },

  // ── 主流供应商预设 ──
  // 全部 OpenAI 兼容（baseUrl 取自各家官方文档核实，2026-06）。挂载点差异
  // （compatible-mode/v1、api/paas/v4、api/v3、v1beta/openai）由 baseUrl 字面承载，
  // 经 generic-openai descriptor 解析，无需专属 descriptor。
  // models 仅为 UI 出厂默认；真实可用模型名变化快，编辑卡片时靠 listModels 握手拉真值。

  // —— 国外 ——
  {
    id: "openai",
    label: "OpenAI 官方",
    apiType: "openai-compatible",
    baseUrl: "https://api.openai.com/v1",
    apiKeyUrl: "https://platform.openai.com/api-keys",
    models: [
      { id: "gpt-5.5", label: "GPT 5.5", tags: ["smart", "coding"] },
      { id: "gpt-5.5-mini", label: "GPT 5.5 Mini", tags: ["fast"] },
    ],
  },
  {
    id: "gemini",
    label: "Google Gemini",
    apiType: "openai-compatible",
    // Gemini 的 OpenAI 兼容层（非原生 generateContent 路径）。
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    apiKeyUrl: "https://aistudio.google.com/apikey",
    models: [
      { id: "gemini-3-pro", label: "Gemini 3 Pro", tags: ["smart", "reasoning"] },
      { id: "gemini-3-flash", label: "Gemini 3 Flash", tags: ["fast", "coding"] },
    ],
  },
  {
    id: "xai",
    label: "xAI Grok",
    apiType: "openai-compatible",
    baseUrl: "https://api.x.ai/v1",
    apiKeyUrl: "https://console.x.ai",
    models: [
      { id: "grok-build-0.1", label: "Grok Build 0.1", tags: ["coding", "smart"] },
    ],
  },
  {
    id: "azure-openai",
    label: "Azure OpenAI",
    apiType: "openai-compatible",
    // 资源端点占位：用户必须把 <resource> 改成自己的 Azure 资源名。
    // azure-openai descriptor 会拼成 {base}/openai/deployments/{model}/chat/completions?api-version=
    baseUrl: "https://<resource>.openai.azure.com",
    baseUrlIsTemplate: true,
    apiKeyUrl: "https://portal.azure.com/",
    azure: { apiVersion: "2024-10-21" },
    // model.id 必须是 Azure 门户里创建的「部署名」（deployment），不是模型原名。
    // 靠 listModels 握手可拉该资源真实部署列表。
    models: [
      { id: "gpt-5.5", label: "GPT 5.5（部署名）", tags: ["smart", "coding"] },
    ],
  },

  // —— 国内 ——
  {
    id: "qwen",
    label: "通义千问（阿里百炼）",
    apiType: "openai-compatible",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    apiKeyUrl: "https://bailian.console.aliyun.com/",
    models: [
      { id: "qwen-max", label: "Qwen Max", tags: ["smart", "reasoning"] },
      { id: "qwen-plus", label: "Qwen Plus", tags: ["coding"] },
      { id: "qwen-turbo", label: "Qwen Turbo", tags: ["fast"] },
    ],
  },
  {
    id: "zhipu",
    label: "智谱 GLM",
    apiType: "openai-compatible",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    apiKeyUrl: "https://open.bigmodel.cn/usercenter/apikeys",
    models: [
      { id: "glm-5.1", label: "GLM 5.1", tags: ["smart", "reasoning", "critical"] },
      { id: "glm-4.6", label: "GLM 4.6", tags: ["coding"] },
    ],
  },
  {
    id: "moonshot",
    label: "月之暗面 Kimi",
    apiType: "openai-compatible",
    baseUrl: "https://api.moonshot.cn/v1",
    apiKeyUrl: "https://platform.moonshot.cn/console/api-keys",
    models: [
      { id: "kimi-k2.6", label: "Kimi K2.6", tags: ["smart"] },
      { id: "kimi-k2.7-code", label: "Kimi K2.7 Code", tags: ["coding", "critical"] },
    ],
  },
  {
    id: "doubao",
    label: "火山引擎 豆包",
    apiType: "openai-compatible",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    apiKeyUrl: "https://console.volcengine.com/ark",
    // 注意：火山方舟的 OpenAI 兼容接口，model 字段历史上需填「推理接入点 ID」
    // （形如 ep-xxxxxxxx），而非模型名；近期亦支持直填模型名。用户应以方舟控制台
    // 创建的接入点为准——这正是 listModels 握手的价值：拉到该账号真实可用的标识。
    models: [
      { id: "doubao-seed-code", label: "Doubao Seed Code", tags: ["coding"] },
      { id: "doubao-pro", label: "Doubao Pro", tags: ["smart"] },
    ],
  },
];
