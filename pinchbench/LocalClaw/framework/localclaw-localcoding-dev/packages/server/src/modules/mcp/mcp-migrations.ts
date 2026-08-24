/**
 * MCP 模块数据库迁移。
 */
import type Database from "better-sqlite3";
import { applyMigrations, addColumnIfMissing } from "@lenovo/agent-sdk";
import type { Migration } from "@lenovo/agent-sdk";

const MCP_MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: "init-mcp-tables",
    up: (db) => {
      db.exec(
        `create table if not exists mcp_servers (
          id text primary key,
          name text not null,
          description text,
          type text not null check(type in ('stdio','sse','streamable_http')),
          command text,
          args text,
          env text,
          url text,
          headers text,
          sort_order integer default 0,
          created_at integer not null,
          updated_at integer not null
        )`,
      );
      db.exec(
        `create table if not exists mcp_tools (
          id text primary key,
          server_id text not null,
          name text not null,
          description text,
          input_schema text,
          risk text not null default 'read' check(risk in ('read','write','danger')),
          cached_at integer not null,
          foreign key (server_id) references mcp_servers(id) on delete cascade
        )`,
      );
      db.exec(`create index if not exists idx_mt_server on mcp_tools(server_id)`);
      db.exec(`create unique index if not exists idx_mt_server_name on mcp_tools(server_id, name)`);
    },
  },
];

export function runMcpMigrations(db: Database.Database): void {
  applyMigrations(db, "_mcp_migrations", MCP_MIGRATIONS);
}
