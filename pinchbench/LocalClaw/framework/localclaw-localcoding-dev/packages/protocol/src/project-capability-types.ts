// ── Project capability types ──
// 项目级 .claude/ 目录下的能力资源（命令/子代理/技能/规则/知识库）。
// 由 SDK 的 ProjectCapabilityService 扫描产出，纯只读，用于 UI 可视化与斜杠补全。

import type { SkillMeta } from "./skill-types";

/** 项目级斜杠命令（.claude/commands/*.md）。 */
export type ProjectCommand = {
  /** 文件名去 .md，如 "build"。命名空间形式（fw:build）由文件名或子目录决定。 */
  name: string;
  /** frontmatter description。 */
  description?: string;
  /** 参数提示（frontmatter argument-hint）。 */
  argumentHint?: string;
};

/** 项目级子代理（.claude/agents/*.md）。 */
export type ProjectAgent = {
  /** 文件名去 .md，如 "fw-build"。 */
  name: string;
  description?: string;
  /** frontmatter 中声明的模型（可选）。 */
  model?: string;
};

/** 项目级规则文档（.claude/rules/*.md），只读展示。 */
export type ProjectRule = {
  /** 文件名去 .md。 */
  name: string;
  /** 首行 H1 或 frontmatter name，作为展示标题。 */
  title?: string;
};

/** 项目级知识库条目（.claude/memories/*.{yaml,json,md}），只读展示。 */
export type ProjectMemory = {
  /** 文件名（含扩展名）。 */
  name: string;
  format: "yaml" | "json" | "md";
};

/** 单个项目 .claude/ 全部能力的聚合结果。 */
export type ProjectCapabilities = {
  /** 被扫描的项目根目录（绝对路径）。 */
  cwd: string;
  commands: ProjectCommand[];
  agents: ProjectAgent[];
  /** 项目级技能，复用 SkillMeta（source 恒为 "project"）。 */
  skills: SkillMeta[];
  rules: ProjectRule[];
  memories: ProjectMemory[];
};
