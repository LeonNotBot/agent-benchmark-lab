import Database from "better-sqlite3";
import { join } from "path";

/**
 * 宿主侧数据库连接工厂。
 *
 * 连接创建与 DB 路径决策集中在此；三个产品（localcoding/teamai/localclaw）
 * 各自调用，通过 DB_PATH 环境变量覆盖路径。永远留在 server，不进入 SDK。
 */
export function createDatabase(): Database.Database {
  const dbPath = process.env.DB_PATH ?? join(process.cwd(), "webui.db");
  const db = new Database(dbPath);
  // WAL 是连接级属性，归宿主而非迁移：即使产品跳过 SDK 迁移也应生效
  db.exec(`pragma journal_mode = WAL;`);
  return db;
}
