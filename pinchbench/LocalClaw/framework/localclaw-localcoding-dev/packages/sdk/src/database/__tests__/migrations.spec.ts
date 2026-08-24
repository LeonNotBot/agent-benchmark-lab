import { describe, it, expect, beforeEach } from "vitest";
import BetterSqlite3 from "better-sqlite3";
import type Database from "better-sqlite3";
import {
  addColumnIfMissing,
  applyMigrations,
  runSdkMigrations,
  type Migration,
} from "../database.migrations";

/**
 * database.migrations 单测：用真实 in-memory SQLite 验证迁移机制。
 * 不 mock SQL —— 迁移逻辑的价值正在于真实落库行为，mock 会测了个寂寞。
 */

let db: Database.Database;

beforeEach(() => {
  db = new BetterSqlite3(":memory:");
});

const columns = (table: string): string[] =>
  (db.prepare(`pragma table_info(${table})`).all() as Array<{ name: string }>).map(
    (c) => c.name,
  );
const tableExists = (name: string): boolean =>
  !!db
    .prepare(`select name from sqlite_master where type='table' and name=?`)
    .get(name);

describe("addColumnIfMissing", () => {
  beforeEach(() => {
    db.exec(`create table t (id integer primary key)`);
  });

  it("列不存在时添加该列", () => {
    addColumnIfMissing(db, "t", "name", "name text");
    expect(columns("t")).toContain("name");
  });

  it("列已存在时跳过,不抛错且不重复添加", () => {
    addColumnIfMissing(db, "t", "name", "name text");
    // 第二次：应静默跳过
    expect(() => addColumnIfMissing(db, "t", "name", "name text")).not.toThrow();
    expect(columns("t").filter((c) => c === "name")).toHaveLength(1);
  });

  it("表不存在时抛真实错误(不被吞掉)", () => {
    expect(() =>
      addColumnIfMissing(db, "no_such_table", "x", "x text"),
    ).toThrow();
  });
});

describe("applyMigrations", () => {
  it("自动创建版本表", () => {
    applyMigrations(db, "_test_mig", []);
    expect(tableExists("_test_mig")).toBe(true);
  });

  it("按 version 升序执行,与数组顺序无关", () => {
    const order: number[] = [];
    const mk = (v: number): Migration => ({
      version: v,
      name: `m${v}`,
      up: () => order.push(v),
    });
    // 故意乱序传入
    applyMigrations(db, "_test_mig", [mk(3), mk(1), mk(2)]);
    expect(order).toEqual([1, 2, 3]);
  });

  it("已执行的版本跳过,只跑新增的", () => {
    const runs: number[] = [];
    const mk = (v: number): Migration => ({
      version: v,
      name: `m${v}`,
      up: () => runs.push(v),
    });
    applyMigrations(db, "_test_mig", [mk(1), mk(2)]);
    // 再次调用,追加 v3:只应执行 v3
    applyMigrations(db, "_test_mig", [mk(1), mk(2), mk(3)]);
    expect(runs).toEqual([1, 2, 3]);
    const versions = (
      db.prepare(`select version from _test_mig order by version`).all() as Array<{
        version: number;
      }>
    ).map((r) => r.version);
    expect(versions).toEqual([1, 2, 3]);
  });

  it("迁移内抛错时事务回滚:版本不被记录", () => {
    const boom: Migration = {
      version: 1,
      name: "boom",
      up: (d) => {
        d.exec(`create table half (x)`);
        throw new Error("mid-migration failure");
      },
    };
    expect(() => applyMigrations(db, "_test_mig", [boom])).toThrow(
      "mid-migration failure",
    );
    // 事务原子性:建表被回滚,版本未记录
    expect(tableExists("half")).toBe(false);
    expect(
      db.prepare(`select count(*) c from _test_mig`).get() as { c: number },
    ).toEqual({ c: 0 });
  });
});

describe("runSdkMigrations", () => {
  it("建出全部 SDK 表并推进到 version 5", () => {
    runSdkMigrations(db);
    for (const t of ["sessions", "messages", "settings", "session_usage"]) {
      expect(tableExists(t)).toBe(true);
    }
    // v2 给 session_usage 补的列
    expect(columns("session_usage")).toEqual(
      expect.arrayContaining(["changed_files", "sandbox_dir", "diff_status"]),
    );
    // v3 给 sessions 补的 kind 列
    expect(columns("sessions")).toContain("kind");
    const max = db
      .prepare(`select max(version) v from _sdk_migrations`)
      .get() as { v: number };
    expect(max.v).toBe(5);
  });

  it("重复调用幂等:不重复记录版本、不报错", () => {
    runSdkMigrations(db);
    expect(() => runSdkMigrations(db)).not.toThrow();
    const count = db
      .prepare(`select count(*) c from _sdk_migrations`)
      .get() as { c: number };
    expect(count.c).toBe(5);
  });

  it("v3 数据回填:channel-daemon 历史会话被标为 channel,其余为 chat", () => {
    // 先只跑到能插数据的状态(v1 建表),再插历史数据,然后全量迁移触发回填
    db.exec(
      `create table sessions (id text primary key, allowed_tools text)`,
    );
    db.prepare(
      `insert into sessions (id, allowed_tools) values (?, ?)`,
    ).run("s1", "channel-daemon");
    db.prepare(
      `insert into sessions (id, allowed_tools) values (?, ?)`,
    ).run("s2", "Read,Write");
    runSdkMigrations(db);
    const rows = db
      .prepare(`select id, kind from sessions order by id`)
      .all() as Array<{ id: string; kind: string }>;
    expect(rows).toEqual([
      { id: "s1", kind: "channel" },
      { id: "s2", kind: "chat" },
    ]);
  });

  it("v4 回填:有消息的 golembot channel 会话升级为 chat 并按用户消息生成标题", () => {
    runSdkMigrations(db);
    const now = Date.now();
    // c1: channel + 有消息(含 [System:] 前缀) → 升级 chat, 标题取真实用户文本
    // c2: channel + 有消息(user 块结构) → 升级 chat
    // c3: channel + 无消息 → 保持 channel(避免空壳灌进列表)
    // c4: 已是 chat + 有标题 → 不动
    db.prepare(
      `insert into sessions (id, title, status, kind, created_at, updated_at) values (?,?,?,?,?,?)`,
    ).run("c1", "IM oc_abc", "completed", "channel", now, now);
    db.prepare(
      `insert into sessions (id, title, status, kind, created_at, updated_at) values (?,?,?,?,?,?)`,
    ).run("c2", "IM cidm", "completed", "channel", now, now);
    db.prepare(
      `insert into sessions (id, title, status, kind, created_at, updated_at) values (?,?,?,?,?,?)`,
    ).run("c3", "IM empty", "idle", "channel", now, now);
    db.prepare(
      `insert into sessions (id, title, status, kind, created_at, updated_at) values (?,?,?,?,?,?)`,
    ).run("c4", "已有标题", "completed", "chat", now, now);
    const ins = db.prepare(
      `insert into messages (id, session_id, data, created_at) values (?,?,?,?)`,
    );
    ins.run("m1", "c1", JSON.stringify({ type: "user_prompt", prompt: "[System: private chat] 历史上的今天" }), now);
    ins.run(
      "m2",
      "c2",
      JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "text", text: "你好啊" }] } }),
      now,
    );
    // 二次执行 runSdkMigrations 触发 v4(版本表已记录到 4? 不会重跑) → 手动调一次回填逻辑：
    // 这里直接再次跑迁移不会重复执行 v4。改用独立 in-memory：插完数据后单独 applyMigrations。
    // 简化：因为 runSdkMigrations 已在上方执行过 v4，c1/c2 是之后插入的，需重置版本记录后重跑 v4。
    db.exec(`delete from _sdk_migrations where version=4`);
    runSdkMigrations(db);
    const rows = db
      .prepare(`select id, kind, title from sessions order by id`)
      .all() as Array<{ id: string; kind: string; title: string }>;
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(byId.c1).toEqual({ id: "c1", kind: "chat", title: "历史上的今天" });
    expect(byId.c2).toEqual({ id: "c2", kind: "chat", title: "你好啊" });
    expect(byId.c3.kind).toBe("channel"); // 无消息，保持
    expect(byId.c4).toEqual({ id: "c4", kind: "chat", title: "已有标题" }); // 不动
  });
});
