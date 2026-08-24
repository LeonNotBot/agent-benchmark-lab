import type Database from "better-sqlite3";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { applyMigrations, addColumnIfMissing, getAgentConfigDir } from "@lenovo/agent-sdk";
import type { Migration } from "@lenovo/agent-sdk";

/**
 * Channel 能力自有的数据库迁移（版本表 `_channel_migrations`）。
 *
 * 与核心 SDK 迁移（`_sdk_migrations`）独立演进：
 * - 核心包只管 sessions/messages/settings/session_usage 等表。
 * - channel 子包管 channels/chat_sessions 等表。
 * - 两者通过各自版本表互不干扰,可独立升级。
 *
 * 全部使用 IF NOT EXISTS / addColumnIfMissing，对旧数据库幂等安全。
 */

const CHANNEL_MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: "init-channel-tables",
    up: (db) => {
      db.exec(
        `create table if not exists channels (
          id text primary key,
          type text not null,
          name text not null,
          enabled integer default 1,
          credentials text not null,
          status text default 'disconnected',
          engine text default 'golembot',
          workspace_dir text default '',
          error_message text,
          created_at integer not null,
          updated_at integer not null
        )`,
      );
      db.exec(
        `create table if not exists chat_sessions (
          chat_id text not null,
          channel_id text not null,
          workspace_dir text not null,
          session_key text,
          created_at integer not null,
          updated_at integer not null,
          primary key (chat_id, channel_id)
        )`,
      );
    },
  },
  {
    version: 2,
    name: "add-channel-columns",
    up: (db) => {
      addColumnIfMissing(db, "channels", "engine", "engine text default 'golembot'");
      addColumnIfMissing(db, "channels", "workspace_dir", "workspace_dir text default ''");
      addColumnIfMissing(db, "channels", "error_message", "error_message text");
    },
  },
  {
    version: 3,
    name: "add-channel-messages-table",
    up: (db) => {
      db.exec(
        `create table if not exists channel_messages (
          id text primary key,
          channel_id text not null,
          channel_type text not null,
          chat_id text not null,
          sender_id text not null,
          direction text not null check(direction in ('incoming','outgoing')),
          message_type text not null default 'text' check(message_type in ('text','image','file','mixed')),
          content text not null,
          has_attachment integer default 0,
          attachment_info text,
          status text default 'unread' check(status in ('unread','read')),
          engine text not null check(engine in ('golembot','legacy')),
          created_at integer not null
        )`,
      );
      db.exec(`create index if not exists idx_cm_channel_chat on channel_messages(channel_id, chat_id)`);
      db.exec(`create index if not exists idx_cm_created_at on channel_messages(created_at)`);
      db.exec(`create index if not exists idx_cm_sender on channel_messages(sender_id)`);
    },
  },
  {
    version: 4,
    name: "migrate-wechat-to-golembot",
    up: (db) => {
      // 仅在微信 golembot 原生开关开启时迁移（迁移期回退用户不受影响）
      // legacy 开关已废弃，全部走 golembot，迁移不再处理 legacy 行

      const accountFile = join(getAgentConfigDir(), "channels", "weixin", "account.json");
      let accountToken = "";
      let accountBaseUrl = "https://ilinkai.weixin.qq.com";
      try {
        if (existsSync(accountFile)) {
          const acc = JSON.parse(readFileSync(accountFile, "utf-8"));
          accountToken = acc.token || "";
          accountBaseUrl = acc.baseUrl || accountBaseUrl;
        }
      } catch { /* account.json 不存在则跳过凭据迁移 */ }

      const rows = db.prepare("SELECT id, credentials FROM channels WHERE type = 'wechat' AND engine = 'legacy'").all() as { id: string; credentials: string }[];
      for (const row of rows) {
        let creds: Record<string, string> = {};
        try { creds = JSON.parse(row.credentials || "{}") as Record<string, string>; } catch { /* ignore */ }
        if (!creds.token && accountToken) {
          creds = { ...creds, token: accountToken, baseUrl: accountBaseUrl };
        }
        db.prepare("UPDATE channels SET engine = 'golembot', credentials = ? WHERE id = ?")
          .run(JSON.stringify(creds), row.id);
        console.log(`[channel-migrate] Migrated wechat channel ${row.id} to golembot engine`);
      }
    },
  },
];


/** 执行 channel 表迁移。由 ChannelModule 在初始化时调用。 */
export function runChannelMigrations(db: Database.Database): void {
  applyMigrations(db, "_channel_migrations", CHANNEL_MIGRATIONS);
}
