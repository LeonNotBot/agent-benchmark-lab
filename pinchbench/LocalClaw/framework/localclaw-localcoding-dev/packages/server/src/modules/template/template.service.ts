import { Injectable } from "@nestjs/common";
import { join } from "path";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from "fs";
import type {
  Template,
  TemplateSummary,
  TemplateCategory,
} from "@lenovo/agent-protocol";
import { getTemplatesDir } from "@lenovo/agent-sdk";

@Injectable()
export class TemplateService {
  private get templatesDir(): string {
    return getTemplatesDir();
  }

  private ensureDir(): void {
    if (!existsSync(this.templatesDir)) {
      mkdirSync(this.templatesDir, { recursive: true });
    }
  }

  /** 解析 TEMPLATE.md 的 frontmatter，支持多行 YAML 数组 */
  private parseFrontmatter(raw: string): {
    meta: Record<string, unknown>;
    content: string;
  } {
    const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
    if (!match) return { meta: {} as Record<string, unknown>, content: raw };
    const meta: Record<string, unknown> = {};
    const lines = match[1].split(/\r?\n/);
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      const idx = line.indexOf(":");
      if (idx < 0) {
        i++;
        continue;
      }
      const key = line.slice(0, idx).trim();
      let val: unknown = line.slice(idx + 1).trim();
      // 检查是否是多行 YAML 数组（下一行以 "  - " 开头）
      if (val === "" && i + 1 < lines.length && lines[i + 1].match(/^\s+-\s/)) {
        const arr: string[] = [];
        i++;
        while (i < lines.length && lines[i].match(/^\s+-\s/)) {
          arr.push(lines[i].replace(/^\s+-\s*/, "").trim());
          i++;
        }
        meta[key] = arr;
        continue;
      }
      // 内联数组: [item1, item2]
      if (typeof val === "string" && val.startsWith("[") && val.endsWith("]")) {
        try {
          val = JSON.parse(val);
        } catch {
          val = (val as string)
            .slice(1, -1)
            .split(",")
            .map((s: string) => s.trim())
            .filter(Boolean);
        }
      }
      // 去除首尾引号
      if (typeof val === "string" && val.startsWith('"') && val.endsWith('"')) {
        val = val.slice(1, -1);
      }
      if (val === "true") val = true;
      if (val === "false") val = false;
      meta[key] = val;
      i++;
    }
    return { meta, content: match[2] };
  }

  /** 将 Template 数据序列化为 frontmatter + markdown */
  private buildTemplateMd(data: Omit<Template, "slug">): string {
    const lines: string[] = ["---"];
    lines.push(`name: "${data.name}"`);
    lines.push(`description: "${data.description}"`);
    lines.push(`icon: "${data.icon}"`);
    lines.push(`category: "${data.category}"`);
    lines.push(`routingPreference: "${data.routingPreference}"`);
    if (data.modelOverride)
      lines.push(`modelOverride: "${data.modelOverride}"`);
    if (data.skills?.length) {
      lines.push("skills:");
      for (const s of data.skills) lines.push(`  - ${s}`);
    } else {
      lines.push("skills: []");
    }
    if (data.initialPrompt)
      lines.push(`initialPrompt: "${data.initialPrompt}"`);
    lines.push(`builtin: ${data.builtin}`);
    lines.push("---", "", data.claudeMdContent ?? "");
    return lines.join("\n");
  }

  /** 将解析后的 meta 转为 TemplateSummary */
  private metaToSummary(
    slug: string,
    meta: Record<string, unknown>,
  ): TemplateSummary {
    return {
      slug,
      name: (meta.name as string) || slug,
      description: (meta.description as string) || "",
      icon: (meta.icon as string) || "📄",
      category: ((meta.category as string) || "other") as TemplateCategory,
      routingPreference:
        (() => {
          // 历史模板可能写了 "auto"/"cloud"/"local"（本地路由时代遗留）→ 统一归一化为 "standard"。
          // smart-hybrid 是全局概念，不出现在模板 override 里，故模板偏好恒为 standard。
          return "standard" as const;
        })(),
      modelOverride: meta.modelOverride as string | undefined,
      skills: Array.isArray(meta.skills) ? (meta.skills as string[]) : [],
      initialPrompt: meta.initialPrompt as string | undefined,
      builtin: meta.builtin === true,
    };
  }

  /** 列出所有模板 */
  listTemplates(): TemplateSummary[] {
    this.ensureDir();
    const entries = readdirSync(this.templatesDir, { withFileTypes: true });
    const results: TemplateSummary[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const tplFile = join(this.templatesDir, entry.name, "TEMPLATE.md");
      if (!existsSync(tplFile)) continue;
      try {
        const raw = readFileSync(tplFile, "utf-8");
        const { meta } = this.parseFrontmatter(raw);
        results.push(this.metaToSummary(entry.name, meta));
      } catch {
        /* skip broken templates */
      }
    }
    return results;
  }

  /** 获取完整模板（含 claudeMdContent） */
  getTemplate(slug: string): Template | null {
    const tplFile = join(this.templatesDir, slug, "TEMPLATE.md");
    if (!existsSync(tplFile)) return null;
    const raw = readFileSync(tplFile, "utf-8");
    const { meta, content } = this.parseFrontmatter(raw);
    return { ...this.metaToSummary(slug, meta), claudeMdContent: content };
  }

  /** 保存模板（新建或更新），始终设置 builtin: false */
  saveTemplate(data: Omit<Template, "builtin">): TemplateSummary {
    this.ensureDir();
    const dir = join(this.templatesDir, data.slug);
    mkdirSync(dir, { recursive: true });
    const fullData: Omit<Template, "slug"> = { ...data, builtin: false };
    writeFileSync(
      join(dir, "TEMPLATE.md"),
      this.buildTemplateMd(fullData),
      "utf-8",
    );
    return this.metaToSummary(data.slug, { ...fullData });
  }

  /** 删除模板（内置模板不可删除） */
  deleteTemplate(slug: string): boolean {
    const tpl = this.getTemplate(slug);
    if (tpl?.builtin) throw new Error(`内置模板 "${slug}" 不可删除`);
    const dir = join(this.templatesDir, slug);
    if (!existsSync(dir)) return false;
    rmSync(dir, { recursive: true, force: true });
    return true;
  }

  /** 同步内置模板（跳过已存在的） */
  syncBuiltinTemplates(builtinDir: string): {
    installed: string[];
    skipped: string[];
  } {
    if (!existsSync(builtinDir)) return { installed: [], skipped: [] };
    this.ensureDir();
    const installed: string[] = [];
    const skipped: string[] = [];
    for (const entry of readdirSync(builtinDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const srcFile = join(builtinDir, entry.name, "TEMPLATE.md");
      if (!existsSync(srcFile)) continue;
      const destDir = join(this.templatesDir, entry.name);
      const destFile = join(destDir, "TEMPLATE.md");
      if (existsSync(destDir)) {
        if (!existsSync(destFile)) {
          skipped.push(entry.name);
          continue;
        }

        const sourceRaw = readFileSync(srcFile, "utf-8");
        const destRaw = readFileSync(destFile, "utf-8");
        const { meta } = this.parseFrontmatter(destRaw);

        // Only refresh previously-installed builtin templates. User-created templates are builtin=false.
        if (meta.builtin === true && sourceRaw !== destRaw) {
          writeFileSync(destFile, sourceRaw, "utf-8");
          installed.push(entry.name);
          continue;
        }

        skipped.push(entry.name);
        continue;
      }
      mkdirSync(destDir, { recursive: true });
      writeFileSync(
        join(destDir, "TEMPLATE.md"),
        readFileSync(srcFile, "utf-8"),
        "utf-8",
      );
      installed.push(entry.name);
    }
    return { installed, skipped };
  }

  /**
   * 写入模板的 CLAUDE.md 到项目根目录（纯副作用，已存在则追加）。
   *
   * CLI 只读项目根 CLAUDE.md 与 .claude/CLAUDE.md，不读嵌套的 .localclaw/CLAUDE.md。
   * 故写入项目根 CLAUDE.md（与 smart-hybrid 注入位置一致），确保模板约束真正被 CLI 加载。
   */
  writeTemplateClaudeMd(slug: string, cwd?: string): void {
    if (!cwd) return;
    const tpl = this.getTemplate(slug);
    if (!tpl?.claudeMdContent) return;
    if (!existsSync(cwd)) mkdirSync(cwd, { recursive: true });
    const claudeMdPath = join(cwd, "CLAUDE.md");
    if (existsSync(claudeMdPath)) {
      const existing = readFileSync(claudeMdPath, "utf-8");
      writeFileSync(claudeMdPath, existing + "\n\n" + tpl.claudeMdContent, "utf-8");
    } else {
      writeFileSync(claudeMdPath, tpl.claudeMdContent, "utf-8");
    }
  }

  /** 读取模板的路由/skill/prompt 配置（纯查询，无副作用）。 */
  getTemplateConfig(slug: string): {
    routingPreference: Template["routingPreference"];
    modelOverride?: string;
    skills: string[];
    initialPrompt?: string;
  } | null {
    const tpl = this.getTemplate(slug);
    if (!tpl) return null;
    return {
      routingPreference: tpl.routingPreference,
      modelOverride: tpl.modelOverride,
      skills: tpl.skills,
      initialPrompt: tpl.initialPrompt,
    };
  }
}
