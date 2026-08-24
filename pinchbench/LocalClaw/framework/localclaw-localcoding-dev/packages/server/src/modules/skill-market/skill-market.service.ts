import { Injectable, Inject } from "@nestjs/common";
import { join } from "path";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import type { MarketSkill, MarketSource } from "@lenovo/agent-protocol";
import { getAgentHomeDir } from "@lenovo/agent-sdk";
import { SkillService } from "../skill/skill.service";

type SkillEntry = {
  name: string;
  displayName: string;
  description: string;
  author?: string;
  version?: string;
  tags?: string[];
  path: string;
  downloads?: number;
};

type RegistryData = {
  version: number;
  skills: SkillEntry[];
};

const DEFAULT_SOURCE: MarketSource = {
  id: "official",
  name: "Local Claw Official",
  url: "https://github.com/affaan-m/ECC",
  type: "github",
  skillCount: 0,
};

const CACHE_TTL = 30 * 60 * 1000; // 30 分钟
const FETCH_TIMEOUT = 8000; // 单次请求 8s 超时
const CONCURRENCY = 40; // raw 文件并发数

type CacheEntry = { data: RegistryData; ts: number };

/** 安装结果类型（移到 class 外以避免 TS 解析错误） */
type InstallResult =
  | { ok: true; skill: import("@lenovo/agent-protocol").SkillMeta }
  | { ok: false; reason: "source_not_found" | "registry_empty" | "skill_not_found" | "download_failed" | "validation_failed"; detail?: string };

@Injectable()
export class SkillMarketService {
  private cache = new Map<string, CacheEntry>();
  private inflight = new Map<string, Promise<RegistryData | null>>();
  private sources: MarketSource[] = [DEFAULT_SOURCE];

  constructor(
    @Inject(SkillService) private readonly skillService: SkillService,
  ) {
    this.loadSources();
    this.loadCacheFromDisk();
    // 后台预热官方源，避免首屏等待全量拉取
    void this.warmup();
  }

  private get cacheDir(): string {
    const dir = join(getAgentHomeDir(), "local-claw", "market-cache");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    return dir;
  }

  private cacheFile(sourceId: string): string {
    return join(this.cacheDir, `${sourceId.replace(/[^\w-]/g, "_")}.json`);
  }

  private loadCacheFromDisk(): void {
    for (const source of this.sources) {
      try {
        const file = this.cacheFile(source.id);
        if (!existsSync(file)) continue;
        const entry = JSON.parse(readFileSync(file, "utf-8")) as CacheEntry;
        if (entry?.data?.skills) {
          this.cache.set(source.id, entry);
          source.skillCount = entry.data.skills.length;
          source.lastSync = entry.ts;
        }
      } catch { /* ignore corrupt cache */ }
    }
  }

  private persistCache(sourceId: string, entry: CacheEntry): void {
    try {
      writeFileSync(this.cacheFile(sourceId), JSON.stringify(entry), "utf-8");
    } catch { /* best-effort */ }
  }

  /** 后台预热：仅在缓存缺失或过期时拉取，不阻塞构造 */
  private async warmup(): Promise<void> {
    await Promise.all(
      this.sources.map(async (s) => {
        const cached = this.cache.get(s.id);
        if (cached && Date.now() - cached.ts < CACHE_TTL) return;
        try { await this.fetchSkillList(s.id); } catch { /* ignore */ }
      }),
    );
  }

  /** 带超时的 fetch */
  private async fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT);
    try {
      return await fetch(url, {
        ...init,
        signal: ctrl.signal,
        headers: { "User-Agent": "local-claw", ...(init?.headers ?? {}) },
      });
    } finally {
      clearTimeout(timer);
    }
  }

  private get configPath(): string {
    const dir = join(getAgentHomeDir(), "local-claw");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    return join(dir, "market-sources.json");
  }

  private loadSources(): void {
    try {
      if (existsSync(this.configPath)) {
        const data = JSON.parse(readFileSync(this.configPath, "utf-8"));
        if (Array.isArray(data)) this.sources = [DEFAULT_SOURCE, ...data];
      }
    } catch { /* use defaults */ }
  }

  private saveSources(): void {
    const custom = this.sources.filter(s => s.id !== "official");
    writeFileSync(this.configPath, JSON.stringify(custom, null, 2), "utf-8");
  }

  /** 获取市场源列表 */
  getSources(): MarketSource[] {
    return this.sources;
  }

  /** 添加市场源 */
  addSource(name: string, url: string): MarketSource {
    const id = `custom-${Date.now()}`;
    const source: MarketSource = {
      id, name, url,
      type: url.includes("github") ? "github" : "custom",
      skillCount: 0,
    };
    this.sources.push(source);
    this.saveSources();
    return source;
  }

  /** 删除市场源 */
  removeSource(id: string): boolean {
    if (id === "official") return false;
    const before = this.sources.length;
    this.sources = this.sources.filter(s => s.id !== id);
    if (this.sources.length < before) {
      this.saveSources();
      return true;
    }
    return false;
  }

  /** 从远程获取技能列表（支持 registry 和 github 两种模式） */
  async fetchSkillList(sourceId: string, force = false): Promise<RegistryData | null> {
    const source = this.sources.find(s => s.id === sourceId);
    if (!source) return null;
    const cached = this.cache.get(sourceId);
    if (!force && cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;

    // 同一源的并发请求去重，避免多个调用方各拉一次全量
    const existing = this.inflight.get(sourceId);
    if (existing) return existing;

    const task = (async (): Promise<RegistryData | null> => {
      try {
        const data = source.type === "github"
          ? await this.fetchFromGitHub(source)
          : await this.fetchFromRegistry(source);
        if (!data || data.skills.length === 0) {
          // 拉取失败/为空时回退到陈旧缓存，避免前端「暂无技能」
          return cached?.data ?? null;
        }
        const entry: CacheEntry = { data, ts: Date.now() };
        this.cache.set(sourceId, entry);
        this.persistCache(sourceId, entry);
        source.skillCount = data.skills.length;
        source.lastSync = entry.ts;
        return data;
      } catch {
        return cached?.data ?? null;
      } finally {
        this.inflight.delete(sourceId);
      }
    })();
    this.inflight.set(sourceId, task);
    return task;
  }

  /** GitHub 模式：用 git-tree 一次拉全部路径，再并发抓 SKILL.md */
  private async fetchFromGitHub(source: MarketSource): Promise<RegistryData | null> {
    const match = source.url.match(/github\.com\/([^/]+)\/([^/]+)/);
    if (!match) return null;
    const [, owner, repo] = match;
    const branch = source.skillsPath || "main";

    // 一次性获取整棵树，定位 skills/<name>/SKILL.md
    const treeUrl = `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`;
    const treeRes = await this.fetchWithTimeout(treeUrl, {
      headers: { "Accept": "application/vnd.github.v3+json" },
    });
    if (!treeRes.ok) return null;
    const tree = (await treeRes.json()) as {
      tree?: Array<{ path: string; type: string }>;
    };
    const skillFiles = (tree.tree ?? []).filter(
      n => n.type === "blob" && /^skills\/[^/]+\/SKILL\.md$/.test(n.path),
    );
    if (skillFiles.length === 0) return null;

    // 并发抓取 SKILL.md（限制并发数，带超时；单个失败不影响整体）
    const skills: SkillEntry[] = [];
    let cursor = 0;
    const worker = async () => {
      while (cursor < skillFiles.length) {
        const idx = cursor++;
        const file = skillFiles[idx];
        const dir = file.path.replace(/\/SKILL\.md$/, "");
        const name = dir.split("/")[1];
        try {
          const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${file.path}`;
          const r = await this.fetchWithTimeout(rawUrl);
          if (!r.ok) continue;
          const content = await r.text();
          const entry = this.parseSkillMd(name, dir, content);
          if (entry) skills.push(entry);
        } catch { /* 跳过单个失败 */ }
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, skillFiles.length) }, () => worker()),
    );
    return { version: 1, skills };
  }

  /** 解析 SKILL.md frontmatter */
  private parseSkillMd(name: string, path: string, content: string): SkillEntry | null {
    const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
    if (!fmMatch) return { name, displayName: name, description: "", path };
    const fm = fmMatch[1];
    const get = (key: string) => {
      const m = fm.match(new RegExp(`^${key}:\\s*(.+)$`, "m"));
      return m ? m[1].trim().replace(/^["']|["']$/g, "") : "";
    };
    return {
      name,
      displayName: get("name") || name,
      description: get("description"),
      author: get("author") || get("origin") || undefined,
      version: get("version") || undefined,
      path,
    };
  }

  /** registry.json 模式 */
  private async fetchFromRegistry(source: MarketSource): Promise<RegistryData | null> {
    const url = `${source.url}/registry.json`;
    const res = await this.fetchWithTimeout(url);
    if (!res.ok) return null;
    return (await res.json()) as RegistryData;
  }

  /** 搜索市场 skill（并行获取所有源） */
  async searchSkills(query?: string, tag?: string): Promise<MarketSkill[]> {
    const installed = new Set(this.skillService.listSkills().map(s => s.name));
    // 并行获取所有源的注册表数据
    const registries = await Promise.all(
      this.sources.map(source => this.fetchSkillList(source.id))
    );
    const results: MarketSkill[] = [];
    for (const registry of registries) {
      if (!registry) continue;
      for (const skill of registry.skills) {
        if (query) {
          const q = query.toLowerCase();
          const match = skill.name.toLowerCase().includes(q)
            || skill.displayName.toLowerCase().includes(q)
            || skill.description.toLowerCase().includes(q);
          if (!match) continue;
        }
        if (tag && !(skill.tags ?? []).includes(tag)) continue;
        results.push({
          ...skill,
          installed: installed.has(skill.name),
        });
      }
    }
    return results;
  }

  /** 从市场安装 skill（返回明确的成功/失败原因） */
  async installSkill(sourceId: string, name: string): Promise<InstallResult> {
    const source = this.sources.find(s => s.id === sourceId);
    if (!source) return { ok: false, reason: "source_not_found" };
    const registry = await this.fetchSkillList(sourceId);
    if (!registry) return { ok: false, reason: "registry_empty" };
    const entry = registry.skills.find(s => s.name === name);
    if (!entry) return { ok: false, reason: "skill_not_found" };
    try {
      const match = source.url.match(/github\.com\/([^/]+)\/([^/]+)/);
      const branch = source.skillsPath || "main";
      let url: string;
      if (source.type === "github" && match) {
        url = `https://raw.githubusercontent.com/${match[1]}/${match[2]}/${branch}/${entry.path}/SKILL.md`;
      } else {
        url = `${source.url}/${entry.path}/SKILL.md`;
      }
      const res = await this.fetchWithTimeout(url);
      if (!res.ok) return { ok: false, reason: "download_failed", detail: `HTTP ${res.status}` };
      const content = await res.text();
      const skill = this.skillService.installFromRaw(name, content);
      return { ok: true, skill };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("description") || msg.includes("Prompt 内容")) {
        return { ok: false, reason: "validation_failed", detail: msg };
      }
      return { ok: false, reason: "download_failed", detail: msg };
    }
  }

  /** 刷新所有缓存 */
  async refreshAll(): Promise<void> {
    await Promise.all(this.sources.map(s => this.fetchSkillList(s.id, true)));
  }
}
