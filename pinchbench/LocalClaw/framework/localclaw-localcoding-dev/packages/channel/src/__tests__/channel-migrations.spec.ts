import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { runSdkMigrations } from "@lenovo/agent-sdk";
import { runChannelMigrations } from "../channel-migrations";

function tableNames(db: Database.Database): string[] {
  return (
    db
      .prepare("select name from sqlite_master where type='table' order by name")
      .all() as Array<{ name: string }>
  ).map((r) => r.name);
}

describe("channel migration split", () => {
  it("核心迁移不创建 channel 表", () => {
    const db = new Database(":memory:");
    runSdkMigrations(db);
    const t = tableNames(db);
    expect(t).toContain("sessions");
    expect(t).toContain("messages");
    expect(t).not.toContain("channels");
    expect(t).not.toContain("chat_sessions");
  });

  it("channel 迁移创建 channels / chat_sessions", () => {
    const db = new Database(":memory:");
    runSdkMigrations(db);
    runChannelMigrations(db);
    const t = tableNames(db);
    expect(t).toContain("channels");
    expect(t).toContain("chat_sessions");
    // channels 表含拆分后保留的列
    const cols = (
      db.prepare("pragma table_info(channels)").all() as Array<{ name: string }>
    ).map((c) => c.name);
    expect(cols).toEqual(
      expect.arrayContaining(["engine", "workspace_dir", "error_message"]),
    );
  });

  it("重复执行幂等（含独立版本表）", () => {
    const db = new Database(":memory:");
    runSdkMigrations(db);
    runChannelMigrations(db);
    expect(() => {
      runChannelMigrations(db);
      runSdkMigrations(db);
    }).not.toThrow();
    const versionTables = tableNames(db).filter((n) => n.endsWith("migrations"));
    expect(versionTables).toEqual(
      expect.arrayContaining(["_sdk_migrations", "_channel_migrations"]),
    );
  });
});
