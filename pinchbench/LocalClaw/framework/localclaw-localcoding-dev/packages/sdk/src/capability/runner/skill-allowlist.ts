// Skill「允许的工具」白名单门控（@internal）。
//
// 背景：CLI 原生从 CLAUDE_CONFIG_DIR/skills 加载 SKILL.md 并读取 allowed-tools
// frontmatter，但 CLI 把它当作「额外授权」，自身无任何白名单过滤逻辑。localclaw 的
// spawn 路径对几乎所有工具 auto-allow（见 handleControlRequest），因此「限制 skill
// 只能用指定工具」这一语义必须由 localclaw 在 can_use_tool 拦截点自行实现。
//
// 机制：模型激活 skill 时调用内置 Skill 工具（input.skill = "<skill目录名>"），该调用
// 走 can_use_tool 控制请求。我们据此解析该 skill 的白名单并缓存到会话运行时态，
// 对随后同一回合内的工具调用做门控：不在白名单内者返回 deny。回合边界（下一条 user
// message）清空缓存，限制随之解除。

import { join } from "path";
import { existsSync, readFileSync } from "fs";
import { getSkillsDir } from "../../config/paths";
import { logger } from "../../util/logger";

/**
 * 始终放行的元工具：它们驱动 agent 主循环 / 计划 / 问答 / 任务清单，
 * 一旦被 skill 白名单挡掉会破坏交互本身，故永久豁免，不受任何 skill 限制约束。
 */
export const META_TOOLS_ALWAYS_ALLOWED = new Set<string>([
  "Skill",
  "AskUserQuestion",
  "ExitPlanMode",
  "exit_plan_mode",
  "TodoWrite",
]);

/**
 * 解析某个 skill 的 allowed-tools 白名单。
 *
 * @returns
 *  - `string[]`（非空）：该 skill 声明了工具限制，仅这些工具可用。
 *  - `null`：skill 不存在 / 未声明 allowed-tools / 声明为空 —— 视为「不约束」，
 *    保持 localclaw 既有的 auto-allow 行为。
 */
export function resolveSkillAllowlist(skillName: string): string[] | null {
  if (!skillName || typeof skillName !== "string") return null;
  // 安全：skill 名来自 CLI 输入，禁止路径穿越。
  if (/[\\/]|\.\./.test(skillName)) {
    logger.warn(`[skill-allowlist] rejected suspicious skill name: ${skillName}`);
    return null;
  }
  const skillFile = join(getSkillsDir(), skillName, "SKILL.md");
  if (!existsSync(skillFile)) return null;
  try {
    const raw = readFileSync(skillFile, "utf-8");
    const tools = parseAllowedTools(raw);
    return tools.length > 0 ? tools : null;
  } catch (e) {
    logger.warn(`[skill-allowlist] read failed for ${skillName}:`, e);
    return null;
  }
}

/**
 * 从 SKILL.md 原文解析 allowed-tools。支持两种 YAML 写法：
 *   allowed-tools: [Bash, Read, Write]      （流式数组，SkillEditor 写出的格式）
 *   allowed-tools: Bash, Read, Write        （逗号分隔字符串）
 * 解析失败 / 缺失 → 返回空数组。
 *
 * @internal 导出仅供单测。
 */
export function parseAllowedTools(rawMarkdown: string): string[] {
  const fm = rawMarkdown.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fm) return [];
  for (const line of fm[1].split(/\r?\n/)) {
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    if (line.slice(0, idx).trim() !== "allowed-tools") continue;
    let val = line.slice(idx + 1).trim();
    if (val.startsWith("[") && val.endsWith("]")) val = val.slice(1, -1);
    return val
      .split(",")
      .map((s) => s.trim().replace(/^["']|["']$/g, ""))
      .filter(Boolean);
  }
  return [];
}

/**
 * 门控决策：给定当前回合生效的 skill 白名单与待用工具名，判断是否放行。
 *
 * @param allowlist 当前会话激活 skill 的白名单；`null`/空 表示不约束（放行一切）。
 * @returns true=放行，false=拒绝。
 * @internal 导出供单测；门控真值表的唯一来源。
 */
export function isToolAllowedBySkill(
  allowlist: string[] | null | undefined,
  toolName: string,
): boolean {
  // 未激活带限制的 skill → 不约束。
  if (!allowlist || allowlist.length === 0) return true;
  // 元工具永久豁免。
  if (META_TOOLS_ALWAYS_ALLOWED.has(toolName)) return true;
  return allowlist.includes(toolName);
}
