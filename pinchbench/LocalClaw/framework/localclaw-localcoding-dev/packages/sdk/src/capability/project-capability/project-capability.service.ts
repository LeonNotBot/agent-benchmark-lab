import { Injectable } from "@nestjs/common";
import { existsSync } from "fs";
import { isAbsolute, join } from "path";
import type {
  ProjectCapabilities,
  ProjectCommand,
  ProjectAgent,
  ProjectRule,
  ProjectMemory,
  SkillMeta,
} from "@lenovo/agent-protocol";
import {
  parseFrontmatter,
  scanCommands,
  scanAgents,
  scanSkills,
  scanRules,
  scanMemories,
} from "./project-capability.scanners";

/** 单条缓存记录。 */
type CacheEntry = { at: number; data: ProjectCapabilities };

/** 空结果（cwd 非法或无 .claude 时返回，UI 据此隐藏徽章）。 */
function emptyCaps(cwd: string): ProjectCapabilities {
  return { cwd, commands: [], agents: [], skills: [], rules: [], memories: [] };
}

/**
 * 项目能力扫描服务（SDK，@public）。
 *
 * 扫描 `<cwd>/.claude/` 下的五类资源（命令/子代理/技能/规则/知识库），产出只读聚合，
 * 供宿主 UI 可视化与斜杠补全。纯读、产品无关——三个产品共用。
 *
 * 逻辑对标 claude-cli 的 .claude 目录约定，不含任何项目特例。结果按 cwd 缓存
 * 短时（CACHE_TTL_MS），避免频繁展开/折叠时重复磁盘扫描。
 */
@Injectable()
export class ProjectCapabilityService {
  private static readonly CACHE_TTL_MS = 5000;
  private readonly cache = new Map<string, CacheEntry>();

  /** 扫描项目 .claude/ 能力。cwd 须为存在的绝对路径，否则返回空结果。 */
  scan(cwd: string): ProjectCapabilities {
    if (!cwd || !isAbsolute(cwd) || !existsSync(cwd)) return emptyCaps(cwd);

    const now = Date.now();
    const hit = this.cache.get(cwd);
    if (hit && now - hit.at < ProjectCapabilityService.CACHE_TTL_MS) {
      return hit.data;
    }

    const claudeDir = join(cwd, ".claude");
    const data: ProjectCapabilities = existsSync(claudeDir)
      ? {
          cwd,
          commands: this.scanCommands(join(claudeDir, "commands")),
          agents: this.scanAgents(join(claudeDir, "agents")),
          skills: this.scanSkills(join(claudeDir, "skills")),
          rules: this.scanRules(join(claudeDir, "rules")),
          memories: this.scanMemories(join(claudeDir, "memories")),
        }
      : emptyCaps(cwd);

    this.cache.set(cwd, { at: now, data });
    return data;
  }

  // ── 私有扫描方法（分文件补充，见 project-capability.scanners.ts 合并进本类）──

  private scanCommands(dir: string): ProjectCommand[] {
    return scanCommands(dir, (raw) => this.parseFrontmatter(raw));
  }
  private scanAgents(dir: string): ProjectAgent[] {
    return scanAgents(dir, (raw) => this.parseFrontmatter(raw));
  }
  private scanSkills(dir: string): SkillMeta[] {
    return scanSkills(dir, (raw) => this.parseFrontmatter(raw));
  }
  private scanRules(dir: string): ProjectRule[] {
    return scanRules(dir);
  }
  private scanMemories(dir: string): ProjectMemory[] {
    return scanMemories(dir);
  }

  /**
   * 解析 Markdown frontmatter（--- 块）。轻量实现，与 SkillService 同构：
   * 支持 \r\n / \n、内联数组 [a, b]、布尔字面量。
   */
  private parseFrontmatter(raw: string): {
    meta: Record<string, unknown>;
    content: string;
  } {
    return parseFrontmatter(raw);
  }
}
