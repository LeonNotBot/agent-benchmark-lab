import { Injectable } from "@nestjs/common";
import { join } from "path";
import { existsSync, readdirSync, readFileSync } from "fs";
import { getProjectsDir } from "@lenovo/agent-sdk";

export interface MemoryFile {
  fileName: string;
  projectDir: string;
  name: string;
  description: string;
  type: string;
  content: string;
}

@Injectable()
export class MemoryService {
  private get projectsDir(): string {
    return getProjectsDir();
  }

  private parseFrontmatter(raw: string) {
    const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
    if (!match) return { meta: {} as Record<string, unknown>, content: raw };
    const meta: Record<string, unknown> = {};
    for (const line of match[1].split(/\r?\n/)) {
      const idx = line.indexOf(":");
      if (idx < 0) continue;
      const key = line.slice(0, idx).trim();
      const val = line.slice(idx + 1).trim();
      meta[key] = val;
    }
    return { meta, content: match[2] };
  }

  listMemoryFiles(): MemoryFile[] {
    if (!existsSync(this.projectsDir)) return [];
    const results: MemoryFile[] = [];
    for (const entry of readdirSync(this.projectsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const memDir = join(this.projectsDir, entry.name, "memory");
      if (!existsSync(memDir)) continue;
      for (const file of readdirSync(memDir)) {
        if (!file.endsWith(".md")) continue;
        try {
          const raw = readFileSync(join(memDir, file), "utf-8");
          const { meta, content } = this.parseFrontmatter(raw);
          results.push({
            fileName: file,
            projectDir: entry.name,
            name: (meta.name as string) || file,
            description: (meta.description as string) || "",
            type: (meta.type as string) || "reference",
            content: content.trim(),
          });
        } catch {
          // skip unreadable files
        }
      }
    }
    return results;
  }
}
