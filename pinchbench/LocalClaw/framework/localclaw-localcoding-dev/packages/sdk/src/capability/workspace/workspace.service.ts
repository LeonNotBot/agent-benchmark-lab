import { Injectable } from "@nestjs/common";
import { join, extname, basename, resolve } from "path";
import { homedir, tmpdir } from "os";
import { createHash } from "crypto";
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  rmSync,
  readFileSync,
  writeFileSync,
  readdirSync as rdSync,
} from "fs";
import type {
  GeneratedFile,
  GeneratedFileType,
  DetectedCommand,
  Attachment,
} from "@lenovo/agent-protocol";
import type {
  PersistedAttachmentContext,
  PersistedAttachmentFile,
} from "../../util/attachment-context";
import { getWorkspaceRoot as resolveWorkspaceRoot, getProductName } from "../../config/paths";
import AdmZip from "adm-zip";

const CODE_EXTS = new Set([
  ".ts",
  ".js",
  ".py",
  ".go",
  ".java",
  ".rs",
  ".c",
  ".cpp",
  ".sh",
  ".rb",
  ".php",
  ".swift",
  ".kt",
]);
const IMAGE_EXTS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".bmp",
  ".svg",
]);

// ── 一键部署打包过滤规则 ──────────────────────────────────────────────
// 目标：把本地目录打成部署包时，剔除依赖/构建产物/缓存/版本控制等干扰目录，
// 以及可执行文件、安装包、压缩包、编译产物等与「运行网页」无关的二进制文件。
// 注意：图片/字体/音视频等网页静态资源不在过滤范围内，确保页面资源完整。

// 跳过的目录（按名称精确匹配，递归生效）
const PACK_SKIP_DIRS = new Set([
  // 版本控制
  ".git", ".svn", ".hg",
  // 依赖
  "node_modules", ".pnpm-store", "bower_components", "vendor", "venv", ".venv", "env",
  // 构建产物
  "dist", "build", "out", "target", ".next", ".nuxt", ".output", ".svelte-kit",
  // 缓存 / 中间目录
  ".cache", ".parcel-cache", ".turbo", "__pycache__", ".pytest_cache", ".mypy_cache", ".gradle",
  // IDE / 工具（产品自身配置目录在运行时按 getProductName 追加，见 shouldSkipPackEntry）
  ".idea", ".vscode",
  // 测试覆盖率
  "coverage", ".nyc_output",
  // 打包输出
  "release", "releases",
  // 系统
  "$RECYCLE.BIN", "System Volume Information",
]);

// 跳过的文件扩展名（小写）
const PACK_SKIP_EXTS = new Set([
  // 可执行 / 安装包
  ".exe", ".msi", ".dll", ".so", ".dylib", ".app", ".dmg", ".pkg", ".deb", ".rpm", ".appimage", ".apk", ".bin",
  // 压缩包
  ".zip", ".tar", ".gz", ".tgz", ".bz2", ".xz", ".7z", ".rar",
  // 编译 / 中间产物
  ".o", ".obj", ".a", ".lib", ".class", ".pyc", ".pyo", ".wasm", ".node", ".pdb",
  // 临时 / 日志 / 备份
  ".log", ".tmp", ".temp", ".swp", ".bak", ".old",
  // 本地数据库
  ".sqlite", ".sqlite3", ".db",
]);

// 跳过的具体文件名
const PACK_SKIP_FILES = new Set([
  ".DS_Store", "Thumbs.db", "desktop.ini",
  "npm-debug.log", "yarn-error.log", "pnpm-debug.log",
]);

// 判断打包时是否应跳过某个条目
function shouldSkipPackEntry(name: string, isDir: boolean): boolean {
  if (isDir) return PACK_SKIP_DIRS.has(name) || name === "." + getProductName();
  if (PACK_SKIP_FILES.has(name)) return true;
  // .env 及其变体含密钥，出于安全不打包；保留 .env.example/.sample/.template 示例
  if (/^\.env(\.|$)/i.test(name) && !/\.(example|sample|template)$/i.test(name)) {
    return true;
  }
  return PACK_SKIP_EXTS.has(extname(name).toLowerCase());
}

function getFileType(name: string): GeneratedFileType {
  const ext = extname(name).toLowerCase();
  if (ext === ".pdf") return "pdf";
  if (IMAGE_EXTS.has(ext)) return "image";
  if (ext === ".csv") return "csv";
  if (CODE_EXTS.has(ext)) return "code";
  return "other";
}

function sanitizeTitle(title: string): string {
  return title.replace(/[\\/:*?"<>|]/g, "_").slice(0, 10);
}

function sanitizeFileName(name: string): string {
  const cleaned = basename(name || "attachment")
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, "_")
    .trim();
  return cleaned || "attachment";
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function extractDocxText(buffer: Buffer): string {
  const zip = new AdmZip(buffer);
  const documentEntry = zip.getEntry("word/document.xml");
  if (!documentEntry) return "";

  const documentXml = zip.readAsText(documentEntry, "utf8");
  return decodeXmlEntities(
    documentXml
      .replace(/<w:tab\/?\s*>/g, "\t")
      .replace(/<w:br[^>]*\/?\s*>/g, "\n")
      .replace(/<\/w:p>/g, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/\r/g, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
  );
}

function findExistingSessionDir(
  sessionsDir: string,
  shortId: string,
): string | null {
  try {
    const existing = readdirSync(sessionsDir, { withFileTypes: true }).find(
      (entry) => entry.isDirectory() && entry.name.endsWith(`_${shortId}`),
    );
    return existing ? join(sessionsDir, existing.name) : null;
  } catch {
    return null;
  }
}

/**
 * WORKSPACE_SERVICE —— IWorkspaceService 的 NestJS 注入令牌（@public）。
 * 对外接入方用 `@Inject(WORKSPACE_SERVICE) svc: IWorkspaceService` 注入。
 */
export const WORKSPACE_SERVICE = Symbol("WORKSPACE_SERVICE");

/**
 * IWorkspaceService —— 对外稳定的工作区能力接口（@public）。
 * 暴露目录/文件读取、打包、命令探测、建项目等对外方法；
 * 内部附件持久化 / 产物扫描（persistAttachments / scanGeneratedFiles）供 SDK 内部用，不入对外接口。
 */
export interface IWorkspaceService {
  listDir(
    dirPath: string,
  ): Promise<Array<{ name: string; path: string; isDir: boolean; size?: number }>>;
  searchFiles(
    rootPath: string,
    query: string,
    limit?: number,
  ): Promise<Array<{ name: string; path: string; relativePath: string; isDir: boolean }>>;
  readFileContent(
    filePath: string,
    cwd?: string,
  ): Promise<{ content: string; encoding: string; size: number }>;
  readFileBase64(
    filePath: string,
  ): Promise<{ base64: string; mimeType: string; size: number } | null>;
  detectCommands(cwd: string): DetectedCommand[];
  packDir(
    dirPath: string,
  ): Promise<{ zipPath: string; dirName: string; hash: string; fileCount: number; skipped: number }>;
  createProjectInDocuments(rawName: string): { path: string; name: string };
  serveFile(filePath: string, res: any): Promise<void>;
}

@Injectable()
export class WorkspaceService implements IWorkspaceService {
  getWorkspaceRoot(): string {
    const root = resolveWorkspaceRoot();
    if (!existsSync(root)) mkdirSync(root, { recursive: true });
    return root;
  }

  async ensureCronTaskDir(taskId: string, taskName: string): Promise<string> {
    const root = this.getWorkspaceRoot();
    const cronDir = join(root, "cron");
    if (!existsSync(cronDir)) mkdirSync(cronDir, { recursive: true });
    const safeName = sanitizeTitle(taskName || "task");
    const shortId = taskId.slice(0, 6);
    const fullPath = join(cronDir, `${safeName}_${shortId}`);
    if (!existsSync(fullPath)) mkdirSync(fullPath, { recursive: true });
    return fullPath;
  }

  async ensureSessionDir(sessionId: string, title: string): Promise<string> {
    const root = this.getWorkspaceRoot();
    const sessionsDir = join(root, "sessions");
    if (!existsSync(sessionsDir)) mkdirSync(sessionsDir, { recursive: true });
    const shortId = sessionId.slice(0, 6);
    const existingDir = findExistingSessionDir(sessionsDir, shortId);
    if (existingDir) return existingDir;
    const date = new Date().toISOString().slice(0, 10);
    const safeName = sanitizeTitle(title || "session");
    const dirName = `${date}_${safeName}_${shortId}`;
    const fullPath = join(sessionsDir, dirName);
    if (!existsSync(fullPath)) mkdirSync(fullPath, { recursive: true });
    return fullPath;
  }

  async ensureAttachmentTextSidecars(
    sessionId: string,
    title: string,
  ): Promise<void> {
    const sessionDir = await this.ensureSessionDir(sessionId, title);
    const attachmentsDir = join(sessionDir, "attachments");
    if (!existsSync(attachmentsDir)) return;

    for (const entry of readdirSync(attachmentsDir, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      if (extname(entry.name).toLowerCase() !== ".docx") continue;

      const fullPath = join(attachmentsDir, entry.name);
      const extractedTextPath = `${fullPath}.txt`;
      if (existsSync(extractedTextPath)) continue;

      try {
        const extractedText = extractDocxText(readFileSync(fullPath));
        if (extractedText)
          writeFileSync(extractedTextPath, extractedText, "utf8");
      } catch {
        // skip unreadable historical attachments
      }
    }
  }

  async persistAttachments(
    sessionId: string,
    title: string,
    attachments: Attachment[],
  ): Promise<PersistedAttachmentContext | null> {
    if (!attachments.length) return null;

    const sessionDir = await this.ensureSessionDir(sessionId, title);
    const attachmentsDir = join(sessionDir, "attachments");
    if (!existsSync(attachmentsDir))
      mkdirSync(attachmentsDir, { recursive: true });

    const timestamp = Date.now();
    const files: PersistedAttachmentFile[] = attachments.map((att, index) => {
      const safeName = sanitizeFileName(att.name);
      const savedName = `${timestamp}-${String(index + 1).padStart(2, "0")}-${safeName}`;
      const fullPath = join(attachmentsDir, savedName);
      const buffer = Buffer.from(att.base64, "base64");
      writeFileSync(fullPath, buffer);
      let extractedTextPath: string | undefined;
      if (extname(safeName).toLowerCase() === ".docx") {
        const extractedText = extractDocxText(buffer);
        if (extractedText) {
          extractedTextPath = `${fullPath}.txt`;
          writeFileSync(extractedTextPath, extractedText, "utf8");
        }
      }
      return {
        originalName: att.name,
        savedPath: fullPath,
        relativePath: join("attachments", savedName),
        mimeType: att.mimeType,
        size: att.size,
        extractedTextPath,
      };
    });

    return { directory: attachmentsDir, files };
  }

  async scanGeneratedFiles(
    dir: string,
    startTime: number,
  ): Promise<GeneratedFile[]> {
    if (!existsSync(dir)) return [];
    const results: GeneratedFile[] = [];
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        const fullPath = join(dir, entry.name);
        try {
          const stat = statSync(fullPath);
          const birthMs = stat.birthtimeMs ?? stat.ctimeMs;
          if (birthMs > startTime) {
            results.push({
              name: entry.name,
              path: fullPath,
              size: stat.size,
              type: getFileType(entry.name),
              createdAt: Math.floor(birthMs),
            });
          }
        } catch {
          /* skip */
        }
      }
    } catch {
      /* skip */
    }
    return results;
  }

  async cleanupOldSessions(maxAgeMs: number): Promise<void> {
    const root = this.getWorkspaceRoot();
    const sessionsDir = join(root, "sessions");
    if (!existsSync(sessionsDir)) return;
    const now = Date.now();
    try {
      for (const entry of readdirSync(sessionsDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const fullPath = join(sessionsDir, entry.name);
        try {
          const stat = statSync(fullPath);
          if (now - stat.mtimeMs > maxAgeMs) {
            rmSync(fullPath, { recursive: true, force: true });
          }
        } catch {
          /* skip */
        }
      }
    } catch {
      /* skip */
    }
  }

  private isSafePath(p: string): boolean {
    const resolved = require("path").resolve(p);
    // 拦截明确危险的系统路径
    const BLOCKED = [
      "C:\\Windows",
      "C:\\Program Files",
      "C:\\Program Files (x86)",
      "/etc",
      "/bin",
      "/sbin",
      "/usr/bin",
      "/usr/sbin",
      "/boot",
      "/proc",
      "/sys",
    ];
    return !BLOCKED.some((b) =>
      resolved.toLowerCase().startsWith(b.toLowerCase()),
    );
  }

  async listDir(
    dirPath: string,
  ): Promise<
    Array<{ name: string; path: string; isDir: boolean; size?: number }>
  > {
    if (!this.isSafePath(dirPath) || !existsSync(dirPath)) return [];
    const SKIP = new Set([
      ".git",
      "node_modules",
      "." + getProductName(),
      "__pycache__",
      ".venv",
      "dist",
      ".next",
    ]);
    try {
      const entries = readdirSync(dirPath, { withFileTypes: true });
      const result: Array<{
        name: string;
        path: string;
        isDir: boolean;
        size?: number;
      }> = [];
      for (const entry of entries) {
        if (SKIP.has(entry.name)) continue;
        const fullPath = join(dirPath, entry.name);
        const isDir = entry.isDirectory();
        let size: number | undefined;
        if (!isDir) {
          try {
            size = statSync(fullPath).size;
          } catch {
            /* skip */
          }
        }
        result.push({ name: entry.name, path: fullPath, isDir, size });
      }
      // 目录在前，文件在后，各自按名字排序
      result.sort((a, b) => {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      return result;
    } catch {
      return [];
    }
  }

  // 从 rootPath 递归搜索文件名（大小写不敏感子串）匹配的文件。
  // 跳过依赖/版本控制/构建产物等目录（复用与 listDir 一致的 SKIP 规则）；
  // 用双上限保护：最多遍历 MAX_VISIT 个条目、最多返回 limit 条结果，防止超大目录卡死。
  async searchFiles(
    rootPath: string,
    query: string,
    limit = 200,
  ): Promise<Array<{ name: string; path: string; relativePath: string; isDir: boolean }>> {
    if (!this.isSafePath(rootPath) || !existsSync(rootPath)) return [];
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const SKIP = new Set([
      ".git",
      "node_modules",
      "." + getProductName(),
      "__pycache__",
      ".venv",
      "dist",
      ".next",
    ]);
    const MAX_VISIT = 50000;
    const results: Array<{ name: string; path: string; relativePath: string; isDir: boolean }> = [];
    let visited = 0;

    const walk = (dir: string) => {
      if (results.length >= limit || visited >= MAX_VISIT) return;
      let entries: import("fs").Dirent[];
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (results.length >= limit || visited >= MAX_VISIT) return;
        if (SKIP.has(entry.name)) continue;
        visited++;
        const fullPath = join(dir, entry.name);
        const isDir = entry.isDirectory();
        if (entry.name.toLowerCase().includes(q)) {
          const rel = fullPath.slice(rootPath.length).replace(/^[\\/]+/, "").replace(/\\/g, "/");
          results.push({ name: entry.name, path: fullPath, relativePath: rel, isDir });
        }
        if (isDir) walk(fullPath);
      }
    };
    walk(rootPath);

    // 文件在前、目录在后，各自按相对路径排序
    results.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? 1 : -1;
      return a.relativePath.localeCompare(b.relativePath);
    });
    return results;
  }

  async readFileContent(
    filePath: string,
    cwd?: string,
  ): Promise<{ content: string; encoding: string; size: number }> {
    // 相对路径时基于 cwd（工作目录）解析，否则相对 server 进程 CWD 会找不到文件
    const resolvedPath =
      cwd && !require("path").isAbsolute(filePath)
        ? join(cwd, filePath)
        : filePath;
    if (!this.isSafePath(resolvedPath) || !existsSync(resolvedPath))
      return { content: "文件不存在", encoding: "utf8", size: 0 };
    const filePathFull = resolvedPath;
    try {
      const stat = statSync(filePathFull);
      if (stat.size > 1024 * 1024)
        return {
          content: "文件过大（>1MB），无法预览",
          encoding: "utf8",
          size: stat.size,
        };
      const buf = readFileSync(filePathFull);
      // 简单检测二进制：前 1KB 有 null byte 则视为二进制
      const sample = buf.slice(0, 1024);
      for (let i = 0; i < sample.length; i++) {
        if (sample[i] === 0)
          return { content: "", encoding: "binary", size: stat.size };
      }
      return {
        content: buf.toString("utf8"),
        encoding: "utf8",
        size: stat.size,
      };
    } catch (e: any) {
      return { content: `读取失败: ${e.message}`, encoding: "utf8", size: 0 };
    }
  }

  async readFileBase64(
    filePath: string,
  ): Promise<{ base64: string; mimeType: string; size: number } | null> {
    if (!this.isSafePath(filePath) || !existsSync(filePath)) return null;
    const BASE64_PREVIEW_MIME: Record<string, string> = {
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".gif": "image/gif",
      ".webp": "image/webp",
      ".bmp": "image/bmp",
      ".svg": "image/svg+xml",
      ".pdf": "application/pdf",
      ".docx":
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    };
    const ext = require("path").extname(filePath).toLowerCase();
    const mimeType = BASE64_PREVIEW_MIME[ext];
    if (!mimeType) return null;
    try {
      const stat = statSync(filePath);
      if (stat.size > 4 * 1024 * 1024) return null;
      const buf = readFileSync(filePath);
      return { base64: buf.toString("base64"), mimeType, size: stat.size };
    } catch {
      return null;
    }
  }

  detectCommands(cwd: string): DetectedCommand[] {
    const commands: DetectedCommand[] = [];
    const SKIP_DIRS = new Set([
      "node_modules",
      ".git",
      "dist",
      "build",
      ".next",
      "__pycache__",
      ".venv",
      "venv",
    ]);

    const findInDirAndSubs = (dir: string, filenames: string[]) => {
      const results: Array<{ file: string; subdir: string | null }> = [];
      for (const name of filenames) {
        if (existsSync(join(dir, name)))
          results.push({ file: name, subdir: null });
      }
      try {
        for (const entry of rdSync(dir, { withFileTypes: true })) {
          if (!entry.isDirectory() || SKIP_DIRS.has(entry.name)) continue;
          const sub = join(dir, entry.name);
          for (const name of filenames) {
            if (existsSync(join(sub, name)))
              results.push({ file: name, subdir: entry.name });
          }
        }
      } catch {
        /* skip */
      }
      return results;
    };

    const pkgPath = join(cwd, "package.json");
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
        const scripts = pkg.scripts ?? {};
        const preferred = ["dev", "start", "serve", "preview", "run"];
        const pm = existsSync(join(cwd, "pnpm-lock.yaml"))
          ? "pnpm"
          : existsSync(join(cwd, "yarn.lock"))
            ? "yarn"
            : "npm";
        for (const name of preferred) {
          if (scripts[name]) {
            commands.push({
              label: `${pm} run ${name}`,
              command: `${pm} run ${name}`,
            });
          }
        }
      } catch {
        /* skip */
      }
    }

    if (
      existsSync(join(cwd, "docker-compose.yml")) ||
      existsSync(join(cwd, "docker-compose.yaml"))
    ) {
      commands.push({
        label: "docker-compose up",
        command: "docker-compose up",
      });
    }
    if (existsSync(join(cwd, "Makefile"))) {
      commands.push({ label: "make", command: "make" });
    }
    for (const name of ["start.sh", "run.sh", "server.sh", "dev.sh"]) {
      if (existsSync(join(cwd, name))) {
        commands.push({ label: `bash ${name}`, command: `bash ${name}` });
        break;
      }
    }

    const pyEntries = findInDirAndSubs(cwd, [
      "app.py",
      "main.py",
      "manage.py",
      "server.py",
      "run.py",
    ]);
    for (const { file, subdir } of pyEntries) {
      const prefix = subdir ? `cd ${subdir} && ` : "";
      const label = subdir ? `python ${subdir}/${file}` : `python ${file}`;
      if (file === "manage.py") {
        commands.push({
          label: subdir
            ? `python ${subdir}/manage.py runserver`
            : "python manage.py runserver",
          command: `${prefix}python manage.py runserver`,
        });
      } else {
        commands.push({ label, command: `${prefix}python ${file}` });
      }
      break;
    }

    const goEntries = findInDirAndSubs(cwd, ["main.go", "go.mod"]);
    if (goEntries.length > 0) {
      const { subdir } = goEntries[0];
      const prefix = subdir ? `cd ${subdir} && ` : "";
      commands.push({
        label: subdir ? `go run ./${subdir}` : "go run .",
        command: `${prefix}go run .`,
      });
    }

    const rustEntries = findInDirAndSubs(cwd, ["Cargo.toml"]);
    if (rustEntries.length > 0) {
      const { subdir } = rustEntries[0];
      const prefix = subdir ? `cd ${subdir} && ` : "";
      commands.push({
        label: subdir ? `cargo run (${subdir})` : "cargo run",
        command: `${prefix}cargo run`,
      });
    }

    const mvnEntries = findInDirAndSubs(cwd, ["pom.xml"]);
    if (mvnEntries.length > 0) {
      const { subdir } = mvnEntries[0];
      const prefix = subdir ? `cd ${subdir} && ` : "";
      commands.push({
        label: subdir
          ? `mvn spring-boot:run (${subdir})`
          : "mvn spring-boot:run",
        command: `${prefix}mvn spring-boot:run`,
      });
    }

    const gradleEntries = findInDirAndSubs(cwd, [
      "build.gradle",
      "build.gradle.kts",
    ]);
    if (gradleEntries.length > 0) {
      const { subdir } = gradleEntries[0];
      const prefix = subdir ? `cd ${subdir} && ` : "";
      commands.push({
        label: subdir ? `gradle bootRun (${subdir})` : "gradle bootRun",
        command: `${prefix}gradle bootRun`,
      });
    }

    // 静态 HTML 项目：无其他框架时，检测 index.html 或根目录下的 .html 文件
    if (commands.length === 0) {
      const htmlEntry = join(cwd, "index.html");
      if (existsSync(htmlEntry)) {
        commands.push({
          label: "打开 index.html",
          command: `open:${htmlEntry}`,
        });
      } else {
        try {
          const htmlFiles = rdSync(cwd, { withFileTypes: true })
            .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".html"))
            .slice(0, 3);
          for (const f of htmlFiles) {
            const fullPath = join(cwd, f.name);
            commands.push({
              label: `打开 ${f.name}`,
              command: `open:${fullPath}`,
            });
          }
        } catch {
          /* skip */
        }
      }
    }

    return commands;
  }

  // 将本地目录打包成临时 zip，返回 zip 路径、目录名与基于目录名生成的 hash
  // 供「一键部署」从浏览器预览目录快速构建代码包使用
  // 打包时按 shouldSkipPackEntry 过滤依赖/构建产物/可执行文件/压缩包等干扰文件
  async packDir(
    dirPath: string,
  ): Promise<{ zipPath: string; dirName: string; hash: string; fileCount: number; skipped: number }> {
    if (!this.isSafePath(dirPath)) throw new Error("禁止访问该目录");
    if (!existsSync(dirPath) || !statSync(dirPath).isDirectory()) {
      throw new Error(`目录不存在: ${dirPath}`);
    }
    const dirName = basename(resolve(dirPath));
    const hash = createHash("sha256")
      .update(resolve(dirPath))
      .digest("hex")
      .slice(0, 12);

    const zip = new AdmZip();
    let fileCount = 0;
    let skipped = 0;
    const addDir = (cur: string, prefix: string) => {
      for (const entry of readdirSync(cur, { withFileTypes: true })) {
        const isDir = entry.isDirectory();
        if (shouldSkipPackEntry(entry.name, isDir)) {
          skipped++;
          continue;
        }
        const full = join(cur, entry.name);
        const zipPath = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (isDir) addDir(full, zipPath);
        else if (entry.isFile()) { zip.addFile(zipPath, readFileSync(full)); fileCount++; }
      }
    };
    addDir(dirPath, "");

    if (fileCount === 0) throw new Error("EMPTY_DIR:目录内没有可打包的文件（已全部被过滤）");

    const outDir = join(tmpdir(), "localclaw-deploy");
    if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
    const zipPath = join(outDir, `${dirName}-${hash}.zip`);
    zip.writeZip(zipPath);
    return { zipPath, dirName, hash, fileCount, skipped };
  }

  // 在系统文档目录(~/Documents，不存在则回退 ~)下创建空白项目文件夹。
  // 名字清洗非法字符；同名已存在时自动追加序号(name 2 / name 3 …)。
  createProjectInDocuments(rawName: string): { path: string; name: string } {
    const docs = join(homedir(), "Documents");
    const base = existsSync(docs) ? docs : homedir();
    let clean = (rawName || "").replace(/[/\\:*?"<>|\x00-\x1f]/g, "").trim();
    if (!clean) clean = "New project";
    clean = clean.slice(0, 60);

    let name = clean;
    let fullPath = join(base, name);
    let i = 2;
    while (existsSync(fullPath)) {
      name = `${clean} ${i}`;
      fullPath = join(base, name);
      i += 1;
    }
    if (!this.isSafePath(fullPath)) {
      throw new Error("Unsafe project path");
    }
    mkdirSync(fullPath, { recursive: true });
    return { path: fullPath, name };
  }

  async serveFile(filePath: string, res: any): Promise<void> {
    if (!this.isSafePath(filePath) || !existsSync(filePath)) {
      res.status(403).json({ error: "禁止访问" });
      return;
    }
    const stat = statSync(filePath);
    if (stat.size > 10 * 1024 * 1024) {
      res.status(413).json({ error: "文件过大" });
      return;
    }
    const ext = extname(filePath).toLowerCase();
    const MIME_MAP: Record<string, string> = {
      ".html": "text/html; charset=utf-8",
      ".htm": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "application/javascript; charset=utf-8",
      ".mjs": "application/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".gif": "image/gif",
      ".webp": "image/webp",
      ".svg": "image/svg+xml",
      ".ico": "image/x-icon",
      ".woff": "font/woff",
      ".woff2": "font/woff2",
      ".ttf": "font/ttf",
      ".eot": "application/vnd.ms-fontobject",
      ".pdf": "application/pdf",
      ".xml": "application/xml; charset=utf-8",
      ".txt": "text/plain; charset=utf-8",
      ".map": "application/json",
    };
    const mime = MIME_MAP[ext] || "application/octet-stream";
    const stream = createReadStream(filePath);
    res.setHeader("Content-Type", mime);
    res.setHeader("Content-Length", stat.size);
    res.setHeader("Cache-Control", "no-cache");
    stream.pipe(res);
  }
}
