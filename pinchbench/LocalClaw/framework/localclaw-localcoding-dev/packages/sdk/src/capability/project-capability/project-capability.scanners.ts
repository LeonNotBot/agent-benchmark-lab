/**
 * 项目能力扫描器——纯函数，供 ProjectCapabilityService 调用。
 * 无 DI、无状态，方便单测。按类型拆分扫描逻辑。
 */
import { existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";
import type { ProjectCommand, ProjectAgent, ProjectRule, ProjectMemory, SkillMeta } from "@lenovo/agent-protocol";

// ── frontmatter 解析 ──

export function parseFrontmatter(raw: string): {
  meta: Record<string, unknown>;
  content: string;
} {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { meta: {}, content: raw };
  const meta: Record<string, unknown> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim();
    let val: unknown = line.slice(idx + 1).trim();
    if (typeof val === "string" && val.startsWith("[") && val.endsWith("]")) {
      try { val = JSON.parse(val); } catch {
        val = (val as string).slice(1, -1).split(",").map((s) => s.trim()).filter(Boolean);
      }
    }
    if (val === "true") val = true;
    if (val === "false") val = false;
    meta[key] = val;
  }
  return { meta, content: match[2] };
}

type ParseFn = (raw: string) => { meta: Record<string, unknown>; content: string };

// ── commands 扫描 ──

export function scanCommands(dir: string, parse?: ParseFn): ProjectCommand[] {
  if (!existsSync(dir)) return [];
  const fn = parse ?? parseFrontmatter;
  const results: ProjectCommand[] = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".md")) continue;
    try {
      const raw = readFileSync(join(dir, f), "utf-8");
      const { meta } = fn(raw);
      results.push({
        name: f.replace(/\.md$/, ""),
        description: (meta.description as string) ?? undefined,
        argumentHint: (meta["argument-hint"] as string) ?? undefined,
      });
    } catch { /* skip */ }
  }
  return results;
}

// ── agents 扫描 ──

export function scanAgents(dir: string, parse?: ParseFn): ProjectAgent[] {
  if (!existsSync(dir)) return [];
  const fn = parse ?? parseFrontmatter;
  const results: ProjectAgent[] = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".md")) continue;
    try {
      const raw = readFileSync(join(dir, f), "utf-8");
      const { meta } = fn(raw);
      results.push({
        name: f.replace(/\.md$/, ""),
        description: (meta.description as string) ?? undefined,
        model: (meta.model as string) ?? undefined,
      });
    } catch { /* skip */ }
  }
  return results;
}

// ── skills 扫描 ──

export function scanSkills(dir: string, parse?: ParseFn): SkillMeta[] {
  if (!existsSync(dir)) return [];
  const fn = parse ?? parseFrontmatter;
  const results: SkillMeta[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const skillFile = join(dir, entry.name, "SKILL.md");
    if (!existsSync(skillFile)) continue;
    try {
      const raw = readFileSync(skillFile, "utf-8");
      const { meta } = fn(raw);
      results.push({
        name: entry.name,
        displayName: (meta.name as string) ?? undefined,
        description: (meta.description as string) || "",
        whenToUse: (meta.when_to_use as string) ?? undefined,
        allowedTools: Array.isArray(meta["allowed-tools"]) ? meta["allowed-tools"] : [],
        userInvocable: meta["user-invocable"] !== false,
        context: meta.context as "inline" | "fork" | undefined,
        argumentHint: (meta["argument-hint"] as string) ?? undefined,
        arguments: Array.isArray(meta.arguments) ? meta.arguments : undefined,
        source: "project",
        disabled: false,
      });
    } catch { /* skip */ }
  }
  return results;
}

// ── rules 扫描（只读展示，取首个 H1 或 frontmatter name 作标题）──

export function scanRules(dir: string): ProjectRule[] {
  if (!existsSync(dir)) return [];
  const results: ProjectRule[] = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".md")) continue;
    try {
      const raw = readFileSync(join(dir, f), "utf-8");
      const { meta, content } = parseFrontmatter(raw);
      const h1 = content.match(/^#\s+(.+)$/m)?.[1]?.trim();
      results.push({
        name: f.replace(/\.md$/, ""),
        title: (meta.name as string) || h1 || undefined,
      });
    } catch { /* skip */ }
  }
  return results;
}

// ── memories 扫描（浅扫，仅文件名 + 格式）──

export function scanMemories(dir: string): ProjectMemory[] {
  if (!existsSync(dir)) return [];
  const results: ProjectMemory[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const m = entry.name.match(/\.(ya?ml|json|md)$/i);
    if (!m) continue;
    const ext = m[1].toLowerCase();
    results.push({
      name: entry.name,
      format: ext === "json" ? "json" : ext === "md" ? "md" : "yaml",
    });
  }
  return results;
}
