import { Injectable, OnModuleInit, Logger } from "@nestjs/common";
import { join, resolve } from "path";
import {
  existsSync,
  readFileSync,
  mkdirSync,
} from "fs";
import { spawn } from "child_process";
import {
  readAgentSettings as readLocalClawSettings,
  writeAgentSettings as writeLocalClawSettings,
} from "../../config/agent-settings";
import {
  readClaudeConfigJson,
  writeClaudeConfigJson,
} from "../../config/claude-config-json";
import { atomicWriteFile } from "../../util/atomic-write";
import { isElectronExecutable } from "../../util/electron-exec";
import { getAgentHomeDir } from "../../config/paths";

/**
 * 把 asar 内路径归一化为 asar.unpacked 路径（模块级纯函数，便于单测）。
 *
 * electron-builder 把 dist-server/** 打进 app.asar，但 mcp-servers/ 与
 * node_modules/ 在 asarUnpack 列表里、实体被移到 app.asar.unpacked/。
 * 关键陷阱：Electron 给 fs 打了 asar patch，existsSync(asar 内路径) 仍返回 true，
 * 故原 existsSync 探测"看起来命中"asar 路径并写进 .claude.json；但 cron-tools.mjs
 * 是用 node(ELECTRON_RUN_AS_NODE) spawn 的独立子进程、走原生 ESM loader——
 * ESM import 不认 asar 虚拟路径，于是 import SDK 失败、MCP 子进程当场死，
 * CLI 静默丢弃该 server（开发机无 asar 故不复现）。
 * 因此必须无条件把 app.asar 段重写为 app.asar.unpacked，使写盘路径指向磁盘实体。
 * 非打包场景（路径不含 app.asar）为 no-op，行为不变。
 *
 * @internal 导出仅供单测；非公共契约。
 */
export function normalizeAsarPath(p: string): string {
  if (!p.includes("app.asar") || p.includes("app.asar.unpacked")) return p;
  return p.replace(/([\\/])app\.asar([\\/])/, "$1app.asar.unpacked$2");
}

/** @internal 定时任务的 cron MCP 注册器，非公共契约。 */
@Injectable()
export class CronMcpRegistrarService implements OnModuleInit {
  private readonly logger = new Logger(CronMcpRegistrarService.name);

  onModuleInit(): void {
    try {
      this.syncToClaudeConfig();
      this.appendCronGuardToUserClaudeMd();
    } catch (e) {
      this.logger.error(`[cron-registrar] sync failed: ${String(e)}`);
    }
    this.smokeTest().catch((e) =>
      this.logger.warn(`[cron-registrar] smoke test failed: ${String(e)}`),
    );
  }

  /**
   * 把 asar 内路径归一化为 asar.unpacked 路径。委托模块级 {@link normalizeAsarPath}，
   * 详见其文档。
   */
  private toUnpacked(p: string): string {
    return normalizeAsarPath(p);
  }

  private getMcpServerScriptPath(): string {
    const fileName = "cron-tools.mjs";
    const candidates = [
      resolve(__dirname, "mcp-servers", fileName),
      resolve(__dirname, "..", "mcp-servers", fileName),
      resolve(__dirname, "..", "..", "mcp-servers", fileName),
    ].map((p) => this.toUnpacked(p));
    const hit = candidates.find((p) => existsSync(p));
    if (!hit) {
      this.logger.error(
        `[cron-registrar] cron-tools.mjs 未找到，已探测: ${candidates.join(" | ")}`,
      );
    }
    return hit || candidates[0];
  }

  private getNodeModulesPath(): string {
    // 优先：从 @modelcontextprotocol/sdk 的 package.json 反推确定的 node_modules 根。
    // require.resolve 走 CJS 解析（server.cjs 是 bundle 后的 CJS），命中即为磁盘真实路径，
    // 不依赖 __dirname 相对布局的猜测。失败再回落到候选探测。
    try {
      const pkgJson = require.resolve("@modelcontextprotocol/sdk/package.json");
      // pkgJson = <nm>/@modelcontextprotocol/sdk/package.json → 上溯三级取 <nm>
      const nm = resolve(pkgJson, "..", "..", "..");
      const unpacked = this.toUnpacked(nm);
      if (existsSync(join(unpacked, "@modelcontextprotocol"))) return unpacked;
    } catch {
      /* 解析失败，回落候选探测 */
    }
    const candidates = [
      // packed: __dirname = dist-server/ → dist-server/node_modules (copied by copy-runtime-deps)
      resolve(__dirname, "node_modules"),
      // dev: __dirname = dist-server/ → packages/server/node_modules
      resolve(__dirname, "..", "packages", "server", "node_modules"),
      // dev fallback: __dirname deeper in src tree
      resolve(__dirname, "..", "..", "..", "node_modules"),
      resolve(__dirname, "..", "..", "node_modules"),
      resolve(__dirname, "..", "node_modules"),
      // packed alt: __dirname = resources/app/dist-server/ → packages/server/node_modules
      resolve(__dirname, "..", "..", "packages", "server", "node_modules"),
    ].map((p) => this.toUnpacked(p));
    const hit = candidates.find((p) => existsSync(join(p, "@modelcontextprotocol")));
    if (!hit) {
      this.logger.error(
        `[cron-registrar] @modelcontextprotocol/sdk 所在 node_modules 未找到，` +
          `已探测: ${candidates.join(" | ")}`,
      );
    }
    return hit || candidates[0];
  }

  private getNodeCommand(): { command: string; envExtras: Record<string, string> } {
    const exec = process.execPath || "node";
    if (isElectronExecutable(exec)) {
      return { command: exec, envExtras: { ELECTRON_RUN_AS_NODE: "1" } };
    }
    return { command: exec, envExtras: {} };
  }

  // ─── .claude.json registration（CLI 真正读取的 MCP 配置文件）───

  private syncToClaudeConfig(): void {
    const config = readClaudeConfigJson();
    const servers = (config.mcpServers ?? {}) as Record<string, unknown>;
    const { command, envExtras } = this.getNodeCommand();
    servers["cron-tools"] = {
      command,
      args: [this.getMcpServerScriptPath()],
      env: {
        // env is override-only; must explicitly pass these as child process cannot inherit parent env
        CRON_API_BASE: `http://127.0.0.1:${process.env.PORT ?? 10086}`,
        // MCP_SDK_DIR: absolute path to the node_modules dir containing @modelcontextprotocol
        // NODE_PATH does not work for ESM imports, so we pass the dir and resolve in the mjs
        MCP_SDK_DIR: this.getNodeModulesPath(),
        ...envExtras,
      },
    };
    config.mcpServers = servers;
    writeClaudeConfigJson(config);
    this.cleanupLegacySettings();
    this.logger.log("[cron-registrar] synced cron-tools to .claude.json");
  }

  /**
   * 清理早期版本误写入 settings.json 的 cron-tools 键。幂等：无残留则不写文件。
   */
  private cleanupLegacySettings(): void {
    const settings = readLocalClawSettings();
    const servers =
      settings.mcpServers && typeof settings.mcpServers === "object"
        ? (settings.mcpServers as Record<string, unknown>)
        : null;
    if (!servers || !("cron-tools" in servers)) return;
    delete servers["cron-tools"];
    writeLocalClawSettings(settings);
  }

  // ─── ~/.localclaw/CLAUDE.md append guard rules (user scope) ───

  private appendCronGuardToUserClaudeMd(): void {
    const claudeDir = getAgentHomeDir();
    if (!existsSync(claudeDir)) mkdirSync(claudeDir, { recursive: true });
    const p = join(claudeDir, "CLAUDE.md");
    const CURRENT_VERSION = 1;
    const markerRe = /<!-- local-claw:cron-guard:v(\d+) -->/;
    const startMarker = `<!-- local-claw:cron-guard:v${CURRENT_VERSION} -->`;
    const endMarker = "<!-- /local-claw:cron-guard -->";

    const bodyLines = [
      startMarker,
      "## 定时任务创建规则（Local Claw）",
      "",
      "创建或管理定时任务时必须遵守：",
      "1. 统一使用 MCP 工具 cron_create / cron_list / cron_update / cron_delete / cron_toggle / cron_run_now。",
      "2. 禁止使用 claude-cli 内置的 CronCreate / CronDelete / CronList（它们在本应用中已被禁用）。",
      "3. 禁止使用 Bash + curl 调用 REST，也不要直接写 scheduled_tasks.json。",
      "4. cwd 参数必须是绝对路径；留空则使用默认工作空间。",
      "5. 创建成功后把返回的 `task.id` / `task.cron` 告诉用户以便确认。",
      "6. 注意：ScheduleWakeup 仅 /loop 内部使用，不用于正式定时任务。",
      endMarker,
    ];

    const existing = existsSync(p) ? readFileSync(p, "utf-8") : "";
    const nl = existing.includes("\r\n") ? "\r\n" : "\n";
    const body = bodyLines.join(nl);

    let next: string;
    const startMatch = existing.match(markerRe);
    if (startMatch) {
      const startIdx = startMatch.index ?? 0;
      const endIdx = existing.indexOf(endMarker, startIdx);
      if (endIdx >= 0) {
        next =
          existing.slice(0, startIdx) +
          body +
          existing.slice(endIdx + endMarker.length);
      } else {
        // Old version without endMarker: truncate from marker position and rewrite
        next =
          existing.slice(0, startIdx).replace(/\s+$/, "") + nl + nl + body + nl;
      }
    } else {
      next = existing
        ? existing.replace(/\s+$/, "") + nl + nl + body + nl
        : body + nl;
    }

    if (next === existing) return;
    atomicWriteFile(p, next);
    this.logger.log(
      `[cron-registrar] updated ${p} (marker v${CURRENT_VERSION})`,
    );
  }

  // ─── smoke test ───

  private smokeTest(): Promise<void> {
    return new Promise((res) => {
      const { command, envExtras } = this.getNodeCommand();
      const child = spawn(command, [this.getMcpServerScriptPath()], {
        stdio: ["pipe", "ignore", "pipe"],
        windowsHide: true, // 隐藏子进程控制台，避免 Windows 上闪黑窗
        env: {
          ...process.env,
          CRON_API_BASE: `http://127.0.0.1:${process.env.PORT ?? 10086}`,
          MCP_SDK_DIR: this.getNodeModulesPath(),
          ...envExtras,
        },
      });
      let stderr = "";
      child.stderr?.on("data", (d) => {
        stderr += String(d);
      });
      child.on("error", (e) => {
        this.logger.error(`[cron-registrar] smoke spawn error: ${String(e)}`);
        res();
      });
      child.on("exit", (code) => {
        if (code !== 0 && code !== null) {
          // 升级为 error：路径解析仍出问题时（如 ESM 找不到 SDK）这里是唯一信号，
          // 别再用 warn 让它淹没在日志里。stderr 通常含 ERR_MODULE_NOT_FOUND 等根因。
          this.logger.error(
            `[cron-registrar] smoke exited ${code}; cron MCP 可能未生效; stderr:\n${stderr.slice(0, 500)}`,
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
