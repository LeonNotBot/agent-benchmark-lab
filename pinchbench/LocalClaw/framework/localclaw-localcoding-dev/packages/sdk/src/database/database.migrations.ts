import type Database from "better-sqlite3";
import { join, resolve, sep } from "path";
import { getWorkspaceRoot } from "../config/paths";

/**
 * 数据库 schema 初始化 + 迁移。
 *
 * 边界划分（为将来抽取 SDK 预留）：
 * - runSdkMigrations：SDK 拥有的表（session/channel 等核心能力），将来随 SDK 迁出。
 * - runBizMigrations：宿主业务表（知识库等），永远留在 server。
 *
 * 两者通过各自的版本表（_sdk_migrations / _biz_migrations）独立演进，
 * 互不干扰：SDK 升级只推进 sdk 版本，业务迭代只推进 biz 版本。
 */

// ── SDK 迁移定义 ──

/** 一条迁移：version 单调递增，up 幂等执行建表/改列。 */
export type Migration = {
  version: number;
  name: string;
  up: (db: Database.Database) => void;
};

/**
 * 若指定列不存在则添加。
 *
 * 取代历史上的 `try { ALTER TABLE } catch {}`：后者无法区分「列已存在」与真实错误。
 * 这里先用 PRAGMA table_info 精确判断，缺失才 ALTER，任何异常都是真实错误并向上抛出。
 */
export function addColumnIfMissing(
  db: Database.Database,
  table: string,
  column: string,
  columnDdl: string,
): void {
  const cols = db.prepare(`pragma table_info(${table})`).all() as Array<{
    name: string;
  }>;
  if (cols.some((c) => c.name === column)) return;
  db.exec(`alter table ${table} add column ${columnDdl}`);
}

/**
 * 通用迁移执行器：按版本表记录跳过已执行项，缺失的按 version 升序执行。
 * 每条迁移 + 版本写入在单个事务内完成，保证原子性。
 */
export function applyMigrations(
  db: Database.Database,
  versionTable: string,
  migrations: Migration[],
): void {
  db.exec(
    `create table if not exists ${versionTable} (
      version integer primary key,
      name text not null,
      applied_at integer not null
    )`,
  );
  const applied = new Set(
    (db.prepare(`select version from ${versionTable}`).all() as Array<{
      version: number;
    }>).map((r) => r.version),
  );
  const record = db.prepare(
    `insert into ${versionTable} (version, name, applied_at) values (?, ?, ?)`,
  );
  for (const m of [...migrations].sort((a, b) => a.version - b.version)) {
    if (applied.has(m.version)) continue;
    const tx = db.transaction(() => {
      m.up(db);
      record.run(m.version, m.name, Date.now());
    });
    tx();
  }
}

// ── SDK 迁移列表（将来随 SDK 迁出）──

const SDK_MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: "init-sdk-tables",
    up: (db) => {
      db.exec(
        `create table if not exists sessions (
          id text primary key,
          title text,
          claude_session_id text,
          status text not null,
          cwd text,
          allowed_tools text,
          last_prompt text,
          created_at integer not null,
          updated_at integer not null
        )`,
      );
      db.exec(
        `create table if not exists messages (
          id text primary key,
          session_id text not null,
          data text not null,
          created_at integer not null,
          foreign key (session_id) references sessions(id)
        )`,
      );
      db.exec(
        `create index if not exists messages_session_id on messages(session_id)`,
      );
      db.exec(
        `create table if not exists settings (
          key text primary key,
          value text not null
        )`,
      );
      db.exec(
        `create table if not exists session_usage (
          session_id text primary key,
          summary text not null,
          created_at integer not null,
          foreign key (session_id) references sessions(id)
        )`,
      );
    },
  },
  {
    version: 2,
    name: "add-session-usage-columns",
    up: (db) => {
      addColumnIfMissing(db, "session_usage", "changed_files", "changed_files text");
      addColumnIfMissing(db, "session_usage", "sandbox_dir", "sandbox_dir text");
      addColumnIfMissing(db, "session_usage", "diff_status", "diff_status text default 'none'");
    },
  },
  {
    version: 3,
    name: "add-session-kind-and-channel-columns",
    up: (db) => {
      addColumnIfMissing(db, "sessions", "kind", "kind text default 'chat'");
      // 数据回填：修正历史遗留数据
      db.exec(`update sessions set kind='channel' where allowed_tools='channel-daemon' and (kind is null or kind='chat')`);
      db.exec(`update sessions set kind='chat' where kind is null`);
    },
  },
  {
    version: 4,
    name: "promote-golembot-channel-sessions-to-chat",
    up: (db) => backfillGolembotChannelSessions(db),
  },
  {
    version: 5,
    name: "add-session-auto-cwd-column",
    up: (db) => {
      // auto_cwd=1 标记「用户没选项目、系统自动建的会话目录」（见 websocket.gateway
      // onSessionStart 的 !payload.cwd 分支）。这类目录不是用户显式选择的项目，
      // 故 listRecentCwds 会据此过滤，避免它出现在项目选择列表里。
      // 用户显式选择的目录一律 0（默认），哪怕恰好选进 workspace 内部。
      addColumnIfMissing(db, "sessions", "auto_cwd", "auto_cwd integer default 0");
      // 存量回填：老库没有此标记，靠路径一次性推断。历史上能落进
      // <workspace>/sessions/* 或 /cron/* 的唯一途径就是系统自动建目录，故置 1。
      backfillAutoCwdByPath(db);
    },
  },
];

/**
 * 存量回填 auto_cwd：老库无此标记，靠路径一次性推断历史会话是否为「自动建目录」。
 *
 * 依据：auto_cwd 语义是「用户没选项目、系统自动建的会话/任务目录」。新会话由
 * websocket.gateway 在创建时显式写标记，但存量会话没有这一信息，只能事后推断。
 * 而历史上 cwd 能落进 <workspace>/sessions/* 或 /cron/* 的唯一途径，就是
 * WorkspaceService.ensureSessionDir / ensureCronTaskDir 的自动建目录（用户当年
 * 并没有「浏览选进 workspace 内部」的入口），故这些一律回填为 1，其余保持 0。
 *
 * 幂等：只改 auto_cwd 仍为默认 0、且 cwd 命中自动目录前缀的行；重跑不会误改
 * 用户后来显式选中的目录（那些行 auto_cwd 已由 gateway 写成 0，且不在此前缀下）。
 */
function backfillAutoCwdByPath(db: Database.Database): void {
  const cols = (db.prepare(`pragma table_info(sessions)`).all() as Array<{ name: string }>)
    .map((c) => c.name);
  if (!cols.includes("cwd") || !cols.includes("auto_cwd")) return;

  let root: string;
  try {
    root = resolve(getWorkspaceRoot());
  } catch {
    return; // 取不到 workspace root（异常环境）时跳过，不阻断迁移。
  }
  const prefixes = ["sessions", "cron"].map((sub) => join(root, sub) + sep);

  const rows = db
    .prepare(`select id, cwd from sessions where cwd is not null and trim(cwd) != '' and auto_cwd = 0`)
    .all() as Array<{ id: string; cwd: string }>;
  const update = db.prepare(`update sessions set auto_cwd = 1 where id = ?`);
  for (const row of rows) {
    const target = resolve(String(row.cwd));
    if (prefixes.some((p) => target.startsWith(p))) update.run(row.id);
  }
}

/**
 * 回填历史 golembot 渠道会话（钉钉/企微/飞书），使其在前端会话列表可见且有标题。
 *
 * 背景：全量同步上线前，golembot 渠道会话以 kind='channel' + 占位标题 `IM <chatId>` 建立，
 * 既被 listSessions（只查 kind='chat'）过滤、又无内容标题，前端显示「(未命名)」。
 * 全量同步上线后新消息会自愈，但已落库的历史会话需一次性回填。
 *
 * 策略（保守）：仅升级「确有对话消息」的 channel 会话（避免把空壳会话灌进列表造成噪音）：
 * - kind: channel → chat；
 * - 标题：占位/空标题时，取首条用户消息内容生成可读标题（截断 40 字）。
 * 幂等：再次执行时这些会话已是 chat 且标题非占位，不会重复改动。
 */
function backfillGolembotChannelSessions(db: Database.Database): void {
  // 防御：依赖 sessions.title / sessions.kind / messages 表，缺任一则跳过（异常 schema 不报错）。
  const sessCols = (db.prepare(`pragma table_info(sessions)`).all() as Array<{ name: string }>)
    .map((c) => c.name);
  if (!sessCols.includes("title") || !sessCols.includes("kind")) return;
  const hasMessages = !!db
    .prepare(`select name from sqlite_master where type='table' and name='messages'`)
    .get();
  if (!hasMessages) return;

  const rows = db
    .prepare(
      `select s.id, s.title from sessions s
       where s.kind='channel'
         and exists (select 1 from messages m where m.session_id = s.id)`,
    )
    .all() as Array<{ id: string; title: string | null }>;
  const pickFirstUserText = db.prepare(
    `select data from messages where session_id = ? order by created_at asc`,
  );
  const update = db.prepare(`update sessions set kind='chat', title=?, updated_at=? where id=?`);
  for (const row of rows) {
    let title = (row.title ?? "").trim();
    if (!title || title.startsWith("IM ")) {
      title = deriveTitleFromMessages(
        pickFirstUserText.all(row.id) as Array<{ data: string }>,
      );
    }
    update.run(title, Date.now(), row.id);
  }
}

/** 从会话消息中取首条用户文本，生成 ≤40 字标题；取不到则回退「渠道对话」。 */
function deriveTitleFromMessages(rows: Array<{ data: string }>): string {
  for (const r of rows) {
    let msg: any;
    try {
      msg = JSON.parse(r.data);
    } catch {
      continue;
    }
    let text = "";
    if (msg?.type === "user_prompt" && typeof msg.prompt === "string") {
      text = msg.prompt;
    } else if (msg?.type === "user" && Array.isArray(msg?.message?.content)) {
      const block = msg.message.content.find(
        (b: any) => b?.type === "text" && typeof b.text === "string",
      );
      text = block?.text ?? "";
    }
    text = text.replace(/\s+/g, " ").trim();
    text = stripChannelSystemPrefix(text);
    if (text) return text.length > 40 ? text.slice(0, 40) + "…" : text;
  }
  return "渠道对话";
}

/**
 * 去除 golembot 给渠道消息加的系统前缀，如 `[System: This is a private ... ]`，
 * 还原真正的用户文本，避免标题全是相同的系统说明。
 */
function stripChannelSystemPrefix(text: string): string {
  return text.replace(/^\s*\[System:[^\]]*\]\s*/i, "").trim();
}

/**
 * 执行所有 SDK 表迁移（含版本记录）。
 *
 * 将来抽 SDK 时，此函数随 SDK_MIGRATIONS 整体迁出；
 * 宿主 server 在 DatabaseModule.forRoot 构造期调用。
 */
export function runSdkMigrations(db: Database.Database): void {
  applyMigrations(db, "_sdk_migrations", SDK_MIGRATIONS);
}

