/**
 * endpoint-env —— 把一个端点配置转成 claude-cli 需要的直连环境变量。
 *
 * 两种协议：
 *  - anthropic：ANTHROPIC_BASE_URL + ANTHROPIC_AUTH_TOKEN（CLI 原生协议直连）。
 *  - openai-compatible：CLAUDE_CODE_USE_OPENAI=1 + OPENAI_BASE_URL + OPENAI_API_KEY，
 *    可选 OPENAI_MODEL（端点第一个模型的上游名）。
 *
 * 只依赖结构，不 import SDK 的 EndpointConfig（避免把 @internal 依赖拖进 CLI 包）。
 */

/** 端点的最小结构（与 protocol 的 EndpointConfig 兼容子集）。 */
export type EndpointLike = {
  id: string;
  apiType?: "anthropic" | "openai-compatible";
  baseUrl: string;
  apiKey: string;
  enabled?: boolean;
  models?: Array<{ id: string; upstreamModel?: string }>;
};

/** 转成 env 键值对；无法识别的协议返回 null。 */
export function pickEndpointEnv(
  endpoint: EndpointLike,
): Record<string, string> | null {
  const baseUrl = endpoint.baseUrl?.trim();
  const apiKey = endpoint.apiKey?.trim();
  if (!baseUrl || !apiKey) return null;

  // 缺省按 anthropic（与 protocol 注释一致）。
  const apiType = endpoint.apiType ?? "anthropic";

  if (apiType === "openai-compatible") {
    const env: Record<string, string> = {
      CLAUDE_CODE_USE_OPENAI: "1",
      OPENAI_BASE_URL: baseUrl,
      OPENAI_API_KEY: apiKey,
    };
    const firstModel = endpoint.models?.[0];
    const upstream = firstModel?.upstreamModel ?? firstModel?.id;
    if (upstream) env.OPENAI_MODEL = upstream;
    return env;
  }

  // anthropic 原生直连
  return {
    ANTHROPIC_BASE_URL: baseUrl,
    ANTHROPIC_AUTH_TOKEN: apiKey,
  };
}
