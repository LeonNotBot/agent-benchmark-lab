import * as path from "path";
import * as fs from "fs";
import { fork, ChildProcess } from "child_process";
import type { ExtensionContext, OutputChannel } from "vscode";
import { pickFreePort } from "./port";
import {
  getServerEntry,
  getClaudeCliPath,
  getClaudeCliExecutable,
  resolveBundledResourceDir,
  resolveSystemNode,
} from "./paths";

/** 与桌面版(10086)错开,避免同机共存时撞端口。 */
const PREFERRED_PORT = Number(process.env.LOCALCLAW_VSCODE_PORT) || 10087;

/**
 * 管理 server(NestJS)子进程的生命周期:fork + env 注入 + 健康检查 + 清理。
 * 对应 electron/main.cjs 的 startServer/pickFreePort/健康检查,差异见 paths.ts。
 */
export class ServerManager {
  private proc: ChildProcess | null = null;
  private port = PREFERRED_PORT;
  private readonly ctx: ExtensionContext;
  private readonly log: OutputChannel;
  /** 收集 stderr 尾部,server 意外退出时并入错误消息,便于用户直接看到根因。 */
  private stderrTail = "";

  constructor(ctx: ExtensionContext, log: OutputChannel) {
    this.ctx = ctx;
    this.log = log;
  }

  get serverUrl(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  /** 启动 server 并等待 /health 就绪。返回 serverUrl。 */
  async start(): Promise<string> {
    if (this.proc) return this.serverUrl;
    this.port = await pickFreePort(PREFERRED_PORT);
    const entry = getServerEntry(this.ctx);
    if (!fs.existsSync(entry)) {
      throw new Error(`server 入口不存在: ${entry}(需先构建 dist-server)`);
    }
    this.stderrTail = "";

    // 关键:显式用系统 node 作 execPath。VSCode 扩展宿主 fork 默认用 Code.exe,
    // 其 Node ABI 与 dist-server 里 better-sqlite3 编译目标不一致会导致子进程立刻崩溃。
    const nodePath = resolveSystemNode();
    const forkOpts: Parameters<typeof fork>[2] = {
      cwd: this.storageDir(),
      stdio: ["pipe", "pipe", "pipe", "ipc"],
      env: this.buildEnv(),
      // 清掉从扩展宿主继承的 execArgv(含 --inspect),否则子进程会尝试占用同一
      // 调试端口报「address already in use」。server 无需继承宿主的调试参数。
      execArgv: [],
    };
    if (nodePath) {
      forkOpts.execPath = nodePath;
      this.log.appendLine(`[server] node=${nodePath}`);
    } else {
      this.log.appendLine(
        "[server] 警告:未找到系统 node,回退 Code.exe(better-sqlite3 可能 ABI 不匹配)。" +
          "可设置环境变量 LOCALCODING_NODE_PATH 指向 node 可执行文件。",
      );
    }

    this.log.appendLine(`[server] entry=${entry} port=${this.port}`);
    this.log.show(true);
    this.proc = fork(entry, [], forkOpts);
    this.wirePipes();
    await this.waitHealthy();
    return this.serverUrl;
  }

  async stop(): Promise<void> {
    if (!this.proc) return;
    const p = this.proc;
    this.proc = null;
    try {
      p.kill();
    } catch {
      /* ignore */
    }
  }

  async restart(): Promise<string> {
    await this.stop();
    return this.start();
  }

  private storageDir(): string {
    const dir = this.ctx.globalStorageUri.fsPath;
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  /**
   * 复刻 main.cjs fork 的 env 清单。差异:
   * - 资源目录用扩展目录(getBundledResourceDir)而非 process.resourcesPath;
   * - DB/工作目录用 globalStorageUri 而非 app.getPath('userData');
   * - CLI executable 用 process.execPath + ELECTRON_RUN_AS_NODE=1(扩展宿主即 Electron/Node)。
   */
  private buildEnv(): NodeJS.ProcessEnv {
    const cliPath = getClaudeCliPath(this.ctx);
    const cliExec = getClaudeCliExecutable();
    const cliDir = cliPath ? path.dirname(cliPath) : "";
    const currentPath = process.env.PATH || "";
    const updatedPath = cliDir
      ? cliDir + path.delimiter + currentPath
      : currentPath;
    const storage = this.storageDir();
    return {
      ...process.env,
      NODE_ENV: "production",
      // 扩展宿主用 Electron 二进制跑 node 脚本,必须显式声明,否则会当作 Electron 主进程启动。
      ELECTRON_RUN_AS_NODE: "1",
      PORT: String(this.port),
      CLAUDE_CODE_WEBUI_USE_DIST: "1",
      CLAUDE_CLI_PATH: cliPath,
      CLAUDE_CLI_EXECUTABLE: cliExec,
      CLAUDE_RUNNER_MODE: "spawn",
      DB_PATH: path.join(storage, "webui.db"),
      BUILTIN_SKILLS_DIR: resolveBundledResourceDir(this.ctx, "builtin-skills"),
      BUILTIN_TEMPLATES_DIR: resolveBundledResourceDir(this.ctx, "builtin-templates"),
      // Telemetry:插件形态暂不外发(对齐 dev 态)。
      APP_IS_PACKAGED: "0",
      APP_PLATFORM: process.platform,
      PATH: updatedPath,
    };
  }

  private wirePipes(): void {
    if (!this.proc) return;
    this.proc.stdout?.on("data", (d) => {
      const t = String(d).trim();
      if (t) this.log.appendLine(`[server] ${t}`);
    });
    this.proc.stderr?.on("data", (d) => {
      const t = String(d).trim();
      if (t) this.log.appendLine(`[server:err] ${t}`);
      // 保留尾部 2KB,退出时并入错误消息。
      this.stderrTail = (this.stderrTail + String(d)).slice(-2048);
    });
    this.proc.on("exit", (code, signal) => {
      this.log.appendLine(`[server] exited code=${code} signal=${signal}`);
      this.proc = null;
    });
  }

  /** 轮询 /api/health,直到 200 或超时(30s)。server 进程中途退出则立即失败。 */
  private async waitHealthy(): Promise<void> {
    const http = await import("http");
    const url = `${this.serverUrl}/api/health`;
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      if (!this.proc) {
        const tail = this.stderrTail.trim();
        throw new Error(
          "server 进程在就绪前已退出" + (tail ? `:\n${tail.slice(-600)}` : ""),
        );
      }
      const ok = await new Promise<boolean>((resolve) => {
        const req = http.get(url, (res) => {
          res.resume();
          resolve(res.statusCode === 200);
        });
        req.on("error", () => resolve(false));
        req.setTimeout(2000, () => {
          req.destroy();
          resolve(false);
        });
      });
      if (ok) {
        this.log.appendLine(`[server] healthy at ${this.serverUrl}`);
        return;
      }
      await new Promise((r) => setTimeout(r, 400));
    }
    throw new Error("server 健康检查超时(30s)");
  }
}
