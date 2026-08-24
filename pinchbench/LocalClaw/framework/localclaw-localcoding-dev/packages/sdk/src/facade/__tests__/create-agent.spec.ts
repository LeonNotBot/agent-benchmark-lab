import { describe, it, expect } from "vitest";
import BetterSqlite3 from "better-sqlite3";
import { createAgent } from "../create-agent";

/**
 * create-agent 门面契约测试。
 *
 * 范围:仅覆盖「不依赖 CLI 子进程」的公共契约 —— 参数校验、boot/dispose、
 * 连接所有权(ownsDb)。run() 会 spawn 真实 Claude CLI,属集成测试范畴,不在此列。
 */

describe("createAgent — 参数校验", () => {
  it("既无 db 也无 dbPath 时抛出明确错误", async () => {
    await expect(createAgent({})).rejects.toThrow(/需要提供 db 或 dbPath/);
  });
});

describe("createAgent — boot/dispose 与连接所有权", () => {
  it("传入外部 db 可成功 boot;lastSessionId 初始为 undefined", async () => {
    const db = new BetterSqlite3(":memory:");
    const agent = await createAgent({ db });
    try {
      expect(agent.lastSessionId).toBeUndefined();
      expect(typeof agent.run).toBe("function");
    } finally {
      await agent.dispose();
    }
    // ownsDb=false:dispose 不应关闭外部传入的连接,仍可查询
    expect(() => db.prepare("select 1").get()).not.toThrow();
    db.close();
  });

  it("boot 时自动跑 SDK 迁移:sessions 表已就绪", async () => {
    const db = new BetterSqlite3(":memory:");
    const agent = await createAgent({ db });
    try {
      const exists = db
        .prepare(
          `select name from sqlite_master where type='table' and name='sessions'`,
        )
        .get();
      expect(exists).toBeTruthy();
    } finally {
      await agent.dispose();
      db.close();
    }
  });
});
