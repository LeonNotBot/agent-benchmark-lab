import { Injectable } from "@nestjs/common";
import { join, basename, extname } from "path";
import { tmpdir } from "os";
import {
  existsSync, mkdirSync, readdirSync, readFileSync,
  writeFileSync, rmSync, statSync, copyFileSync,
} from "fs";
import type { SkillMeta, SkillDetail } from "@lenovo/agent-protocol";
import { getSkillsDir, logger } from "@lenovo/agent-sdk";
import AdmZip from "adm-zip";

@Injectable()
export class SkillService {
  private get skillsDir(): string {
    return getSkillsDir();
  }

  /** 停用技能名单文件路径（磁盘真相源，runner 侧同样读取此文件强制门控）。 */
  private get disabledFile(): string {
    return join(this.skillsDir, ".disabled.json");
  }

  /** 读取被停用的技能名集合。文件缺失 / 损坏 → 空集合（视为全部启用）。 */
  listDisabled(): string[] {
    try {
      if (!existsSync(this.disabledFile)) return [];
      const raw = readFileSync(this.disabledFile, "utf-8");
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr.filter((n) => typeof n === "string") : [];
    } catch {
      return [];
    }
  }

  /** 设置某技能的停用状态，写回磁盘真相源。 */
  setDisabled(name: string, disabled: boolean): void {
    this.ensureDir();
    const cur = new Set(this.listDisabled());
    if (disabled) cur.add(name);
    else cur.delete(name);
    writeFileSync(this.disabledFile, JSON.stringify([...cur]), "utf-8");
  }

  /** 确保 skills 目录存在 */
  private ensureDir(): void {
    if (!existsSync(this.skillsDir)) {
      mkdirSync(this.skillsDir, { recursive: true });
    }
  }

  /** 解析 SKILL.md 的 frontmatter */
  private parseFrontmatter(raw: string) {
    const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
    if (!match) return { meta: {} as Record<string, unknown>, content: raw };
    const meta: Record<string, unknown> = {};
    for (const line of match[1].split(/\r?\n/)) {
      const idx = line.indexOf(":");
      if (idx < 0) continue;
      const key = line.slice(0, idx).trim();
      let val: unknown = line.slice(idx + 1).trim();
      if (typeof val === "string" && val.startsWith("[") && val.endsWith("]")) {
        try {
          val = JSON.parse(val);
        } catch {
          // YAML 风格无引号数组: [Bash, Read, Write] → ["Bash", "Read", "Write"]
          val = (val as string).slice(1, -1).split(",").map((s: string) => s.trim()).filter(Boolean);
        }
      }
      if (val === "true") val = true;
      if (val === "false") val = false;
      meta[key] = val;
    }
    return { meta, content: match[2] };
  }

  /**
   * 校验 skill frontmatter 完整性。
   * - whenToUse 缺失时给出警告（不影响写入），引导用户正确配置触发条件。
   * - description/content 缺失时拒绝写入。
   */
  private validateSkillFrontmatter(dto: {
    description: string; content: string; whenToUse?: string;
  }): void {
    if (!dto.description?.trim()) {
      throw new Error("description 不能为空");
    }
    if (!dto.content?.trim()) {
      throw new Error("Prompt 内容不能为空");
    }
    if (!dto.whenToUse?.trim()) {
      logger.warn(
        `[skill] Skill 缺少 when_to_use 字段，将无法被自动触发。` +
        `建议添加：when_to_use: "当用户...时调用此技能"`,
      );
    }
  }

  /** 将 SkillMeta 序列化为 SKILL.md */
  private buildSkillMd(dto: {
    displayName?: string; description: string;
    whenToUse?: string; allowedTools?: string[];
    userInvocable?: boolean;
    context?: string; argumentHint?: string;
    arguments?: string[]; content: string;
  }): string {
    const lines: string[] = ["---"];
    if (dto.displayName) lines.push(`name: ${dto.displayName}`);
    lines.push(`description: ${dto.description}`);
    if (dto.whenToUse) lines.push(`when_to_use: ${dto.whenToUse}`);
    if (dto.allowedTools?.length) {
      lines.push(`allowed-tools: [${dto.allowedTools.join(", ")}]`);
    }
    if (dto.userInvocable !== undefined) {
      lines.push(`user-invocable: ${dto.userInvocable}`);
    }
    if (dto.context) lines.push(`context: ${dto.context}`);
    if (dto.argumentHint) lines.push(`argument-hint: ${dto.argumentHint}`);
    if (dto.arguments?.length) {
      lines.push(`arguments: [${dto.arguments.join(", ")}]`);
    }
    lines.push("---", "", dto.content);
    return lines.join("\n");
  }

  /** 列出所有已安装 skill */
  listSkills(): SkillMeta[] {
    this.ensureDir();
    const disabled = new Set(this.listDisabled());
    const entries = readdirSync(this.skillsDir, { withFileTypes: true });
    const skills: SkillMeta[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skillFile = join(this.skillsDir, entry.name, "SKILL.md");
      if (!existsSync(skillFile)) continue;
      try {
        const raw = readFileSync(skillFile, "utf-8");
        const { meta } = this.parseFrontmatter(raw);
        skills.push({
          name: entry.name,
          displayName: meta.name as string | undefined,
          description: (meta.description as string) || "",
          whenToUse: meta.when_to_use as string | undefined,
          allowedTools: Array.isArray(meta["allowed-tools"])
            ? meta["allowed-tools"] : [],
          userInvocable: meta["user-invocable"] !== false,
          context: meta.context as "inline" | "fork" | undefined,
          argumentHint: meta["argument-hint"] as string | undefined,
          arguments: Array.isArray(meta.arguments)
            ? meta.arguments : undefined,
          source: existsSync(join(this.skillsDir, entry.name, ".builtin")) ? "builtin" : "user",
          installedAt: statSync(skillFile).mtimeMs,
          disabled: disabled.has(entry.name),
        });
      } catch { /* skip broken skills */ }
    }
    return skills;
  }

  /** 获取 skill 完整详情 */
  getSkill(name: string): SkillDetail | null {
    const dir = join(this.skillsDir, name);
    const skillFile = join(dir, "SKILL.md");
    if (!existsSync(skillFile)) return null;
    const raw = readFileSync(skillFile, "utf-8");
    const { meta, content } = this.parseFrontmatter(raw);
    const files = readdirSync(dir).filter(f => f !== "SKILL.md");
    return {
      name,
      displayName: meta.name as string | undefined,
      description: (meta.description as string) || "",
      whenToUse: meta.when_to_use as string | undefined,
      allowedTools: Array.isArray(meta["allowed-tools"])
        ? meta["allowed-tools"] : [],
      userInvocable: meta["user-invocable"] !== false,
      context: meta.context as "inline" | "fork" | undefined,
      argumentHint: meta["argument-hint"] as string | undefined,
      arguments: Array.isArray(meta.arguments)
        ? meta.arguments : undefined,
      source: "user",
      content,
      rawMarkdown: raw,
      files: files.length > 0 ? files : undefined,
    };
  }

  /** 创建新 skill */
  createSkill(name: string, dto: {
    displayName?: string; description: string;
    whenToUse?: string; allowedTools?: string[];
    userInvocable?: boolean;
    context?: string; argumentHint?: string;
    arguments?: string[]; content: string;
  }): SkillMeta {
    this.ensureDir();
    const dir = join(this.skillsDir, name);
    if (existsSync(dir)) throw new Error(`Skill "${name}" already exists`);
    mkdirSync(dir, { recursive: true });
    this.validateSkillFrontmatter(dto);
    writeFileSync(join(dir, "SKILL.md"), this.buildSkillMd(dto), "utf-8");
    return this.listSkills().find(s => s.name === name)!;
  }

  /** 更新 skill */
  updateSkill(name: string, dto: {
    displayName?: string; description: string;
    whenToUse?: string; allowedTools?: string[];
    userInvocable?: boolean;
    context?: string; argumentHint?: string;
    arguments?: string[]; content: string;
  }): SkillMeta {
    const dir = join(this.skillsDir, name);
    if (!existsSync(dir)) throw new Error(`Skill "${name}" not found`);
    this.validateSkillFrontmatter(dto);
    writeFileSync(join(dir, "SKILL.md"), this.buildSkillMd(dto), "utf-8");
    return this.listSkills().find(s => s.name === name)!;
  }

  /** 删除 skill */
  deleteSkill(name: string): boolean {
    const dir = join(this.skillsDir, name);
    if (!existsSync(dir)) return false;
    rmSync(dir, { recursive: true, force: true });
    // 同步清理停用名单，避免残留项在同名技能重装后误判为停用
    if (this.listDisabled().includes(name)) this.setDisabled(name, false);
    return true;
  }

  /** 通过 raw markdown 安装 skill（市场导入用） */
  installFromRaw(name: string, rawMarkdown: string): SkillMeta {
    this.ensureDir();
    const dir = join(this.skillsDir, name);
    mkdirSync(dir, { recursive: true });

    // 复用前端已有的 frontmatter 校验，防止 description/content 为空导致安装"成功"但无效
    const { meta, content } = this.parseFrontmatter(rawMarkdown);
    this.validateSkillFrontmatter({
      description: (meta.description as string) || "",
      content,
      whenToUse: meta.when_to_use as string | undefined,
    });

    // 市场安装统一全选"允许的工具"：无论 SKILL.md 是否声明 allowed-tools，
    // 都重写为全部工具，确保用户进入编辑界面时所有权限默认选中。
    const finalMarkdown = this.buildSkillMd({
      displayName: meta.name as string | undefined,
      description: (meta.description as string) || "",
      whenToUse: meta.when_to_use as string | undefined,
      allowedTools: [
        "Bash", "Read", "Write", "Edit", "Grep", "Glob", "Agent",
        "TodoWrite", "WebSearch", "WebFetch", "NotebookEdit", "Skill",
      ],
      userInvocable: meta["user-invocable"] !== false,
      context: meta.context as "inline" | "fork" | undefined,
      argumentHint: meta["argument-hint"] as string | undefined,
      arguments: Array.isArray(meta.arguments) ? meta.arguments : undefined,
      content,
    });

    writeFileSync(join(dir, "SKILL.md"), finalMarkdown, "utf-8");
    return this.listSkills().find(s => s.name === name)!;
  }

  /** 导出 skill 为 zip */
  exportSkill(name: string): { zipBuffer: Buffer; fileName: string } {
    const dir = join(this.skillsDir, name);
    if (!existsSync(dir)) throw new Error(`Skill "${name}" not found`);
    const zip = new AdmZip();
    this.addDirToZip(zip, dir, name);
    return { zipBuffer: zip.toBuffer(), fileName: `${name}.zip` };
  }

  private addDirToZip(zip: AdmZip, dirPath: string, zipPrefix: string): void {
    for (const entry of readdirSync(dirPath, { withFileTypes: true })) {
      const full = join(dirPath, entry.name);
      const zipPath = `${zipPrefix}/${entry.name}`;
      if (entry.isDirectory()) {
        this.addDirToZip(zip, full, zipPath);
      } else {
        zip.addFile(zipPath, readFileSync(full));
      }
    }
  }

  // 导入时需要跳过的文件
  private static SKIP_FILES = new Set([
    "manifest.json", "_meta.json", "package-lock.json", ".DS_Store",
  ]);
  private static SKIP_DIRS = new Set([
    "node_modules", ".git", ".github", "agents", "__MACOSX",
  ]);

  /** 从本地路径导入 skill（zip 或文件夹） */
  importSkill(sourcePath: string): { name: string; warnings: string[] } {
    if (!existsSync(sourcePath)) {
      throw new Error(`路径不存在: ${sourcePath}`);
    }
    const isZip = statSync(sourcePath).isFile() && extname(sourcePath).toLowerCase() === ".zip";
    let workDir: string;
    let tempDir: string | null = null;

    if (isZip) {
      tempDir = join(tmpdir(), `skill-import-${Date.now()}`);
      mkdirSync(tempDir, { recursive: true });
      const zip = new AdmZip(sourcePath);
      zip.extractAllTo(tempDir, true);
      workDir = tempDir;
    } else {
      workDir = sourcePath;
    }

    try {
      const resolved = this.resolveSkillRoot(workDir);
      if (!resolved) {
        throw new Error("未找到 SKILL.md 文件，不是有效的 Skill 目录");
      }
      const { root, isClawHub } = resolved;

      let raw = readFileSync(join(root, "SKILL.md"), "utf-8");
      if (isClawHub) {
        raw = this.cleanClawHubSkillMd(raw);
      }

      const { meta } = this.parseFrontmatter(raw);
      if (!meta.name && !meta.description) {
        throw new Error("SKILL.md frontmatter 缺少 name 或 description 字段");
      }

      const rawName = (meta.name as string) || (meta.slug as string)
        || basename(sourcePath).replace(/\.zip$/i, "");
      // 安全校验：skill 名称不能包含路径分隔符
      const name = rawName.replace(/[\/\\\.]+/g, "-").replace(/^-+|-+$/g, "");
      if (!name) {
        throw new Error("无法从 SKILL.md 中提取有效的 skill 名称");
      }
      const warnings: string[] = [];

      const destDir = join(this.skillsDir, name);
      if (existsSync(destDir)) {
        warnings.push(`已覆盖同名 Skill: ${name}`);
        rmSync(destDir, { recursive: true, force: true });
      }

      this.ensureDir();
      mkdirSync(destDir, { recursive: true });
      writeFileSync(join(destDir, "SKILL.md"), raw, "utf-8");
      this.copySkillFiles(root, destDir, warnings);

      return { name, warnings };
    } finally {
      if (tempDir && existsSync(tempDir)) {
        rmSync(tempDir, { recursive: true, force: true });
      }
    }
  }

  /** 智能查找 SKILL.md 所在的根目录 */
  private resolveSkillRoot(dir: string): { root: string; isClawHub: boolean } | null {
    if (existsSync(join(dir, "SKILL.md"))) {
      return { root: dir, isClawHub: false };
    }
    if (existsSync(join(dir, "latest", "SKILL.md"))) {
      return { root: join(dir, "latest"), isClawHub: true };
    }
    const entries = readdirSync(dir, { withFileTypes: true });
    const dirs = entries.filter(e => e.isDirectory());
    if (dirs.length === 1) {
      const sub = join(dir, dirs[0].name);
      if (existsSync(join(sub, "SKILL.md"))) {
        return { root: sub, isClawHub: false };
      }
      if (existsSync(join(sub, "latest", "SKILL.md"))) {
        return { root: join(sub, "latest"), isClawHub: true };
      }
    }
    return null;
  }

  /** 清洗 ClawHub 格式的 SKILL.md */
  private cleanClawHubSkillMd(raw: string): string {
    const idx = raw.indexOf("\n---\n");
    if (idx >= 0) return raw.slice(idx + 1);
    const idxCr = raw.indexOf("\r\n---\r\n");
    if (idxCr >= 0) return raw.slice(idxCr + 2);
    return raw;
  }

  /** 拷贝辅助文件到目标目录 */
  private copySkillFiles(src: string, dest: string, warnings: string[]): void {
    for (const entry of readdirSync(src, { withFileTypes: true })) {
      if (entry.name === "SKILL.md") continue;
      if (SkillService.SKIP_FILES.has(entry.name)) continue;
      if (entry.isDirectory()) {
        if (SkillService.SKIP_DIRS.has(entry.name)) continue;
        this.copyDirRecursive(join(src, entry.name), join(dest, entry.name));
        if (entry.name === "scripts" || entry.name === "bin") {
          warnings.push(`包含可执行脚本目录: ${entry.name}/`);
        }
      } else {
        copyFileSync(join(src, entry.name), join(dest, entry.name));
        if (entry.name === "package.json") {
          warnings.push("检测到 Node.js 依赖，可能需要运行 npm install");
        }
        if (entry.name === "requirements.txt") {
          warnings.push("检测到 Python 依赖，可能需要运行 pip install");
        }
      }
    }
  }

  private copyDirRecursive(src: string, dest: string): void {
    mkdirSync(dest, { recursive: true });
    for (const entry of readdirSync(src, { withFileTypes: true })) {
      const s = join(src, entry.name);
      const d = join(dest, entry.name);
      entry.isDirectory() ? this.copyDirRecursive(s, d) : copyFileSync(s, d);
    }
  }

  /** 从上传的 zip Buffer 导入 */
  importFromZipBuffer(buffer: Buffer): { name: string; warnings: string[] } {
    const tempZip = join(tmpdir(), `skill-upload-${Date.now()}.zip`);
    writeFileSync(tempZip, buffer);
    try {
      return this.importSkill(tempZip);
    } finally {
      if (existsSync(tempZip)) rmSync(tempZip);
    }
  }

  /** 安装内置 skills（首次启动时调用） */
  installBuiltinSkills(builtinDir: string): { installed: string[]; skipped: string[] } {
    if (!existsSync(builtinDir)) return { installed: [], skipped: [] };
    this.ensureDir();
    const installed: string[] = [];
    const skipped: string[] = [];
    const entries = readdirSync(builtinDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const srcSkillDir = join(builtinDir, entry.name);
      if (!existsSync(join(srcSkillDir, "SKILL.md"))) continue;
      const destDir = join(this.skillsDir, entry.name);
      if (existsSync(destDir)) {
        skipped.push(entry.name);
        continue;
      }
      this.copyDirRecursive(srcSkillDir, destDir);
      writeFileSync(join(destDir, ".builtin"), "", "utf-8");
      installed.push(entry.name);
    }
    return { installed, skipped };
  }
}