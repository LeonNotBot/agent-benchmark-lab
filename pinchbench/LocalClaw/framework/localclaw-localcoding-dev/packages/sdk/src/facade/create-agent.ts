/**
 * createAgent — 框架无关的极简门面（@public）。
 *
 * 目标：让第三方无需理解 NestJS / DI / 模块装配，几行代码跑通一次对话：
 *
 *   const agent = await createAgent({ dbPath: "./data.db" });
 *   for await (const msg of agent.run({ prompt: "写个贪吃蛇" })) {
 *     logger.log(msg);
 *   }
 *   await agent.dispose();
 *
 * 内部用 NestFactory.createApplicationContext 启一个最小模块解析出 RunnerService /
 * SessionService（拉起 routing/session/workspace 依赖闭包），把底层 onEvent 回调经
 * EventQueue 转成 AsyncIterable<SDKMessage>。NestJS 完全是实现细节，不泄漏到签名。
 */
import { logger } from "../util/logger";
import { Module, type DynamicModule } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { INestApplicationContext } from "@nestjs/common";
import type Database from "better-sqlite3";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { Attachment } from "@lenovo/agent-protocol";
import { DatabaseModule } from "../database/database.module";
import { RunnerModule } from "../capability/runner/runner.module";
import { RunnerService } from "../capability/runner/runner.service";
import { SessionService, type SessionKind } from "../core/session/session.service";
import { EventQueue } from "./event-queue";

/** createAgent 的配置。db 与 dbPath 二选一；都不给则报错（需要一个 SQLite 连接）。 */
export type CreateAgentOptions = {
  /** 已有的 better-sqlite3 连接（宿主自管生命周期，dispose 时不关闭）。 */
  db?: Database.Database;
  /** SQLite 文件路径；门面自建连接并在 dispose 时关闭。需安装 better-sqlite3。 */
  dbPath?: string;
  /** 默认工作目录（每次 run 可覆盖）。默认 process.cwd()。 */
  cwd?: string;
};

/** 单次对话的输入。 */
export type AgentRunInput = {
  prompt: string;
  /** 工作目录，覆盖 createAgent 的默认值。 */
  cwd?: string;
  /** 续接已有会话：传入上次 run 返回的 sessionId。 */
  sessionId?: string;
  /** 图片等附件。 */
  attachments?: Attachment[];
  /** 会话标题（新建会话时用）。默认取 prompt 前缀。 */
  title?: string;
  /** 会话类型，默认 "chat"。 */
  kind?: SessionKind;
  /** 取消本次运行：abort 后迭代器结束。 */
  signal?: AbortSignal;
};

/** createAgent 返回的句柄。 */
export interface Agent {
  /** 跑一次对话，返回标准 SDKMessage 流（async iterable）。 */
  run(input: AgentRunInput): AsyncIterable<SDKMessage>;
  /** 当前底层 sessionId（最近一次 run 创建/续接的会话）。 */
  readonly lastSessionId: string | undefined;
  /** 释放：关闭 Nest context（及门面自建的 DB 连接）。 */
  dispose(): Promise<void>;
}

/** @internal 门面内部用的最小根模块。 */
@Module({})
class AgentRootModule {
  static forRoot(db: Database.Database): DynamicModule {
    return {
      module: AgentRootModule,
      imports: [DatabaseModule.forRoot({ db }), RunnerModule],
    };
  }
}

/**
 * 创建一个 Agent。异步：内部需启动 Nest application context 解析依赖。
 */
export async function createAgent(
  options: CreateAgentOptions = {},
): Promise<Agent> {
  const { db, ownsDb } = await resolveDb(options);
  const ctx: INestApplicationContext =
    await NestFactory.createApplicationContext(AgentRootModule.forRoot(db), {
      logger: false,
    });
  const runner = ctx.get(RunnerService);
  const sessions = ctx.get(SessionService);
  const defaultCwd = options.cwd ?? process.cwd();

  return new AgentImpl(ctx, runner, sessions, defaultCwd, db, ownsDb);
}

/** @internal 解析 DB 连接：优先用传入的 db，否则按 dbPath 自建。 */
async function resolveDb(
  options: CreateAgentOptions,
): Promise<{ db: Database.Database; ownsDb: boolean }> {
  if (options.db) return { db: options.db, ownsDb: false };
  if (!options.dbPath) {
    throw new Error(
      "createAgent: 需要提供 db 或 dbPath（任一）以建立 SQLite 连接。",
    );
  }
  const { default: BetterSqlite3 } = await import("better-sqlite3");
  const conn = new BetterSqlite3(options.dbPath);
  conn.exec(`pragma journal_mode = WAL;`);
  return { db: conn, ownsDb: true };
}

/** @internal Agent 实现：包装 RunnerService，把 onEvent 流转成 async iterable。 */
class AgentImpl implements Agent {
  lastSessionId: string | undefined;

  constructor(
    private readonly ctx: INestApplicationContext,
    private readonly runner: RunnerService,
    private readonly sessions: SessionService,
    private readonly defaultCwd: string,
    private readonly db: Database.Database,
    private readonly ownsDb: boolean,
  ) {}

  run(input: AgentRunInput): AsyncIterable<SDKMessage> {
    const queue = new EventQueue<SDKMessage>();

    // 解析会话：续接已有，或新建。
    const existing = input.sessionId
      ? this.sessions.getSession(input.sessionId)
      : undefined;
    const session =
      existing ??
      this.sessions.createSession({
        title: input.title ?? deriveTitle(input.prompt),
        prompt: input.prompt,
        cwd: input.cwd ?? this.defaultCwd,
        kind: input.kind ?? "chat",
      });
    this.lastSessionId = session.id;
    // 续接时用上次记录的 claudeSessionId 做 CLI --resume。
    const resumeSessionId = existing?.claudeSessionId;

    void this.runner
      .createRunner({
        prompt: input.prompt,
        attachments: input.attachments,
        session,
        resumeSessionId,
        onSessionUpdate: (updates) =>
          this.sessions.updateSession(session.id, updates),
        onEvent: (event) => {
          switch (event.type) {
            case "stream.message":
              queue.push(event.payload.message as unknown as SDKMessage);
              break;
            case "session.status": {
              const status = event.payload.status;
              if (status === "completed") queue.end();
              else if (status === "error")
                queue.fail(
                  new Error(event.payload.error ?? "agent run failed"),
                );
              break;
            }
            case "runner.error":
              queue.fail(new Error(event.payload.message));
              break;
          }
        },
      })
      .then((res) => {
        // abort 支持：signal 触发时杀底层进程并结束迭代。
        if (input.signal) {
          if (input.signal.aborted) {
            res.handle.abort();
            queue.end();
          } else {
            input.signal.addEventListener("abort", () => {
              res.handle.abort();
              queue.end();
            });
          }
        }
      })
      .catch((err) => queue.fail(err));

    return queue;
  }

  async dispose(): Promise<void> {
    await this.ctx.close();
    if (this.ownsDb) {
      try {
        this.db.close();
      } catch {
        /* best-effort */
      }
    }
  }
}

/** @internal 从 prompt 派生一个短标题。 */
function deriveTitle(prompt: string): string {
  const trimmed = prompt.trim().replace(/\s+/g, " ");
  return trimmed.length > 40 ? trimmed.slice(0, 40) + "..." : trimmed || "New Session";
}

