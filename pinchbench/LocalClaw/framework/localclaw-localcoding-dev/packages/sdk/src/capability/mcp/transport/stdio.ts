/**
 * MCP stdio Transport：spawn MCP Server 进程，通过 stdin/stdout 交换 JSON-RPC 消息。
 * @module @lenovo/agent-sdk / capability / mcp / transport / stdio
 * @internal
 */
import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import { logger } from "../../../util/logger";
import type { StdioTransportOptions } from "../types";

/** JSON-RPC 请求/通知 */
export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: number | string;
  method: string;
  params?: Record<string, unknown>;
}

/** JSON-RPC 响应 */
export type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: number | string;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

/** JSON-RPC 错误通知（无 id） */
export type JsonRpcNotification = {
  jsonrpc: "2.0";
  method: string;
  params?: { method?: string; params?: unknown };
};

export type JsonRpcMessage = JsonRpcRequest | JsonRpcResponse | JsonRpcNotification;

/** 消息处理器 */
export type MessageHandler = (msg: JsonRpcMessage) => void;
/** 进程退出处理器 */
export type ExitHandler = (code: number | null, signal: string | null) => void;
/** 错误处理器 */
export type ErrorHandler = (err: Error) => void;

/**
 * MCP stdio Transport。
 *
 * 生命周期：
 * 1. spawn(command, args, env)  → 启动进程
 * 2. send(request)               → 发 JSON-RPC 请求（带 id 追踪）
 * 3. onMessage(handler)          → 注册消息回调
 * 4. close()                     → 终止进程
 */
export class StdioTransport {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private requestId = 0;
  private pending = new Map<number | string, (res: JsonRpcResponse) => void>();
  private messageHandlers: MessageHandler[] = [];
  private exitHandlers: ExitHandler[] = [];
  private errorHandlers: ErrorHandler[] = [];
  private stderrBuffer = "";
  private initialized = false;

  get isRunning(): boolean {
    return this.proc !== null && !this.proc.killed;
  }

  /** 启动 MCP Server 进程 */
  /** 启动 MCP Server 进程，完成 initialize handshake 后 resolve。 */
  spawn(opts: StdioTransportOptions): Promise<void> {
    if (this.proc) {
      this.close();
    }

    const {
      command,
      args = [],
      env = {},
      cwd = process.cwd(),
      timeout = 120000,
    } = opts;

    const childEnv: Record<string, string | undefined> = { ...process.env, ...env };
    // 删除 null/undefined 值
    for (const k of Object.keys(childEnv)) {
      if (childEnv[k] == null) delete childEnv[k];
    }

    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(this.buildSpawnTimeoutMessage(command, timeout)));
      }, timeout);

      // Windows 下 npx / uvx / npm 等是 .cmd 批处理脚本，spawn 不带 shell 会 ENOENT。
      // 用 shell: true 让系统解析 PATHEXT（.cmd/.bat），跨平台兼容。
      this.proc = spawn(command, args, {
        cwd,
        env: childEnv,
        stdio: ["pipe", "pipe", "pipe"],
        shell: process.platform === "win32",
        // Windows：shell:true 会经 cmd 解析，不隐藏会闪黑窗；隐藏子进程控制台。
        windowsHide: true,
      });

      this.proc.stderr?.setEncoding("utf8");
      this.proc.stderr?.on("data", (chunk: string) => {
        this.stderrBuffer += chunk;
      });

      this.proc.on("error", (err) => {
        clearTimeout(timer);
        this.errorHandlers.forEach((h) => h(err));
        reject(err);
      });

      this.proc.on("exit", (code, signal) => {
        clearTimeout(timer);
        this.initialized = false;
        this.proc = null;
        const message = this.buildExitErrorMessage(code, signal);
        this.pending.forEach((cb) => cb({ jsonrpc: "2.0", id: 0, error: { code: -32000, message } }));
        this.pending.clear();
        this.exitHandlers.forEach((h) => h(code, signal));
      });

      // 按行解析 stdout（每行一个 JSON-RPC 消息）
      // 设置 encoding: 'utf8' 避免 Windows 下默认 GBK 导致 UTF-8 内容乱码
      this.proc.stdout.setEncoding("utf8");
      let lineBuf = "";
      this.proc.stdout.on("data", (chunk: string) => {
        lineBuf += chunk;
        const lines = lineBuf.split("\n");
        lineBuf = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const msg = JSON.parse(trimmed) as JsonRpcMessage;
            this.dispatchMessage(msg);
          } catch {
            logger.warn(`[StdioTransport] failed to parse JSON-RPC: ${trimmed}`);
          }
        }
      });

      // 发送 initialize
      const reqId = ++this.requestId;
      const initReq: JsonRpcRequest = {
        jsonrpc: "2.0",
        id: reqId,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "localclaw-mcp", version: "1.0.0" },
        },
      };

      const cleanup = () => {
        clearTimeout(timer);
        resolve();
      };

      this.pending.set(reqId, (res) => {
        if (res.error) {
          reject(new Error(`[StdioTransport] initialize failed: ${res.error.message}`));
        } else {
          this.initialized = true;
          // 发送 initialized 通知（无 id，不等响应）
          this.notify("notifications/initialized", {});
          cleanup();
        }
      });

      this.sendRaw(initReq);
    });
  }

  /** 发送 JSON-RPC 请求（带 id），返回 Promise 响应 */
  send(request: Omit<JsonRpcRequest, "id">): Promise<JsonRpcResponse> {
    if (!this.proc || this.proc.killed) {
      return Promise.reject(new Error("[StdioTransport] process not running"));
    }
    const id = ++this.requestId;
    const req: JsonRpcRequest = { ...request, id };
    return new Promise((resolve, reject) => {
      this.pending.set(id, (res) => {
        if (res.error) reject(new Error(`[StdioTransport] RPC error: ${res.error.message}`));
        else resolve(res);
      });
      this.sendRaw(req);
    });
  }

  /** 发送 JSON-RPC 通知（无 id） */
  notify(method: string, params?: Record<string, unknown>): void {
    if (!this.proc || this.proc.killed) return;
    this.sendRaw({ jsonrpc: "2.0", method, params });
  }

  onMessage(handler: MessageHandler): void {
    this.messageHandlers.push(handler);
  }

  onExit(handler: ExitHandler): void {
    this.exitHandlers.push(handler);
  }

  onTransportError(handler: ErrorHandler): void {
    this.errorHandlers.push(handler);
  }

  close(): void {
    if (this.proc && !this.proc.killed) {
      this.proc.kill("SIGTERM");
    }
    this.proc = null;
    this.initialized = false;
    this.pending.clear();
    this.messageHandlers = [];
    this.exitHandlers = [];
    this.errorHandlers = [];
  }

  /** 获取最近累计的 stderr 输出（调试用） */
  getStderr(): string {
    return this.stderrBuffer;
  }

  // ── 私有 ──

  private sendRaw(msg: JsonRpcMessage): void {
    if (!this.proc || this.proc.stdin.destroyed) return;
    try {
      this.proc.stdin.write(JSON.stringify(msg) + "\n");
    } catch (err) {
      logger.error(`[StdioTransport] send failed:`, err);
    }
  }

  private dispatchMessage(msg: JsonRpcMessage): void {
    // 有 id 的是响应，触发 pending callback
    if ("id" in msg && typeof msg.id !== "undefined") {
      const cb = this.pending.get(msg.id);
      if (cb) {
        this.pending.delete(msg.id);
        cb(msg as JsonRpcResponse);
      }
    }
    // 所有消息都广播给 handler
    this.messageHandlers.forEach((h) => h(msg));
  }

  /**
   * 构造启动超时错误信息：中文友好提示。
   * 首次启动常因 uvx / npx 联网拉取并安装依赖（或设置全局命令）而较慢，
   * 故提示用户可能正在下载依赖、引导稍候后「重试」，并给出多次失败时的排查方向。
   */
  private buildSpawnTimeoutMessage(command: string, timeout: number): string {
    const seconds = Math.round(timeout / 1000);
    return (
      `启动超时（已等待 ${seconds} 秒）：${command}。` +
      `首次启动可能正在下载并安装依赖（如 uvx / npx 拉取，或设置全局命令），网络较慢时会更久。` +
      `请稍候后点击「重试」；若多次超时，请检查命令、网络或代理设置。`
    );
  }

  /**
   * 构造进程退出错误信息：携带退出码、signal 与 stderr 摘要，便于定位根因。
   * stderr 为空时多半是命令不存在 / PATH 未包含该命令。
   */
  private buildExitErrorMessage(code: number | null, signal: string | null): string {
    const head = `process exited (code=${code ?? "null"}, signal=${signal ?? "null"})`;
    const stderr = this.stderrBuffer.trim();
    if (!stderr) {
      return `${head}; 无 stderr 输出，可能命令不存在或 PATH 未包含该命令`;
    }
    // 错误通常在 stderr 尾部，保留尾部最多 2000 字符避免日志爆炸
    const MAX = 2000;
    const tail = stderr.length > MAX ? `…(已截断)\n${stderr.slice(-MAX)}` : stderr;
    return `${head}; stderr:\n${tail}`;
  }
}
