// Skill 停用门控（@internal）。
//
// 背景：技能「停用」是用户在技能管理界面做出的开关。server 侧将停用名单写入磁盘真相源
// <skillsDir>/.disabled.json。CLI 原生不感知该状态，仍会从 skills 目录加载 SKILL.md 并
// 允许模型/用户激活；因此「停用即不可用」必须由 localclaw 强制实现。
//
// 机制（关键）：纯 prompt 类型的 skill 被 CLI 内部「自动放行」——其 checkPermissions 在
// 命中 deny 规则后会直接 deny，但若无 deny 规则且 type==="prompt" 且只含安全属性，则不发
// can_use_tool 控制请求即放行。故 SDK 侧的 can_use_tool 拦截对这类 skill 永远收不到调用。
// 正确做法是把停用的 skill 作为 `Skill(<name>)` 规则注入 CLI 的 --disallowedTools：CLI 的
// 权限主流程里 deny 规则在 checkPermissions 中「最先检查、命中即 return」，甚至先于
// bypassPermissions 短路，因此在所有权限模式下都能可靠拦截。

import { join } from "path";
import { existsSync, readFileSync } from "fs";
import { getSkillsDir } from "../../config/paths";
import { logger } from "../../util/logger";

/** 停用名单文件名（与 server 侧 SkillService.disabledFile 保持一致）。 */
const DISABLED_FILE = ".disabled.json";

/**
 * 读取被停用的技能名集合。文件缺失 / 损坏 → 空集合（视为全部启用）。
 * 每次调用实时读盘，确保用户切换停用状态后立即生效，无需重启进程。
 *
 * @internal 导出仅供单测。
 */
export function readDisabledSkills(): Set<string> {
  const file = join(getSkillsDir(), DISABLED_FILE);
  try {
    if (!existsSync(file)) return new Set();
    const arr = JSON.parse(readFileSync(file, "utf-8"));
    if (!Array.isArray(arr)) return new Set();
    return new Set(arr.filter((n) => typeof n === "string"));
  } catch (e) {
    logger.warn("[skill-disabled] read failed:", e);
    return new Set();
  }
}

/**
 * 判断某 skill 是否被停用。
 *
 * @returns true=已停用（应拒绝激活）；false=启用 / 名称非法 / 名单不可读。
 */
export function isSkillDisabled(skillName: string): boolean {
  if (!skillName || typeof skillName !== "string") return false;
  // 安全：skill 名来自 CLI 输入，禁止路径穿越类输入误判。
  if (/[\\/]|\.\./.test(skillName)) return false;
  return readDisabledSkills().has(skillName);
}

/** skill 名是否可安全作为权限规则内容（防注入括号/路径穿越，破坏规则解析）。 */
function isSafeSkillName(name: string): boolean {
  return typeof name === "string" && name.length > 0 && /^[A-Za-z0-9._-]+$/.test(name);
}

/**
 * 生成停用 skill 的 CLI deny 规则数组，形如 `Skill(<name>)`。
 * 注入 CLI 的 --disallowedTools 后，CLI 在激活该 skill 时命中 deny 规则直接拒绝，
 * 对纯 prompt 类型 skill 同样生效（不依赖 can_use_tool）。
 */
export function disabledSkillDenyRules(): string[] {
  return [...readDisabledSkills()]
    .filter(isSafeSkillName)
    .sort()
    .map((name) => `Skill(${name})`);
}

/**
 * 停用名单的稳定指纹（排序后拼接）。用于进程复用判定：停用集变化 → 指纹变化 →
 * 销毁旧进程重新 spawn，使新的 --disallowedTools 生效。空集合返回空串。
 */
export function disabledSkillsHash(): string {
  return [...readDisabledSkills()].filter(isSafeSkillName).sort().join(",");
}
