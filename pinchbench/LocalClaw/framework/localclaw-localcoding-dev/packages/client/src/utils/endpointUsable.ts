import type { EndpointInfo } from "@lenovo/agent-protocol";

/**
 * 本地端点：openai-compatible 且 baseUrl 的 **host** 是本机（127.0.0.1 / localhost）。本地无需 API key。
 * 单一真源——避免各处用不同正则/只认 127.0.0.1 而漏 localhost 导致判定漂移。
 *
 * 锚定到 host 段（`://` 之后、`:`/`/` 之前），不做裸子串匹配：否则 `localhost.evil.com`、
 * `127.0.0.1.attacker.com` 这类把本地名当作子域的远程地址会被误判为本地、免 key 放行。
 */
export function isLocalEndpoint(e: Pick<EndpointInfo, "apiType" | "baseUrl">): boolean {
  if (e.apiType !== "openai-compatible") return false;
  return /^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?(?:[/?#]|$)/i.test(e.baseUrl ?? "");
}

/**
 * 端点是否「可发请求」：启用 + 有模型 + (本地 or 已填 key)。
 *
 * 这是「endpoint 可用」的**唯一真源**。此前该判定被内联抄在 6 处（routingHandlers 失效校正、
 * ModelChip / EditSidebar / SkillEditor / ManualCreateDialog 模型选择器、EndpointSection 可用标记），
 * 副本漂移过：部分漏了本地豁免（本地无 key 被误判不可用）、部分只认 127.0.0.1 漏 localhost。
 * 全部 import 这一处即根除漂移（与后端 EndpointRegistryService.isUsable 同口径）。
 */
export function isEndpointUsable(
  e: Pick<EndpointInfo, "enabled" | "models" | "hasApiKey" | "apiType" | "baseUrl">,
): boolean {
  return !!e.enabled && (e.models?.length ?? 0) > 0 && (!!e.hasApiKey || isLocalEndpoint(e));
}
