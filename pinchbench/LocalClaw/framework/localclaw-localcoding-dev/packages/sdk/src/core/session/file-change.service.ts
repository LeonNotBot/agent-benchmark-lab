import { Injectable } from "@nestjs/common";
import { readFileSync, statSync, readdirSync } from "fs";
import { resolve, relative, join, extname, sep, dirname } from "path";
import type { ChangedFile, FileChangesResult } from "@lenovo/agent-protocol";

const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "build", ".next", "out",
  "__pycache__", ".cache", "coverage", ".turbo", ".vite",
]);
const MAX_FILES = 10000;
const MAX_DEPTH = 10;
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

type FileSnapshot = Map<string, number>; // path -> mtime

@Injectable()
export class FileChangeService {
  private snapshots = new Map<string, FileSnapshot>();

  takeSnapshot(sessionId: string, cwd: string): void {
    if (!cwd) return;
    const snapshot = this.scanDir(cwd, cwd, 0, { count: 0 });
    this.snapshots.set(sessionId, snapshot);
  }

  hasSnapshot(sessionId: string): boolean {
    return this.snapshots.has(sessionId);
  }

  getChangedFiles(sessionId: string, cwd: string): FileChangesResult {
    if (!cwd) return { files: [] };
    const before = this.snapshots.get(sessionId) ?? new Map<string, number>();
    const after = this.scanDir(cwd, cwd, 0, { count: 0 });
    const files: ChangedFile[] = [];

    // detect added and modified
    for (const [path, mtime] of after) {
      if (!before.has(path)) {
        files.push({ path, status: "added" });
      } else if (before.get(path) !== mtime) {
        files.push({ path, status: "modified" });
      }
    }

    // detect deleted
    for (const path of before.keys()) {
      if (!after.has(path)) {
        files.push({ path, status: "deleted" });
      }
    }

    files.sort((a, b) => a.path.localeCompare(b.path));
    return { files };
  }

  getFileContent(cwd: string, relPath: string): {
    content: string; encoding: "utf8" | "base64"; mimeType: string; tooLarge?: boolean;
  } {
    const resolved = resolve(cwd, relPath);
    const base = resolve(cwd);
    if (!resolved.startsWith(base + sep) && !resolved.startsWith(base + "/") && resolved !== base) {
      throw Object.assign(new Error("Forbidden"), { status: 403 });
    }
    let stat: ReturnType<typeof statSync>;
    try { stat = statSync(resolved); } catch {
      throw Object.assign(new Error("Not Found"), { status: 404 });
    }
    if (stat.size > MAX_FILE_SIZE) {
      const mimeType = getMimeType(resolved);
      return { content: "", encoding: "utf8", mimeType, tooLarge: true };
    }
    const mimeType = getMimeType(resolved);
    if (isBinary(resolved)) {
      const content = readFileSync(resolved).toString("base64");
      return { content, encoding: "base64", mimeType };
    }
    const content = readFileSync(resolved, "utf8");
    return { content, encoding: "utf8", mimeType };
  }

  getFilePath(cwd: string, relPath: string): string {
    const resolved = resolve(cwd, relPath);
    const base = resolve(cwd);
    if (!resolved.startsWith(base + sep) && !resolved.startsWith(base + "/") && resolved !== base) {
      throw Object.assign(new Error("Forbidden"), { status: 403 });
    }
    return resolved;
  }

  getInlinedHtmlContent(cwd: string, absPath: string): string {
    const html = readFileSync(absPath, "utf8");
    const dir = dirname(absPath);
    const base = resolve(cwd);

    const safeRead = (href: string): string | null => {
      if (/^(https?:)?\/\/|^data:/.test(href)) return null;
      try {
        const full = resolve(dir, href);
        if (!full.startsWith(base + sep) && !full.startsWith(base + "/") && full !== base) return null;
        return readFileSync(full, "utf8");
      } catch { return null; }
    };

    // Inline CSS: <link rel="stylesheet" href="..."> or <link href="..." rel="stylesheet">
    let result = html.replace(/<link\b([^>]*)>/gi, (match, attrs: string) => {
      if (!/rel=["']stylesheet["']/i.test(attrs)) return match;
      const m = /href=["']([^"']+)["']/i.exec(attrs);
      if (!m) return match;
      const content = safeRead(m[1]);
      return content !== null ? `<style>${content}</style>` : match;
    });

    // Inline JS: <script src="..."></script>
    result = result.replace(/<script\b([^>]*)><\/script>/gi, (match, attrs: string) => {
      const m = /src=["']([^"']+)["']/i.exec(attrs);
      if (!m) return match;
      const content = safeRead(m[1]);
      return content !== null ? `<script>${content}</script>` : match;
    });

    return result;
  }

  private scanDir(base: string, dir: string, depth: number, counter: { count: number }): FileSnapshot {
    const snap: FileSnapshot = new Map();
    if (depth > MAX_DEPTH || counter.count >= MAX_FILES) return snap;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let entries: any[];
    try { entries = readdirSync(dir, { withFileTypes: true }) as any[]; } catch { return snap; }
    for (const entry of entries) {
      if (counter.count >= MAX_FILES) break;
      const full = join(dir, String(entry.name));
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(String(entry.name)) || String(entry.name).startsWith(".")) continue;
        const sub = this.scanDir(base, full, depth + 1, counter);
        for (const [p, m] of sub) snap.set(p, m);
      } else if (entry.isFile()) {
        try {
          const mtime = statSync(full).mtimeMs;
          snap.set(relative(base, full), mtime);
          counter.count++;
        } catch { /* skip */ }
      }
    }
    return snap;
  }
}

function getMimeType(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  const map: Record<string, string> = {
    ".html": "text/html", ".htm": "text/html",
    ".pdf": "application/pdf",
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".gif": "image/gif", ".svg": "image/svg+xml", ".webp": "image/webp",
    ".bmp": "image/bmp", ".ico": "image/x-icon",
    ".ts": "text/plain", ".tsx": "text/plain", ".js": "text/plain",
    ".jsx": "text/plain", ".json": "application/json",
    ".md": "text/markdown", ".txt": "text/plain", ".css": "text/css",
    ".py": "text/plain", ".go": "text/plain", ".rs": "text/plain",
    ".java": "text/plain", ".sh": "text/plain", ".yaml": "text/plain",
    ".yml": "text/plain", ".toml": "text/plain", ".xml": "text/xml",
  };
  return map[ext] ?? "text/plain";
}

function isBinary(filePath: string): boolean {
  const ext = extname(filePath).toLowerCase();
  return [".pdf", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".ico", ".zip",
    ".tar", ".gz", ".wasm", ".ttf", ".woff", ".woff2"].includes(ext);
}
