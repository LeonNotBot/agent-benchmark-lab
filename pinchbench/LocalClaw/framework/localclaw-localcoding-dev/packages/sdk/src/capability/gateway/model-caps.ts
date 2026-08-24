// 模型输出 token 上限：解析请求 max_tokens 应裁剪到的值。
// 优先级：endpoint 配置的 maxOutputTokens > 内置默认表 > 全局兜底。

import { logger } from "../../util/logger";

// 模型名 → 输出 cap。键用「包含匹配」，覆盖常见别名/版本写法。
const MODEL_OUTPUT_CAPS: Array<[RegExp, number]> = [
  [/claude.*opus/i, 64000],
  [/claude.*sonnet/i, 64000],
  [/claude.*haiku/i, 32000],
  [/gpt-5/i, 64000],
  [/deepseek/i, 32000],
  [/qwen/i, 32000],
  [/gemini|gemma/i, 32000],
  [/mistral/i, 32000],
  // GLM-5.x 系列（z-ai / zai-org）：官方最大输出 131072（1M 上下文）。
  // 显式列出而非靠兜底：131072 远高于 FALLBACK_CAP，靠兜底仍会把 CLI 的 64000 请求
  // 截到兜底值，导致长代码生成被腰斩、并放大上游 idle timeout 概率。
  [/z-?ai|glm-?[45]/i, 131072],
];

// 匹配不到任何已知模型、且用户/上游都没声明能力时的兜底。
// 取 32768 而非旧的 8192：8192 是 GPT-3.5 时代默认值，如今(2025+)几乎所有模型单次
// 输出都 ≥16K，agentic 写大文件/大 diff 时被截到 8192 会「静默腰斩」——比 400 报错
// 还难查(无任何报错，输出莫名其妙断掉)。32K 是当代模型的安全下限：绝大多数支持，
// 极少数真只支持更小输出的老模型会被上游以 400 明确拒绝(可诊断) 而非静默截断。
// 注意：这只是「未知模型」的兜底；已进 MODEL_OUTPUT_CAPS 或配了 maxOutputTokens 的走精确值。
const FALLBACK_CAP = 32768;

/** 返回该模型的输出 cap。configured 来自 ModelConfig.maxOutputTokens。 */
export function resolveOutputCap(modelId: string, configured?: number): number {
  if (configured && configured > 0) return configured;
  for (const [re, cap] of MODEL_OUTPUT_CAPS) {
    if (re.test(modelId)) return cap;
  }
  // 未知模型：用保守兜底而非静默截断。标注出来，否则运维只看到「clamp 到 8192」
  // 却无从判断 8192 是模型真实上限还是猜的。命中此分支说明该模型既不在内置表、
  // 用户也没在 endpoint 配 maxOutputTokens —— 应补一行 MODEL_OUTPUT_CAPS 或填该字段。
  logger.warn(
    `[gateway] 未知模型 "${modelId}" 不在输出上限表中，回退保守 cap=${FALLBACK_CAP}；` +
    `如该模型支持更大输出，请在 MODEL_OUTPUT_CAPS 补条目或为其设置 maxOutputTokens。`,
  );
  return FALLBACK_CAP;
}

/**
 * 把请求的 max_tokens 裁剪到模型 cap 以内。
 * requested 缺失/非法时返回 cap 本身（与上游默认行为一致，避免发 0）。
 */
export function clampMaxTokens(requested: unknown, cap: number): number {
  const n = typeof requested === "number" && requested > 0 ? requested : cap;
  return Math.min(n, cap);
}
