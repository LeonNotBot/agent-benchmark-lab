import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { WsAdapter } from "@nestjs/platform-ws";
import { configurePaths } from "@lenovo/agent-sdk";
import { AppModule } from "./app.module";
import { networkInterfaces } from "os";
import { resolve } from "path";
import { SkillService } from "./modules/skill/skill.service";
import { TemplateService } from "./modules/template/template.service";

// 声明产品身份：SDK 据此派生所有缓存目录（~/.localcoding、~/localcoding-workspace 等）。
// 必须在任何 SDK Service 实例化前执行，故置于 import 之后、模块体最顶。
// 环境变量 AGENT_CONFIG_DIR / AGENT_WORKSPACE_DIR 仍可在部署时进一步覆盖。
configurePaths({ product: "localcoding" });

// 日志初始化：按环境变量开启 debug 级别 + stdout/stderr 落盘。
// 紧跟 configurePaths 之后（依赖 agentHomeDir 已定）、任何日志产生前。
import { initLogging } from "./config/logging";
initLogging();

import "./config/claude-settings";

process.on("uncaughtException", (err) => {
  console.error("[main] uncaughtException:", err?.stack || err);
});
process.on("unhandledRejection", (reason) => {
  console.error("[main] unhandledRejection:", (reason as any)?.stack || reason);
});
process.on("exit", (code) => {
  console.error(`[main] process exiting with code=${code}`);
});

// 持有 Nest 应用实例的模块级引用，供信号处理器优雅关闭时调用 app.close()。
// app.close() 会触发各模块 onModuleDestroy（含 scheduler lock 释放、WS 断开、
// DB flush 等），随后 process 退出才会释放端口，避免新进程撞上 EADDRINUSE。
let nestApp: { close: () => Promise<void> } | null = null;
let shuttingDown = false;

async function gracefulShutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.error(`[main] received ${signal}, shutting down gracefully...`);

  // 超时兜底：任一 onModuleDestroy 卡死也保证进程在 3s 内退出，
  // 释放端口/锁，让父进程（Electron）的新实例能顺利接管。
  const forceTimer = setTimeout(() => {
    console.error("[main] graceful shutdown timed out (3s), forcing exit");
    process.exit(0);
  }, 3000);
  forceTimer.unref();

  try {
    if (nestApp) await nestApp.close();
    console.error("[main] shutdown complete");
  } catch (err: any) {
    console.error("[main] error during shutdown:", err?.stack || err);
  } finally {
    clearTimeout(forceTimer);
    process.exit(0);
  }
}

process.on("SIGTERM", () => void gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => void gracefulShutdown("SIGINT"));
process.on("SIGHUP", () => void gracefulShutdown("SIGHUP"));
process.on("SIGBREAK" as any, () => void gracefulShutdown("SIGBREAK"));
process.stdin.on("close", () => console.error("[main] stdin closed"));
process.stdin.on("error", (err) => console.error("[main] stdin error:", err));

// 由 @nestjs/platform-express 间接安装；esbuild external 中已声明
// eslint-disable-next-line @typescript-eslint/no-var-requires
const express = require("express");

// GolemBot 的 IM adapter 在运行时通过 importPeer() 动态加载 lark / grammy
// 等可选 SDK。当 server 以打包后的 dist-server/server.cjs 跑时，import()
// 默认从该位置解析，找不到 packages/server/node_modules 下的包；
// setPeerBase 让 GolemBot 用 createRequire(botDir) 兜底。
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { setPeerBase } = require("golembot/dist/peer-require.js") as {
    setPeerBase: (dir: string) => void;
  };
  // __dirname 在 bundle 后是 dist-server/；源码 dev 运行时是 packages/server/src 等。
  // peer-require 内部会拼 join(botDir, 'package.json') 然后 createRequire，
  // 所以 botDir 应当指向有 node_modules 的目录。
  // packed: dist-server/.. = repo root → packages/server
  // dev: packages/server/src/.. = packages/server
  // 兼顾两种情况：从 __dirname 向上找第一个含 packages/server/node_modules 的祖先。
  const fs = require("fs") as typeof import("fs");
  const path = require("path") as typeof import("path");
  const candidates = [
    path.resolve(__dirname, "..", "packages", "server"),
    path.resolve(__dirname, "..", ".."),
    path.resolve(__dirname, ".."),
  ];
  const botDir =
    candidates.find((d) =>
      fs.existsSync(path.join(d, "node_modules", "@larksuiteoapi")),
    ) ?? candidates[0];
  setPeerBase(botDir);
} catch {
  // dev 模式下可能从源码跑，import() 自身可解析；忽略错误
}

/**
 * 带重试的端口监听：覆盖「旧进程刚被杀、端口仍处 TIME_WAIT」的时序窗口。
 * 重试 5 次，每次间隔 800ms；仍失败则给出人话提示并退出。
 */
async function listenWithRetry(app: any, port: number, host: string, retries = 5, intervalMs = 800) {
  for (let i = 0; i <= retries; i++) {
    try {
      await app.listen(port, host);
      return;
    } catch (err: any) {
      // 仅 EADDRINUSE 是真正的「端口被占用」，可重试。其余错误（典型如启动期
      // 模块 onModuleInit 写 settings.json 失败抛 EPERM）与端口无关，必须如实
      // 报告原始错误，否则会把文件/权限问题误导成「端口无法监听」，排查跑偏。
      if (err?.code !== "EADDRINUSE") {
        console.error(
          `\n[main] ❌ 服务启动失败（与端口无关）：${err?.code ? `${err.code} ` : ""}${err?.message}\n` +
            (err?.stack ? `${err.stack}\n` : ""),
        );
        process.exit(1);
      }
      if (i === retries) {
        console.error(
          `\n[main] ❌ 端口 ${port} 无法监听（仍被占用）。\n` +
            `       请检查是否有残留进程：netstat -ano | findstr :${port}\n`,
        );
        process.exit(1);
      }
      console.log(`[main] 端口 ${port} 被占用，${intervalMs}ms 后重试 (${i + 1}/${retries})...`);
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }
}

async function bootstrap() {
  // debug 级别时让 NestJS 框架也输出 debug/verbose（默认 logger 不含这两级）。
  const nestLogger =
    (process.env.LENOVO_SDK_LOG_LEVEL ?? "").toLowerCase() === "debug"
      ? (["error", "warn", "log", "debug", "verbose"] as const)
      : undefined;
  const app = await NestFactory.create(AppModule, {
    bodyParser: false,
    ...(nestLogger ? { logger: [...nestLogger] } : {}),
  });

  // 暴露给信号处理器，使 SIGTERM/SIGINT 能触发 app.close() → 各模块 onModuleDestroy
  // （释放 scheduler lock、关闭 WS、flush DB），随后端口才释放。
  // 注意：不调用 enableShutdownHooks()，否则 Nest 会另注册一套信号监听与本文件的
  // gracefulShutdown 重复触发 app.close()；app.close() 本身即会调用 onModuleDestroy。
  nestApp = app;

  // 文件上传路由跳过 body parser，由 controller 直接读取原始流
  const jsonParser = express.json({ limit: "50mb" });
  const urlencodedParser = express.urlencoded({ extended: true, limit: "50mb" });
  app.use((req: any, res: any, next: any) => {
    if (req.method === "POST" && /^\/api\/datasets\/[^/]+\/documents$/.test(req.path)) {
      return next();
    }
    return jsonParser(req, res, (err: unknown) => {
      if (err) return next(err);
      return urlencodedParser(req, res, next);
    });
  });

  const rawCorsOrigin = process.env.CORS_ORIGIN ?? "*";
  const corsOrigins = rawCorsOrigin.split(",").map((o) => o.trim()).filter(Boolean);
  app.enableCors({
    origin: corsOrigins.length === 1 ? corsOrigins[0] : corsOrigins,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: rawCorsOrigin !== "*",
  });

  app.useWebSocketAdapter(new WsAdapter(app));

  // 安装内置 skills（首次启动，不覆盖已有的）
  try {
    const skillService = app.get(SkillService);
    const builtinDir = process.env.BUILTIN_SKILLS_DIR
      || resolve(__dirname, "..", "resources", "builtin-skills");
    const result = skillService.installBuiltinSkills(builtinDir);
    if (result.installed.length > 0) {
      console.log(`[builtin-skills] Installed ${result.installed.length}: ${result.installed.join(", ")}`);
    }
  } catch (e: any) {
    console.error(`[builtin-skills] Failed: ${e.message}`);
  }

  // 安装内置 templates（首次启动，不覆盖已有的）
  try {
    const templateService = app.get(TemplateService);
    const builtinTemplatesDir = process.env.BUILTIN_TEMPLATES_DIR
      || resolve(__dirname, "..", "resources", "builtin-templates");
    const result = templateService.syncBuiltinTemplates(builtinTemplatesDir);
    if (result.installed.length > 0) {
      console.log(`[builtin-templates] Installed ${result.installed.length}: ${result.installed.join(", ")}`);
    }
  } catch (e: any) {
    console.error(`[builtin-templates] Failed: ${e.message}`);
  }

  const port = Number(process.env.PORT ?? 10086);
  // 监听地址默认回环（127.0.0.1）——单用户桌面客户端场景：server 由 Electron 在本机
  // fork、仅本机访问。这样上游 API key、网关、/api 都不暴露到局域网（同 wifi 邻座读过
  // 源码里的常量 token 就能借用户的 key 发请求 / 经模型外泄数据）。
  // 远程 server 部署（Electron 经 LOCAL_CLAW_USE_EXTERNAL_SERVER 连别的机器）需要
  // 局域网可达：显式设 SERVER_HOST=0.0.0.0 主动开启。安全默认 + 显式 opt-in。
  const host = process.env.SERVER_HOST ?? "127.0.0.1";
  await listenWithRetry(app, port, host);

  // 仅当绑 0.0.0.0（远程部署）时才枚举并打印局域网地址；绑回环时只报 127.0.0.1，
  // 否则会打印出实际打不通的 LAN URL，误导排查。
  const localAddresses = new Set<string>(["127.0.0.1"]);
  if (host === "0.0.0.0") {
    const nets = networkInterfaces();
    for (const netInterfaces of Object.values(nets)) {
      for (const net of netInterfaces ?? []) {
        if (net.family === "IPv4" && !net.internal) localAddresses.add(net.address);
      }
    }
  }
  console.log(`Server running at (host=${host}):`);
  for (const addr of localAddresses) console.log(`  http://${addr}:${port}/`);
}

bootstrap().catch((err) => {
  console.error("[main] ❌ 启动失败:", err?.stack || err?.message || err);
  process.exit(1);
});
