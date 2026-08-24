// ── Plugin (.claude 场景包) types ──
// 一个 plugin = 完整的 .claude/ 目录（命令/子代理/技能/规则/知识库），
// 可导入到全局(~/.localclaw)或某个项目(<cwd>/.claude)。由 SDK PluginService 处理。

/** 场景包 manifest（可选存在于包根 .claude-plugin/plugin.json）。无则自生成。 */
export type PluginManifest = {
  name: string;
  description?: string;
  version?: string;
  author?: string;
};

/** 包内五类资源的数量摘要。 */
export type PluginCounts = {
  commands: number;
  agents: number;
  skills: number;
  rules: number;
  memories: number;
};

/** 安装作用域：全局(所有项目可用) 或 项目级(跟仓库走)。 */
export type PluginScope = "global" | "project";

/** 包内一个脚本文件（安装后可被 agent 调用，导入前需知情）。 */
export type PluginScript = {
  /** 相对 .claude 根的路径，如 "skills/mcu-flash/scripts/flash-stm32.sh"。 */
  path: string;
  type: "sh" | "py" | "js" | "other";
  /** 若在 skills/<name>/ 下，归属技能名。 */
  skill?: string;
};

/** 包内声明的权限（来自 settings.json / settings.local.json 的 permissions.allow）。 */
export type PluginPermissions = {
  /** 来自 settings.json（随包导入）。 */
  fromSettings: string[];
  /** 来自 settings.local.json（默认不导入，用户可选）。 */
  fromLocal: string[];
};

/** 安全审查数据：脚本清单 + 权限声明。导入时亮给用户做知情同意。 */
export type PluginAudit = {
  scripts: PluginScript[];
  permissions: PluginPermissions;
};

/**
 * 导入预检结果：包内容摘要 + 与目标目录的冲突清单 + 安全审查。
 * 前端据此展示包信息、让用户确认作用域/冲突覆盖/脚本与权限。
 */
export type PluginPreflight = {
  /** manifest（无 plugin.json 时为自生成）。 */
  manifest: PluginManifest;
  counts: PluginCounts;
  /** 与目标 .claude 重名的相对路径（如 "commands/build.md"）。 */
  conflicts: string[];
  /** 安全审查：脚本 + 权限声明。 */
  audit: PluginAudit;
};

/** 导入结果。 */
export type PluginImportResult = {
  ok: boolean;
  /** 实际写入的相对路径。 */
  installed: string[];
  /** 因冲突未覆盖而跳过的相对路径。 */
  skipped: string[];
  error?: string;
};

/** 脚手架生成选项：在目标项目生成标准 .claude 骨架。 */
export type ScaffoldOptions = {
  /** 目标项目根（绝对路径）。 */
  cwd: string;
  /** 包名，默认取目录名。 */
  name?: string;
  /** 是否生成示例模板文件，默认 true。 */
  includeExamples?: boolean;
};

export type ScaffoldResult = {
  ok: boolean;
  /** 生成的相对路径。 */
  created: string[];
  /** 已存在而跳过的相对路径（不覆盖）。 */
  skipped: string[];
  error?: string;
};
