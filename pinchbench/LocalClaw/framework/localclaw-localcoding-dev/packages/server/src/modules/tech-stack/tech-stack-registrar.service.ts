import { Injectable, OnModuleInit, Logger } from "@nestjs/common";
import { join } from "path";
import {
  existsSync,
  readFileSync,
  mkdirSync,
} from "fs";
import { atomicWriteFile, getAgentHomeDir } from "@lenovo/agent-sdk";
import { readTechStackConfig, type TechStackConfig } from "./tech-stack.config";

/**
 * 把 settings.json 的 techStack 配置渲染成 <agentHome>/CLAUDE.md 的标记块。
 * 复用 cron-registrar 的版本化标记块 + 幂等替换机制；与 cron-guard 用不同 marker，
 * 各自独立替换、互不破坏。enabled=false 时移除整个块。
 */
@Injectable()
export class TechStackRegistrarService implements OnModuleInit {
  private readonly logger = new Logger(TechStackRegistrarService.name);

  private static readonly VERSION = 1;
  private static readonly START = `<!-- local-claw:tech-stack:v${TechStackRegistrarService.VERSION} -->`;
  private static readonly END = "<!-- /local-claw:tech-stack -->";
  /** 匹配任意版本的起始标记，用于定位并替换旧版本块。 */
  private static readonly START_RE = /<!-- local-claw:tech-stack:v\d+ -->/;

  onModuleInit(): void {
    try {
      this.sync();
    } catch (e) {
      this.logger.error(`[tech-stack] sync failed: ${String(e)}`);
    }
  }

  /** 读取配置并幂等写入 CLAUDE.md。保存配置后也应调用此方法。 */
  sync(): void {
    const config = readTechStackConfig();
    const claudeDir = getAgentHomeDir();
    if (!existsSync(claudeDir)) mkdirSync(claudeDir, { recursive: true });
    const p = join(claudeDir, "CLAUDE.md");

    const existing = existsSync(p) ? readFileSync(p, "utf-8") : "";
    const next = config.enabled
      ? this.upsertBlock(existing, this.renderBlock(config, existing))
      : this.removeBlock(existing);

    if (next === existing) return;
    atomicWriteFile(p, next);
    this.logger.log(`[tech-stack] updated ${p} (enabled=${config.enabled})`);
  }

  /** 渲染标记块内容。nl 跟随现有文件的换行风格。 */
  private renderBlock(config: TechStackConfig, existing: string): string {
    const nl = existing.includes("\r\n") ? "\r\n" : "\n";
    const lines = [
      TechStackRegistrarService.START,
      "## 默认技术栈约束",
      "",
      "除非我在某条消息里明确指定其他技术栈，否则一律使用以下默认栈：",
      "",
      `- 语言：${config.language}`,
      `- 前端：${config.frontend}`,
      `- 后端：${config.backend}`,
      `- 数据库：${config.database}`,
      `- 包管理：${config.packageManager}`,
      `- 测试：${config.testing}`,
    ];
    for (const rule of config.customRules.split(/\r?\n/)) {
      const trimmed = rule.trim();
      if (trimmed) lines.push(`- ${trimmed}`);
    }
    lines.push(
      "",
      "优先级与覆盖规则：",
      "- 我若在某条消息里点名了别的语言/框架，该消息以我的指定为准，但不改变后续消息的默认栈。",
      "- 当前项目根目录的 CLAUDE.md 若与本节冲突，以项目级为准（项目约定优先于全局默认）。",
      "- 需要引入新依赖时先说明理由并等我确认，优先复用项目已有的库与约定。",
      TechStackRegistrarService.END,
    );
    return lines.join(nl);
  }

  /** 插入或替换标记块（保留块外的其它内容）。 */
  private upsertBlock(existing: string, body: string): string {
    const nl = existing.includes("\r\n") ? "\r\n" : "\n";
    const match = existing.match(TechStackRegistrarService.START_RE);
    if (!match) {
      return existing
        ? existing.replace(/\s+$/, "") + nl + nl + body + nl
        : body + nl;
    }
    const startIdx = match.index ?? 0;
    const endIdx = existing.indexOf(TechStackRegistrarService.END, startIdx);
    if (endIdx >= 0) {
      return (
        existing.slice(0, startIdx) +
        body +
        existing.slice(endIdx + TechStackRegistrarService.END.length)
      );
    }
    // 旧版无结束标记：从起始标记处截断重写。
    return existing.slice(0, startIdx).replace(/\s+$/, "") + nl + nl + body + nl;
  }

  /** 移除标记块（含其后多余空行）。 */
  private removeBlock(existing: string): string {
    const match = existing.match(TechStackRegistrarService.START_RE);
    if (!match) return existing;
    const startIdx = match.index ?? 0;
    const endIdx = existing.indexOf(TechStackRegistrarService.END, startIdx);
    const after =
      endIdx >= 0 ? existing.slice(endIdx + TechStackRegistrarService.END.length) : "";
    return (existing.slice(0, startIdx).replace(/\s+$/, "") + after.replace(/^\s+/, "\n")).replace(/\s+$/, "") + "\n";
  }
}
