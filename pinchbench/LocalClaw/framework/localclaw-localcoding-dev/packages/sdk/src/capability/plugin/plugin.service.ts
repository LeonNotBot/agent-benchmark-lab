import { Injectable } from "@nestjs/common";
import AdmZip from "adm-zip";
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { isAbsolute, join, dirname } from "path";
import type {
  PluginPreflight, PluginImportResult, PluginScope, ScaffoldOptions, ScaffoldResult,
} from "@lenovo/agent-protocol";
import { getAgentHomeDir } from "../../config/paths";
import {
  resolvePluginRoot, readManifest, countResources, autoManifest, walkClaudeFiles,
  scanScripts, readPermissions,
} from "./plugin.scanners";
import { scaffoldFiles, SCAFFOLD_DIRS } from "./plugin.templates";

/**
 * Plugin(.claude 场景包)导入服务（SDK，@public）。
 * 本地导入：解压 zip → 定位 .claude 根 → 预检(摘要+冲突) / 安装(合并复制)。
 * 目标：scope==="global" → getAgentHomeDir()；"project" → join(cwd, ".claude")。
 * 纯读/写文件，产品无关。
 */
@Injectable()
export class PluginService {
  /** 解压 zip 到临时目录，返回其路径（调用方负责清理）。 */
  private extractZip(zipBuffer: Buffer): string {
    const dir = join(tmpdir(), `plugin-import-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(dir, { recursive: true });
    new AdmZip(zipBuffer).extractAllTo(dir, true);
    return dir;
  }

  /** 解析安装目标 .claude 目录。 */
  private targetDir(scope: PluginScope, cwd?: string): string {
    if (scope === "project") {
      if (!cwd || !isAbsolute(cwd)) throw new Error("project scope requires absolute cwd");
      return join(cwd, ".claude");
    }
    return getAgentHomeDir();
  }

  /** 预检：不写盘，返回 manifest/counts/conflicts。 */
  preflight(zipBuffer: Buffer, scope: PluginScope, cwd?: string): PluginPreflight {
    const work = this.extractZip(zipBuffer);
    try {
      const root = resolvePluginRoot(work);
      if (!root) throw new Error("未找到有效的 .claude 场景包（缺少 commands/agents/skills 等目录）");
      const counts = countResources(root);
      const manifest = readManifest(root) ?? autoManifest(pluginNameFromRoot(root), counts);
      const files = walkClaudeFiles(root);
      const dest = this.targetDir(scope, cwd);
      const conflicts = files.filter((rel) => existsSync(join(dest, rel)));
      const audit = { scripts: scanScripts(root), permissions: readPermissions(root) };
      return { manifest, counts, conflicts, audit };
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }

  /**
   * 安装：合并复制到目标。overwrite=false 时跳过冲突文件。
   * includeLocalSettings=true 时（用户审查后选择）连同 settings.local.json 一并导入。
   */
  install(
    zipBuffer: Buffer, scope: PluginScope, cwd: string | undefined,
    opts: { overwrite: boolean; includeLocalSettings?: boolean },
  ): PluginImportResult {
    const work = this.extractZip(zipBuffer);
    try {
      const root = resolvePluginRoot(work);
      if (!root) return { ok: false, installed: [], skipped: [], error: "invalid_plugin" };
      const dest = this.targetDir(scope, cwd);
      const files = walkClaudeFiles(root, opts.includeLocalSettings === true);
      const installed: string[] = [];
      const skipped: string[] = [];
      for (const rel of files) {
        // 路径穿越防护：相对路径不得含 ..、不得为绝对路径。
        if (rel.includes("..") || isAbsolute(rel)) { skipped.push(rel); continue; }
        const target = join(dest, rel);
        if (existsSync(target) && !opts.overwrite) { skipped.push(rel); continue; }
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, readFileSync(join(root, rel)));
        installed.push(rel);
      }
      return { ok: true, installed, skipped };
    } catch (e) {
      return { ok: false, installed: [], skipped: [], error: e instanceof Error ? e.message : String(e) };
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }

  /**
   * 脚手架：在 <cwd>/.claude 生成标准五类目录 + 示例模板 + plugin.json + README。
   * 不覆盖已存在文件（记入 skipped），保护已有 .claude。
   */
  scaffold(opts: ScaffoldOptions): ScaffoldResult {
    const { cwd } = opts;
    if (!cwd || !isAbsolute(cwd) || !existsSync(cwd)) {
      return { ok: false, created: [], skipped: [], error: "cwd_must_be_absolute_and_exist" };
    }
    const name = opts.name?.trim() || (cwd.split(/[\\/]/).filter(Boolean).pop() ?? "scene-pack");
    const includeExamples = opts.includeExamples !== false;
    const claudeDir = join(cwd, ".claude");
    const created: string[] = [];
    const skipped: string[] = [];
    // 先建五类目录（空骨架也要有结构）
    for (const d of SCAFFOLD_DIRS) mkdirSync(join(claudeDir, d), { recursive: true });
    for (const f of scaffoldFiles(name, includeExamples)) {
      const target = join(claudeDir, f.rel);
      if (existsSync(target)) { skipped.push(f.rel); continue; }
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, f.content, "utf-8");
      created.push(f.rel);
    }
    return { ok: true, created, skipped };
  }

  /**
   * 导出：把 <cwd>/.claude 打成场景包 zip（含 settings.local——用户自己项目，无顾虑）。
   * 包名取 plugin.json 的 name 或目录名。
   */
  exportProject(cwd: string): { zipBuffer: Buffer; fileName: string } {
    if (!cwd || !isAbsolute(cwd)) throw new Error("cwd_must_be_absolute");
    const claudeDir = join(cwd, ".claude");
    if (!existsSync(claudeDir)) throw new Error("no_claude_dir");
    const manifest = readManifest(claudeDir);
    const name = manifest?.name || (cwd.split(/[\\/]/).filter(Boolean).pop() ?? "scene-pack");
    const zip = new AdmZip();
    for (const rel of walkClaudeFiles(claudeDir, true)) {
      zip.addFile(rel, readFileSync(join(claudeDir, rel)));
    }
    return { zipBuffer: zip.toBuffer(), fileName: `${name}.zip` };
  }
}

/** 从 .claude 根反推包名：优先其父目录名（形态3 的 <name>），否则用 "plugin"。 */
function pluginNameFromRoot(root: string): string {
  const parent = dirname(root);
  const base = parent.split(/[\\/]/).filter(Boolean).pop();
  // root 若以 .claude 结尾，parent 名即包名；否则用 root 名。
  const rootName = root.split(/[\\/]/).filter(Boolean).pop();
  if (rootName === ".claude" && base) return base;
  return rootName && rootName !== ".claude" ? rootName : "plugin";
}
