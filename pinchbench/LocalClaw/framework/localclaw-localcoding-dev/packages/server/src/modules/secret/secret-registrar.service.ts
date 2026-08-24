import { Injectable, OnModuleInit, Logger } from "@nestjs/common";
import { join, resolve } from "path";
import { existsSync, readFileSync, mkdirSync } from "fs";
import { spawn } from "child_process";
import {
  atomicWriteFile,
  getAgentHomeDir,
  getSecretsPath,
  readClaudeConfigJson,
  writeClaudeConfigJson,
} from "@lenovo/agent-sdk";
import { readSecretDefConfig } from "./secret-config";

/**
 * 隐私管理的运行时注册器，做两件事：
 *
 * 1. 把 secret-tools MCP server 注册到 .claude.json（CLI 真正读取的 MCP 配置），
 *    给模型 secret_save / secret_list / secret_delete 结构化工具。
 *    动机：Windows 上 Bash+curl 调本地 API 极不可靠（PowerShell 别名、多层 shell
 *    引号转义），与定时任务同源，故同样改用 MCP 工具。
 *
 * 2. 把隐私管理使用约定写进 <agentHome>/CLAUDE.md 标记块（常驻模型上下文），
 *    告知 agent 遇到密钥时应主动用 secret_save 工具存储、不要拒绝、不要用 curl。
 *
 * MCP 路径解析 / asar 归一化 / node 命令选择，均复用 cron-mcp-registrar 的成熟逻辑。
 */
@Injectable()
export class SecretRegistrarService implements OnModuleInit {
  private readonly logger = new Logger(SecretRegistrarService.name);

  private static readonly VERSION = 4;
  private static readonly START = `<!-- local-claw:secrets:v${SecretRegistrarService.VERSION} -->`;
  private static readonly END = "<!-- /local-claw:secrets -->";
  private static readonly START_RE = /<!-- local-claw:secrets:v\d+ -->/;

  onModuleInit(): void {
    try {
      this.syncToClaudeConfig();
      this.syncClaudeMd();
    } catch (e) {
      this.logger.error(`[secrets] sync failed: ${String(e)}`);
    }
    this.smokeTest().catch((e) =>
      this.logger.warn(`[secrets] smoke test failed: ${String(e)}`),
    );
  }

  // ─── asar 路径归一化（同 cron-registrar，详见其文档）───
  private toUnpacked(p: string): string {
    if (!p.includes("app.asar") || p.includes("app.asar.unpacked")) return p;
    return p.replace(/([\\/])app\.asar([\\/])/, "$1app.asar.unpacked$2");
  }

  private getMcpServerScriptPath(): string {
    const fileName = "secret-tools.mjs";
    const candidates = [
      resolve(__dirname, "mcp-servers", fileName),
      resolve(__dirname, "..", "mcp-servers", fileName),
      resolve(__dirname, "..", "..", "mcp-servers", fileName),
    ].map((p) => this.toUnpacked(p));
    const hit = candidates.find((p) => existsSync(p));
    if (!hit) {
      this.logger.error(
        `[secrets] secret-tools.mjs 未找到，已探测: ${candidates.join(" | ")}`,
      );
    }
    return hit || candidates[0];
  }

  private getNodeModulesPath(): string {
    try {
      const pkgJson = require.resolve("@modelcontextprotocol/sdk/package.json");
      const nm = resolve(pkgJson, "..", "..", "..");
      const unpacked = this.toUnpacked(nm);
      if (existsSync(join(unpacked, "@modelcontextprotocol"))) return unpacked;
    } catch {
      /* 解析失败，回落候选探测 */
    }
    const candidates = [
      resolve(__dirname, "node_modules"),
      resolve(__dirname, "..", "packages", "server", "node_modules"),
      resolve(__dirname, "..", "..", "..", "node_modules"),
      resolve(__dirname, "..", "..", "node_modules"),
      resolve(__dirname, "..", "node_modules"),
      resolve(__dirname, "..", "..", "packages", "server", "node_modules"),
    ].map((p) => this.toUnpacked(p));
    const hit = candidates.find((p) => existsSync(join(p, "@modelcontextprotocol")));
    if (!hit) {
      this.logger.error(
        `[secrets] @modelcontextprotocol/sdk 所在 node_modules 未找到，已探测: ${candidates.join(" | ")}`,
      );
    }
    return hit || candidates[0];
  }

  private getNodeCommand(): { command: string; envExtras: Record<string, string> } {
    const exec = process.execPath || "node";
    const isElectron =
      exec.toLowerCase().includes("electron") || exec.toLowerCase().endsWith("local claw.exe");
    if (isElectron) {
      return { command: exec, envExtras: { ELECTRON_RUN_AS_NODE: "1" } };
    }
    return { command: exec, envExtras: {} };
  }

  // ─── .claude.json registration ───
  private syncToClaudeConfig(): void {
    const config = readClaudeConfigJson();
    const servers = (config.mcpServers ?? {}) as Record<string, unknown>;
    const { command, envExtras } = this.getNodeCommand();
    servers["secret-tools"] = {
      command,
      args: [this.getMcpServerScriptPath()],
      env: {
        SECRET_API_BASE: `http://127.0.0.1:${process.env.PORT ?? 10086}`,
        MCP_SDK_DIR: this.getNodeModulesPath(),
        ...envExtras,
      },
    };
    config.mcpServers = servers;
    writeClaudeConfigJson(config);
    this.logger.log("[secrets] synced secret-tools to .claude.json");
  }

  // ─── CLAUDE.md guidance block ───
  /** 重新渲染并幂等写入 CLAUDE.md 的隐私管理块。保存配置后由 controller 调用。 */
  syncClaudeMd(): void {
    const claudeDir = getAgentHomeDir();
    if (!existsSync(claudeDir)) mkdirSync(claudeDir, { recursive: true });
    const p = join(claudeDir, "CLAUDE.md");

    const existing = existsSync(p) ? readFileSync(p, "utf-8") : "";
    const next = this.upsertBlock(existing, this.renderBlock(existing));

    if (next === existing) return;
    atomicWriteFile(p, next);
    this.logger.log(`[secrets] updated ${p} (marker v${SecretRegistrarService.VERSION})`);
  }

  private renderBlock(existing: string): string {
    const nl = existing.includes("\r\n") ? "\r\n" : "\n";
    const secretsPath = getSecretsPath();
    const def = readSecretDefConfig();

    const lines: string[] = [
      SecretRegistrarService.START,
      "## 隐私信息管理（重要）",
      "",
      "本应用内置「隐私管理」：一个**仅存于本机磁盘、永不上传任何服务器**的本地隐私保险箱，",
      "用于保存各类敏感凭据与个人身份信息（PII）。",
      `存储文件位于 \`${secretsPath}\`，用户可在侧边栏「隐私管理」面板中查看/编辑/删除。`,
      "",
      "**当用户在消息中提供以下任意一类信息时，你必须用 MCP 工具 `secret_save` 存入隐私管理：**",
      "",
    ];

    // ── 可配置段：隐私类别（来自 settings.json 的 secretDef，用户可在面板编辑）──
    for (const cat of def.categories) {
      lines.push(`- **${cat.label}**：${cat.examples}`);
    }
    if (def.triggerPhrases.trim()) {
      lines.push("", `触发口语：${def.triggerPhrases.trim()}`);
    }
    if (def.extraRules.trim()) {
      lines.push("", "补充规则：");
      for (const rule of def.extraRules.split(/\r?\n/)) {
        if (rule.trim()) lines.push(`- ${rule.trim()}`);
      }
    }

    // ── 固定段：执行机制（写死，不可配置）──
    lines.push(
      "",
      "**强制规则：**",
      "1. 统一使用 MCP 工具 `secret_save` / `secret_list` / `secret_delete`。",
      "2. **禁止使用 Bash + curl 调用 REST**，**禁止写任何 .json 临时文件**，**禁止直接改 secrets.json**。",
      "   （Windows 上 curl 内联 JSON 的引号转义极不可靠，必然反复失败。）",
      "3. `secret_save` 参数：`key`（用大写下划线命名，如 `ANTHROPIC_AUTH_TOKEN`、`ID_CARD_NUMBER`、`BANK_CARD`、`PHONE_NUMBER`）、`value`（信息原文）、`description`（用途/归属，如「本人身份证号」）。同名 key 会更新。",
      "4. 一次有多个密钥就多次调用 `secret_save`，每条一次。",
      "",
      "**关于安全**：把敏感信息存进隐私管理是**比写进 `.env`、文档或聊天记录更安全**的做法（隐藏显示、本地隔离、不进 git）。",
      "因此遇到密钥或个人隐私信息时**不要拒绝**、也不要只建议用户自己存别处——直接用 `secret_save` 存好，",
      "然后告诉用户：已存入隐私管理、存储路径、可在侧边栏面板管理。",
      "",
      "**回显约束**：确认存储后，后续提及该信息只用名称（如「你的 ANTHROPIC_AUTH_TOKEN」「你的身份证号」），不要在回复里重复完整的密钥值或证件/卡号原文。",
      SecretRegistrarService.END,
    );
    return lines.join(nl);
  }

  private upsertBlock(existing: string, body: string): string {
    const nl = existing.includes("\r\n") ? "\r\n" : "\n";
    const match = existing.match(SecretRegistrarService.START_RE);
    if (!match) {
      return existing ? existing.replace(/\s+$/, "") + nl + nl + body + nl : body + nl;
    }
    const startIdx = match.index ?? 0;
    const endIdx = existing.indexOf(SecretRegistrarService.END, startIdx);
    if (endIdx >= 0) {
      return (
        existing.slice(0, startIdx) +
        body +
        existing.slice(endIdx + SecretRegistrarService.END.length)
      );
    }
    return existing.slice(0, startIdx).replace(/\s+$/, "") + nl + nl + body + nl;
  }

  // ─── smoke test：spawn MCP 子进程确认能起来（路径/ESM 解析正确）───
  private smokeTest(): Promise<void> {
    return new Promise((res) => {
      const { command, envExtras } = this.getNodeCommand();
      const child = spawn(command, [this.getMcpServerScriptPath()], {
        stdio: ["pipe", "ignore", "pipe"],
        env: {
          ...process.env,
          SECRET_API_BASE: `http://127.0.0.1:${process.env.PORT ?? 10086}`,
          MCP_SDK_DIR: this.getNodeModulesPath(),
          ...envExtras,
        },
      });
      let stderr = "";
      child.stderr?.on("data", (d) => {
        stderr += String(d);
      });
      child.on("error", (e) => {
        this.logger.error(`[secrets] smoke spawn error: ${String(e)}`);
        res();
      });
      child.on("exit", (code) => {
        if (code !== 0 && code !== null) {
          this.logger.error(
            `[secrets] smoke exited ${code}; secret MCP 可能未生效; stderr:\n${stderr.slice(0, 500)}`,
          );
        }
        res();
      });
      setTimeout(() => {
        try {
          child.stdin?.end();
          child.kill();
        } catch {
          /* ignore */
        }
      }, 100);
    });
  }
}
