import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { migrateChannels } from "../migration";

describe("migrateChannels", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    db.exec(`CREATE TABLE channels (
      id TEXT PRIMARY KEY, type TEXT NOT NULL, name TEXT NOT NULL,
      enabled INTEGER, credentials TEXT NOT NULL, status TEXT,
      engine TEXT, workspace_dir TEXT,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    )`);
  });

  it("non-wechat 行的 engine 为 NULL 时设为 golembot", () => {
    db.prepare("INSERT INTO channels VALUES (?,?,?,?,?,?,?,?,?,?)").run(
      "a", "feishu", "n", 1, "{}", "disconnected", null, null, 0, 0
    );
    const result = migrateChannels(db);
    expect(result.updated).toBe(1);
    const row = db.prepare("SELECT engine FROM channels WHERE id='a'").get() as any;
    expect(row.engine).toBe("golembot");
  });

  it("wechat 行 engine 为 NULL 时：WECHAT_NATIVE=true（默认）则不改动", () => {
    db.prepare("INSERT INTO channels VALUES (?,?,?,?,?,?,?,?,?,?)").run(
      "w", "wechat", "n", 1, "{}", "disconnected", null, null, 0, 0
    );
    // WECHAT_ENGINE 未设置，默认 golembot，migrate() 不动微信行
    const result = migrateChannels(db);
    expect(result.updated).toBe(0);
    const row = db.prepare("SELECT engine FROM channels WHERE id='w'").get() as any;
    expect(row.engine).toBe(null); // 保持 NULL，由 channel-migrations.ts v4 处理
  });

  it("wechat 行已有 engine='golembot' 时：WECHAT_NATIVE=true 则不改动", () => {
    db.prepare("INSERT INTO channels VALUES (?,?,?,?,?,?,?,?,?,?)").run(
      "w2", "wechat", "n", 1, "{}", "disconnected", "golembot", "", 0, 0
    );
    const result = migrateChannels(db);
    expect(result.updated).toBe(0); // golembot 行不被改动
    const row = db.prepare("SELECT engine FROM channels WHERE id='w2'").get() as any;
    expect(row.engine).toBe("golembot");
  });

  it("wechat 行不再由旧迁移脚本处理（由 channel-migrations.ts v4 接管）", () => {
    db.prepare("INSERT INTO channels VALUES (?,?,?,?,?,?,?,?,?,?)").run(
      "w3", "wechat", "n", 1, "{}", "disconnected", null, null, 0, 0
    );
    // 旧 migrateChannels() 不再强制 wechat legacy（legacy 开关已废弃）
    const result = migrateChannels(db);
    expect(result.updated).toBe(0);
    const row = db.prepare("SELECT engine FROM channels WHERE id='w3'").get() as any;
    expect(row.engine).toBe(null); // 保持 NULL，由 channel-migrations.ts v4 后续处理
  });

  it("已有 engine 的行不变", () => {
    db.prepare("INSERT INTO channels VALUES (?,?,?,?,?,?,?,?,?,?)").run(
      "b", "feishu", "n", 1, "{}", "disconnected", "legacy", "", 0, 0
    );
    migrateChannels(db);
    const row = db.prepare("SELECT engine FROM channels WHERE id='b'").get() as any;
    expect(row.engine).toBe("legacy");
  });

  it("空字符串 engine 也被视作未设置", () => {
    db.prepare("INSERT INTO channels VALUES (?,?,?,?,?,?,?,?,?,?)").run(
      "c", "wecom", "n", 1, "{}", "disconnected", "", "", 0, 0
    );
    const result = migrateChannels(db);
    expect(result.updated).toBe(1);
    const row = db.prepare("SELECT engine FROM channels WHERE id='c'").get() as any;
    expect(row.engine).toBe("golembot");
  });

  it("非 wechat 行已有 engine='legacy' 时不改动", () => {
    db.prepare("INSERT INTO channels VALUES (?,?,?,?,?,?,?,?,?,?)").run(
      "f2", "feishu", "n", 1, "{}", "disconnected", "legacy", "", 0, 0
    );
    const result = migrateChannels(db);
    expect(result.updated).toBe(0);
    const row = db.prepare("SELECT engine FROM channels WHERE id='f2'").get() as any;
    expect(row.engine).toBe("legacy");
  });
});
