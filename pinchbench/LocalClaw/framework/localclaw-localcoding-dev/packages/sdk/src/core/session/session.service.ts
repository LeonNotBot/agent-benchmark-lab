import { logger } from "../../util/logger";
import { Inject, Injectable } from "@nestjs/common";
import type Database from "better-sqlite3";
import type {
  SessionStatus,
  StreamMessage,
  UsageSummary,
  UsageSummaryItem,
  RoutingPreference,
  SmartHybridConfig,
} from "@lenovo/agent-protocol";
import { isCliReplayNoise } from "@lenovo/agent-protocol";
import { claudeCodeEnv } from "../../config/claude-settings";
import { unstable_v2_prompt } from "@anthropic-ai/claude-agent-sdk";
import type { SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";
import { DATABASE } from "../../database/database.module";

export type PendingPermission = {
  toolUseId: string;
  toolName: string;
  input: unknown;
  resolve: (result: {
    behavior: "allow" | "deny";
    updatedInput?: unknown;
    message?: string;
  }) => void;
};

export type SessionKind = "chat" | "cron" | "channel";

/**
 * 会话级路由覆盖：模板应用时写入，使本会话的路由偏好独立于全局 RoutingService 状态。
 * 仅存于内存（不持久化）——重启后会话恢复为按全局偏好路由，符合「模板只在新建时生效一次」的语义。
 */
export type SessionRoutingOverride = {
  preference: RoutingPreference;
  modelOverride?: string;
  endpointId?: string;
  /**
   * 会话级 Smart Hybrid 配置。preference==="smart-hybrid" 时携带，使该会话独立走
   * 「基础模型 + 关键任务升级模型」策略，优先于全局 RoutingService 的 SH 配置。
   * 无值时 SH 分支回落全局配置（渠道/定时任务等不带 override 的场景）。
   */
  smartHybridConfig?: SmartHybridConfig;
};

/**
 * Session —— 对外的会话数据契约（@public）。纯数据，无运行时对象。
 *
 * 运行时态（待决权限、AbortController）见 {@link RuntimeSession}，仅 SDK 内部使用，
 * 不进对外类型，避免接入方耦合到实现细节。
 */
export type Session = {
  id: string;
  title: string;
  claudeSessionId?: string;
  status: SessionStatus;
  cwd?: string;
  allowedTools?: string;
  lastPrompt?: string;
  kind: SessionKind;
  routingOverride?: SessionRoutingOverride;
  /** true=cwd 是「不使用项目」时系统自动建的目录，不进 listRecentCwds 项目列表。 */
  autoCwd?: boolean;
};

/**
 * RuntimeSession —— SDK 内部的会话运行时态（@internal）。
 * = 对外 {@link Session} + 进程内运行对象（不持久化，不对外暴露）。
 */
export type RuntimeSession = Session & {
  pendingPermissions: Map<string, PendingPermission>;
  abortController?: AbortController;
  /**
   * 当前回合生效的 skill 工具白名单（不持久化，仅内存）。
   * 模型调用内置 Skill 工具时由 runner-spawn 解析写入；can_use_tool 据此对随后
   * 同一回合内的工具调用做门控（不在白名单内者 deny）。下一条 user message 清空。
   * null/空 = 未激活带限制的 skill，不约束。详见 skill-allowlist.ts。
   */
  activeSkillAllowedTools?: string[] | null;
  /**
   * 会话级工具放行集合（不持久化，仅内存）。用户在权限确认卡片选择「本次会话不再
   * 询问」时把该工具名加入；can_use_tool 命中即直接放行，不再弹确认。会话销毁即消失。
   */
  sessionAllowedTools?: Set<string>;
};

export type StoredSession = {
  id: string;
  title: string;
  status: SessionStatus;
  cwd?: string;
  allowedTools?: string;
  lastPrompt?: string;
  claudeSessionId?: string;
  kind: SessionKind;
  createdAt: number;
  updatedAt: number;
  type?: "normal";
};

export type SessionHistory = {
  session: StoredSession;
  messages: StreamMessage[];
};

/**
 * SESSION_SERVICE —— ISessionService 的 NestJS 注入令牌（@public）。
 *
 * 对外接入方请用 `@Inject(SESSION_SERVICE) svc: ISessionService` 注入，
 * 依赖接口而非具体类：SDK 重构实现不影响接入方。SDK 内部模块间仍可直接注入
 * 具体 SessionService 类（享受完整方法），二者经 module 的 useExisting 指向同一单例。
 */
export const SESSION_SERVICE = Symbol("SESSION_SERVICE");

/**
 * ISessionService —— 对外稳定的会话能力接口（@public）。
 *
 * 方法以纯数据类型（{@link Session} / {@link StoredSession}）对外，不暴露运行时态
 * （{@link RuntimeSession} 的 pendingPermissions / abortController 仅 SDK 内部可见）。
 * 遵循「接口窄、实现宽」：实现类方法可返回 RuntimeSession，经此接口对外收窄为 Session。
 */
export interface ISessionService {
  createSession(options: {
    cwd?: string;
    allowedTools?: string;
    prompt?: string;
    title: string;
    kind?: SessionKind;
    routingOverride?: SessionRoutingOverride;
    /** true=cwd 是「不使用项目」时系统自动建的目录，不进 listRecentCwds 项目列表。 */
    autoCwd?: boolean;
  }): Session;
  getSession(id: string): Session | undefined;
  listSessions(): StoredSession[];
  listRecentCwds(limit?: number): string[];
  getSessionHistory(id: string): SessionHistory | null;
  updateSession(id: string, updates: Partial<Session>): Session | undefined;
  deleteSession(id: string): boolean;
  recordMessage(sessionId: string, message: StreamMessage): void;
  generateSessionTitle(userIntent: string | null): Promise<string>;
  computeAndSaveUsageSummary(sessionId: string): UsageSummary;
  getUsageSummary(sessionId: string): UsageSummary | null;
  saveChangedFiles(
    sessionId: string,
    files: import("@lenovo/agent-protocol").ChangedFile[],
  ): void;
  getPersistedChangedFiles(
    sessionId: string,
  ): import("@lenovo/agent-protocol").ChangedFile[] | null;
  getSetting(key: string): string | null;
  setSetting(key: string, value: string | null): void;
}

@Injectable()
export class SessionService implements ISessionService {
  private sessions = new Map<string, RuntimeSession>();
  constructor(@Inject(DATABASE) private db: Database.Database) {
    this.reconcileStaleSessions();
    this.loadSessions();
  }

  /**
   * 启动对账：把上次遗留的 running 会话重置为 error。
   *
   * RunnerSpawnService 的进程缓存是纯内存 Map，且 onModuleInit 会清理所有残留 CLI
   * 子进程，因此重启后绝不可能有进程在为某个会话工作。任何持久化为 running 的会话
   * 都是僵尸状态（应用上次在任务进行中被关闭/强杀，CLI 的 result / stdout-close 路径
   * 未走到，状态停留在 running），前端恢复时会一直显示「思考中」却永远等不到事件流。
   * 在读入内存前统一重置为 error，前端据此显示「回复中断 + 重新发送」按钮，
   * 同时 error 不会禁用输入框（isRunning 仅判断 running），用户仍可继续对话。
   */
  private reconcileStaleSessions(): void {
    const rows = this.db
      .prepare(`select id from sessions where status='running'`)
      .all() as Array<{ id: string }>;
    if (rows.length === 0) return;

    const update = this.db.prepare(
      `update sessions set status=?, updated_at=? where id = ?`,
    );
    let completed = 0;
    let errored = 0;
    const now = Date.now();

    for (const row of rows) {
      const status = this.inferTerminalStatusFromMessages(String(row.id)) ?? "error";
      update.run(status, now, String(row.id));
      if (status === "completed") completed++;
      else errored++;
      logger.log(
        `[error-trace] reason=reconcile-stale-on-startup sessionId=${row.id} inferred=${status}`,
      );
    }

    logger.log(
      `[session] reconciled ${rows.length} stale running session(s) on startup ` +
        `(completed=${completed}, error=${errored})`,
    );
  }

  private inferTerminalStatusFromMessages(
    sessionId: string,
  ): "completed" | "error" | null {
    const rows = this.db
      .prepare(
        `select data from messages where session_id = ? order by created_at asc`,
      )
      .all(sessionId) as Array<{ data: string }>;

    let latestPromptIndex = -1;
    let latestResultIndex = -1;
    let latestResult: Record<string, unknown> | null = null;

    for (let index = 0; index < rows.length; index++) {
      const row = rows[index];
      let msg: any;
      try {
        msg = JSON.parse(row.data);
      } catch {
        continue;
      }
      if (msg?.type === "user_prompt") latestPromptIndex = index;
      if (msg?.type === "result") {
        latestResultIndex = index;
        latestResult = msg;
      }
    }

    if (!latestResult || latestResultIndex < latestPromptIndex) return null;
    return latestResult.subtype === "success" && latestResult.is_error !== true
      ? "completed"
      : "error";
  }

  createSession(options: {
    cwd?: string;
    allowedTools?: string;
    prompt?: string;
    title: string;
    kind?: SessionKind;
    routingOverride?: SessionRoutingOverride;
    /**
     * 该会话的 cwd 是否为「用户没选项目、系统自动建」的目录。缺省 false。
     * 由 gateway 按 `!payload.cwd` 判定并透传——true 时该 cwd 不进 listRecentCwds
     * 项目列表（见 listRecentCwds）。判定看的是创建意图，不看最终路径。
     */
    autoCwd?: boolean;
  }): RuntimeSession {
    const id = crypto.randomUUID();
    const now = Date.now();
    const kind = options.kind ?? "chat";
    const autoCwd = options.autoCwd ?? false;
    const session: RuntimeSession = {
      id,
      title: options.title,
      status: "idle",
      cwd: options.cwd,
      allowedTools: options.allowedTools,
      lastPrompt: options.prompt,
      kind,
      autoCwd,
      routingOverride: options.routingOverride,
      pendingPermissions: new Map(),
      sessionAllowedTools: new Set(), // 预初始化,确保扩展副本能共享引用
    };
    this.sessions.set(id, session);
    this.db
      .prepare(
        `insert into sessions
          (id, title, claude_session_id, status, cwd, allowed_tools, last_prompt, kind, auto_cwd, created_at, updated_at)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        session.title,
        null,
        session.status,
        session.cwd ?? null,
        session.allowedTools ?? null,
        session.lastPrompt ?? null,
        kind,
        autoCwd ? 1 : 0,
        now,
        now,
      );
    return session;
  }

  getSession(id: string): RuntimeSession | undefined {
    return this.sessions.get(id);
  }

  listSessions(): StoredSession[] {
    const rows = this.db
      .prepare(
        `select id, title, claude_session_id, status, cwd, allowed_tools, last_prompt, kind, created_at, updated_at
         from sessions where kind in ('chat', 'cron') order by updated_at desc`,
      )
      .all() as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: String(row.id),
      title: String(row.title),
      status: row.status as SessionStatus,
      cwd: row.cwd ? String(row.cwd) : undefined,
      allowedTools: row.allowed_tools ? String(row.allowed_tools) : undefined,
      lastPrompt: row.last_prompt ? String(row.last_prompt) : undefined,
      claudeSessionId: row.claude_session_id
        ? String(row.claude_session_id)
        : undefined,
      kind: row.kind ? (String(row.kind) as SessionKind) : "chat",
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
      type: "normal" as const,
    }));
  }

  listRecentCwds(limit = 8): string[] {
    // 只列「用户显式选择」的项目目录（auto_cwd=0）。「不使用项目」时系统自动建的
    // 会话/任务目录标记 auto_cwd=1，不进项目选择列表。判定依据是创建时的意图
    // （见 createSession 的 autoCwd 入参），不看路径——故用户就算显式选进
    // workspace 内部目录也会正常显示。
    const rows = this.db
      .prepare(
        `select cwd, max(updated_at) as latest
         from sessions
         where cwd is not null and trim(cwd) != '' and coalesce(auto_cwd, 0) = 0
         group by cwd order by latest desc limit ?`,
      )
      .all(limit) as Array<Record<string, unknown>>;
    return rows.map((row) => String(row.cwd));
  }

  getSessionHistory(id: string): SessionHistory | null {
    const sessionRow = this.db
      .prepare(
        `select id, title, claude_session_id, status, cwd, allowed_tools, last_prompt, kind, created_at, updated_at
         from sessions where id = ?`,
      )
      .get(id) as Record<string, unknown> | null;
    if (!sessionRow) return null;
    const messages = (
      this.db
        .prepare(
          `select data from messages where session_id = ? order by created_at asc`,
        )
        .all(id) as Array<Record<string, unknown>>
    )
      .map((row) => JSON.parse(String(row.data)) as StreamMessage)
      // 存量清理（读时、非破坏性）：广播守卫上线前已落库的模型切换面包屑，靠这里过滤，
      // 不删库 → 对老库/新库一致、幂等。与 processOutput 守卫共用同一判别。
      .filter((m) => !isCliReplayNoise(m));
    return {
      session: {
        id: String(sessionRow.id),
        title: String(sessionRow.title),
        status: sessionRow.status as SessionStatus,
        cwd: sessionRow.cwd ? String(sessionRow.cwd) : undefined,
        allowedTools: sessionRow.allowed_tools
          ? String(sessionRow.allowed_tools)
          : undefined,
        lastPrompt: sessionRow.last_prompt
          ? String(sessionRow.last_prompt)
          : undefined,
        claudeSessionId: sessionRow.claude_session_id
          ? String(sessionRow.claude_session_id)
          : undefined,
        kind: sessionRow.kind
          ? (String(sessionRow.kind) as SessionKind)
          : "chat",
        createdAt: Number(sessionRow.created_at),
        updatedAt: Number(sessionRow.updated_at),
        type: "normal" as const,
      },
      messages,
    };
  }

  updateSession(id: string, updates: Partial<Session>): RuntimeSession | undefined {
    const session = this.sessions.get(id);
    if (!session) return undefined;
    Object.assign(session, updates);
    this.persistSession(id, updates);
    return session;
  }

  setAbortController(
    id: string,
    controller: AbortController | undefined,
  ): void {
    const session = this.sessions.get(id);
    if (!session) return;
    session.abortController = controller;
  }

  // 加载历史时被丢弃、不参与回放的瞬时消息类型，不落库（详见 recordMessage 注释）。
  // - stream_event：流式增量 delta，仅用于"正在生成"时的实时渲染；完整 assistant 消息会单独下发。
  // - tool_progress：工具执行进度，同样只在运行时有意义。
  private static readonly EPHEMERAL_MESSAGE_TYPES = new Set(["stream_event", "tool_progress"]);

  recordMessage(sessionId: string, message: StreamMessage): void {
    // 瞬时流式消息不落库：前端 buildThreadMessages 重放时会整类跳过这些类型，
    // 持久化它们只会让单会话行数虚高十几倍、DB 膨胀 ~75%，且无任何读取者。
    if (SessionService.EPHEMERAL_MESSAGE_TYPES.has((message as { type?: string }).type ?? "")) {
      return;
    }
    const id =
      "uuid" in message && message.uuid
        ? String(message.uuid)
        : crypto.randomUUID();
    this.db
      .prepare(
        `insert or ignore into messages (id, session_id, data, created_at) values (?, ?, ?, ?)`,
      )
      .run(id, sessionId, JSON.stringify(message), Date.now());
  }

  deleteSession(id: string): boolean {
    const existing = this.sessions.get(id);
    if (existing) this.sessions.delete(id);
    this.db.prepare(`delete from messages where session_id = ?`).run(id);
    this.db.prepare(`delete from session_usage where session_id = ?`).run(id);
    const result = this.db.prepare(`delete from sessions where id = ?`).run(id);
    return result.changes > 0 || Boolean(existing);
  }

  async generateSessionTitle(userIntent: string | null): Promise<string> {
    if (!userIntent) return "New Session";
    try {
      const result: SDKResultMessage = await unstable_v2_prompt(
        `please analyze the following user input to generate a short but clear title to identify this conversation theme:
        ${userIntent}
        directly output the title, do not include any other content`,
        { model: claudeCodeEnv.ANTHROPIC_MODEL },
      );
      const title = (result as any).result;
      if (typeof title === "string" && title.trim()) return title.trim();
    } catch {
      /* fall through */
    }
    // Fallback: truncate user input as title
    return userIntent.length > 40
      ? userIntent.slice(0, 40) + "..."
      : userIntent;
  }

  private persistSession(id: string, updates: Partial<Session>): void {
    const fields: string[] = [];
    const values: Array<string | number | null> = [];
    const updatable = {
      title: "title",
      claudeSessionId: "claude_session_id",
      status: "status",
      cwd: "cwd",
      allowedTools: "allowed_tools",
      lastPrompt: "last_prompt",
      kind: "kind",
    } as const;
    for (const key of Object.keys(updates) as Array<keyof typeof updatable>) {
      const column = updatable[key];
      if (!column) continue;
      fields.push(`${column} = ?`);
      const value = updates[key];
      values.push(value === undefined ? null : (value as string));
    }
    if (fields.length === 0) return;
    fields.push("updated_at = ?");
    values.push(Date.now());
    values.push(id);
    this.db
      .prepare(`update sessions set ${fields.join(", ")} where id = ?`)
      .run(...values);
  }

  private loadSessions(): void {
    const rows = this.db
      .prepare(
        `select id, title, claude_session_id, status, cwd, allowed_tools, last_prompt, kind
         from sessions`,
      )
      .all();
    for (const row of rows as Array<Record<string, unknown>>) {
      const session: RuntimeSession = {
        id: String(row.id),
        title: String(row.title),
        claudeSessionId: row.claude_session_id
          ? String(row.claude_session_id)
          : undefined,
        status: row.status as SessionStatus,
        cwd: row.cwd ? String(row.cwd) : undefined,
        allowedTools: row.allowed_tools ? String(row.allowed_tools) : undefined,
        lastPrompt: row.last_prompt ? String(row.last_prompt) : undefined,
        kind: row.kind ? (String(row.kind) as SessionKind) : "chat",
        pendingPermissions: new Map(),
        sessionAllowedTools: new Set(), // 预初始化,确保扩展副本能共享引用
      };
      this.sessions.set(session.id, session);
    }
  }

  computeAndSaveUsageSummary(sessionId: string): UsageSummary {
    const rows = (
      this.db
        .prepare(
          `select data from messages where session_id = ? order by created_at asc`,
        )
        .all(sessionId) as Array<{ data: string }>
    )
      .map((r) => {
        try {
          return JSON.parse(r.data);
        } catch {
          return null;
        }
      })
      .filter(Boolean);

    const skillsMap = new Map<string, number>();
    const memoriesMap = new Map<string, number>();
    const mcpMap = new Map<string, number>();
    const agentsMap = new Map<string, number>();
    const otherTools: Record<string, number> = {};

    for (const msg of rows) {
      if (msg.type !== "assistant") continue;
      const content = Array.isArray(msg.message?.content)
        ? msg.message.content
        : [];
      for (const block of content) {
        if (block.type !== "tool_use") continue;
        const name: string = block.name ?? "";
        const input = block.input ?? {};

        if (name === "Skill") {
          const skillName = (input.skill as string) || "unknown";
          skillsMap.set(skillName, (skillsMap.get(skillName) ?? 0) + 1);
        } else if (name === "Read") {
          const fp: string = (input.file_path as string) || "";
          if (fp.includes("/memory/") || fp.includes("\\memory\\")) {
            const fileName = fp.split(/[\\/]/).pop() ?? fp;
            memoriesMap.set(fileName, (memoriesMap.get(fileName) ?? 0) + 1);
          }
        } else if (name.startsWith("mcp__")) {
          mcpMap.set(name, (mcpMap.get(name) ?? 0) + 1);
        } else if (name === "Agent") {
          const desc: string = (input.description as string) || "agent";
          agentsMap.set(desc, (agentsMap.get(desc) ?? 0) + 1);
        } else if (name) {
          otherTools[name] = (otherTools[name] ?? 0) + 1;
        }
      }
    }

    const toList = (m: Map<string, number>): UsageSummaryItem[] =>
      Array.from(m.entries()).map(([name, count]) => ({ name, count }));

    const summary: UsageSummary = {
      skills: toList(skillsMap),
      memories: toList(memoriesMap),
      mcpTools: toList(mcpMap),
      agents: toList(agentsMap),
      otherTools,
    };

    this.db
      .prepare(
        `insert or replace into session_usage (session_id, summary, created_at) values (?, ?, ?)`,
      )
      .run(sessionId, JSON.stringify(summary), Date.now());

    return summary;
  }

  getUsageSummary(sessionId: string): UsageSummary | null {
    const row = this.db
      .prepare(`select summary from session_usage where session_id = ?`)
      .get(sessionId) as { summary: string } | undefined;
    if (!row) return null;
    try {
      return JSON.parse(row.summary) as UsageSummary;
    } catch {
      return null;
    }
  }

  saveChangedFiles(
    sessionId: string,
    files: import("@lenovo/agent-protocol").ChangedFile[],
  ): void {
    this.db
      .prepare(
        `update session_usage set changed_files = ? where session_id = ?`,
      )
      .run(JSON.stringify(files), sessionId);
  }

  getPersistedChangedFiles(
    sessionId: string,
  ): import("@lenovo/agent-protocol").ChangedFile[] | null {
    const row = this.db
      .prepare(`select changed_files from session_usage where session_id = ?`)
      .get(sessionId) as { changed_files: string | null } | undefined;
    if (!row?.changed_files) return null;
    try {
      return JSON.parse(row.changed_files);
    } catch {
      return null;
    }
  }

  getSetting(key: string): string | null {
    const row = this.db
      .prepare(`select value from settings where key = ?`)
      .get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  setSetting(key: string, value: string | null): void {
    if (value === null) {
      this.db.prepare(`delete from settings where key = ?`).run(key);
    } else {
      this.db
        .prepare(`insert or replace into settings (key, value) values (?, ?)`)
        .run(key, value);
    }
  }
}
