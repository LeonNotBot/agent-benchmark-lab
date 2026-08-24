// 默认技术栈配置：存于 ~/.localclaw/settings.json 的 techStack 字段（单一数据源），
// 由 TechStackRegistrarService 渲染成 CLAUDE.md 的 <!-- local-claw:tech-stack --> 标记块。

import {
  readLocalClawSettings,
  writeLocalClawSettings,
} from "../../config/localclaw-settings";

export type TechStackConfig = {
  /** 总开关：关闭时移除 CLAUDE.md 中的技术栈标记块。 */
  enabled: boolean;
  language: string;
  frontend: string;
  backend: string;
  database: string;
  packageManager: string;
  testing: string;
  /** 自由文本兜底规则，逐行渲染为额外约束。 */
  customRules: string;
};

/**
 * 默认值刻意与已手写进 ~/.localclaw/CLAUDE.md 的 tech-stack:v1 块内容对齐，
 * 这样 registrar 首次启动用默认值渲染时不会悄悄改写用户已见到的内容（无缝迁移）。
 */
export const DEFAULT_TECH_STACK: TechStackConfig = {
  enabled: true,
  language: "TypeScript（strict 模式，避免裸 any）",
  frontend: "React + Vite，样式用 Tailwind CSS",
  backend: "NestJS（Node 22+）",
  database: "数据库优先 SQLite，其次 MySQL；非必要不引入其他数据库",
  packageManager: "pnpm（禁止 npm / yarn，新依赖锁定精确版本）",
  testing: "Vitest",
  customRules: "数据访问：参数化查询，禁止字符串拼接 SQL",
};

/** 从 settings.json 读取 techStack，缺字段用默认值补全。 */
export function readTechStackConfig(): TechStackConfig {
  const settings = readLocalClawSettings();
  const raw = (settings.techStack ?? {}) as Partial<TechStackConfig>;
  return { ...DEFAULT_TECH_STACK, ...raw };
}

/** 写回 settings.json 的 techStack 字段（保留其它字段）。 */
export function writeTechStackConfig(config: TechStackConfig): void {
  const settings = readLocalClawSettings();
  settings.techStack = config;
  writeLocalClawSettings(settings);
}
