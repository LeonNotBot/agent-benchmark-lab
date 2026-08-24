/**
 * Plugin 扫描器——纯函数：定位 .claude 根、读/生成 manifest、遍历五类资源。
 * 操作已解压的目录（zip 解压在 service 层）。无 DI、无状态，便于单测。
 */
import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
import type { PluginManifest, PluginCounts } from "@lenovo/agent-protocol";

const CLAUDE_SUBDIRS = ["commands", "agents", "skills", "rules", "memories"];

/** 一个目录是否像 .claude 根（含任一已知子目录）。 */
function looksLikeClaudeRoot(dir: string): boolean {
  return CLAUDE_SUBDIRS.some((d) => existsSync(join(dir, d)));
}

/**
 * 定位包内的 .claude 根。兼容三种打包形态：
 *  1. 解压根直接就是 .claude 内容（含 commands/ 等）
 *  2. 解压根下有 .claude/ 目录
 *  3. 解压根下有单个顶层目录 <name>/，其下是 .claude/ 或直接内容
 * 返回 .claude 根的绝对路径；找不到返回 null。
 */
export function resolvePluginRoot(dir: string): string | null {
  if (!existsSync(dir)) return null;
  // 形态 1
  if (looksLikeClaudeRoot(dir)) return dir;
  // 形态 2
  const dotClaude = join(dir, ".claude");
  if (existsSync(dotClaude) && looksLikeClaudeRoot(dotClaude)) return dotClaude;
  // 形态 3：唯一顶层目录下再找
  const entries = readdirSync(dir, { withFileTypes: true }).filter(
    (e) => e.isDirectory() && e.name !== "__MACOSX",
  );
  if (entries.length === 1) {
    const sub = join(dir, entries[0].name);
    if (looksLikeClaudeRoot(sub)) return sub;
    const subDotClaude = join(sub, ".claude");
    if (existsSync(subDotClaude) && looksLikeClaudeRoot(subDotClaude)) return subDotClaude;
  }
  return null;
}

/** 读包根的 .claude-plugin/plugin.json；无/损坏返回 null。 */
export function readManifest(claudeRoot: string): PluginManifest | null {
  const file = join(claudeRoot, ".claude-plugin", "plugin.json");
  if (!existsSync(file)) return null;
  try {
    const raw = JSON.parse(readFileSync(file, "utf-8"));
    if (!raw || typeof raw.name !== "string") return null;
    return {
      name: raw.name,
      description: typeof raw.description === "string" ? raw.description : undefined,
      version: typeof raw.version === "string" ? raw.version : undefined,
      author: typeof raw.author === "string" ? raw.author : undefined,
    };
  } catch {
    return null;
  }
}

/** 统计 .claude 根下五类资源数量。 */
export function countResources(claudeRoot: string): PluginCounts {
  const countMd = (sub: string) => {
    const d = join(claudeRoot, sub);
    if (!existsSync(d)) return 0;
    return readdirSync(d).filter((f) => f.endsWith(".md")).length;
  };
  const countSkills = () => {
    const d = join(claudeRoot, "skills");
    if (!existsSync(d)) return 0;
    return readdirSync(d, { withFileTypes: true }).filter(
      (e) => e.isDirectory() && existsSync(join(d, e.name, "SKILL.md")),
    ).length;
  };
  const countMemories = () => {
    const d = join(claudeRoot, "memories");
    if (!existsSync(d)) return 0;
    return readdirSync(d).filter((f) => /\.(ya?ml|json|md)$/i.test(f)).length;
  };
  return {
    commands: countMd("commands"),
    agents: countMd("agents"),
    skills: countSkills(),
    rules: countMd("rules"),
    memories: countMemories(),
  };
}

/** 无 manifest 时自生成：name 取包目录名，description 由 counts 摘要。 */
export function autoManifest(fallbackName: string, counts: PluginCounts): PluginManifest {
  const parts: string[] = [];
  if (counts.commands) parts.push(`${counts.commands} 命令`);
  if (counts.agents) parts.push(`${counts.agents} 子代理`);
  if (counts.skills) parts.push(`${counts.skills} 技能`);
  if (counts.rules) parts.push(`${counts.rules} 规则`);
  if (counts.memories) parts.push(`${counts.memories} 知识库`);
  return {
    name: fallbackName,
    description: parts.length ? parts.join(" · ") : "空场景包",
  };
}

/** 导入时跳过的文件/目录（危险或无意义）。 */
export const SKIP_DIRS = new Set([".git", "node_modules", "__MACOSX", ".claude-plugin"]);
export const SKIP_FILES = new Set([".DS_Store"]);
// settings.local.json 含权限白名单，默认不复制；阶段三允许用户审查后可选导入。
export const SKIP_FILES_SECURITY = new Set(["settings.local.json"]);

/**
 * 遍历 .claude 根，产出所有待复制文件的相对路径（posix 风格 "/"）。
 * 跳过危险目录。用于冲突检测与复制两处同源。
 * @param includeLocalSettings 为 true 时不排除 settings.local.json（用户审查后选择导入）。
 */
export function walkClaudeFiles(claudeRoot: string, includeLocalSettings = false): string[] {
  const out: string[] = [];
  const walk = (dir: string, rel: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        walk(join(dir, entry.name), rel ? `${rel}/${entry.name}` : entry.name);
      } else {
        if (SKIP_FILES.has(entry.name)) continue;
        if (!includeLocalSettings && SKIP_FILES_SECURITY.has(entry.name)) continue;
        out.push(rel ? `${rel}/${entry.name}` : entry.name);
      }
    }
  };
  if (existsSync(claudeRoot) && statSync(claudeRoot).isDirectory()) walk(claudeRoot, "");
  return out;
}

/** 扫描包内脚本（.sh/.py/.js），归类并标注所属技能。 */
export function scanScripts(claudeRoot: string): import("@lenovo/agent-protocol").PluginScript[] {
  const scripts: import("@lenovo/agent-protocol").PluginScript[] = [];
  const extType = (name: string): "sh" | "py" | "js" | "other" => {
    if (name.endsWith(".sh")) return "sh";
    if (name.endsWith(".py")) return "py";
    if (name.endsWith(".js") || name.endsWith(".mjs") || name.endsWith(".cjs")) return "js";
    return "other";
  };
  for (const rel of walkClaudeFiles(claudeRoot, true)) {
    if (!/\.(sh|py|js|mjs|cjs)$/i.test(rel)) continue;
    const skillMatch = rel.match(/^skills\/([^/]+)\//);
    scripts.push({
      path: rel,
      type: extType(rel),
      skill: skillMatch ? skillMatch[1] : undefined,
    });
  }
  return scripts;
}

/** 读 settings.json / settings.local.json 的 permissions.allow 白名单。 */
export function readPermissions(claudeRoot: string): import("@lenovo/agent-protocol").PluginPermissions {
  const readAllow = (file: string): string[] => {
    const p = join(claudeRoot, file);
    if (!existsSync(p)) return [];
    try {
      const raw = JSON.parse(readFileSync(p, "utf-8"));
      const allow = raw?.permissions?.allow;
      return Array.isArray(allow) ? allow.filter((x: unknown) => typeof x === "string") : [];
    } catch {
      return [];
    }
  };
  return {
    fromSettings: readAllow("settings.json"),
    fromLocal: readAllow("settings.local.json"),
  };
}
