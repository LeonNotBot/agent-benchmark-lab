/**
 * SDK 表迁移已迁入 @lenovo/agent-sdk（database/database.migrations）。
 * 本文件只保留**宿主业务表**迁移（runBizMigrations），永远留在 server。
 *
 * 两者通过各自版本表（_sdk_migrations / _biz_migrations）独立演进：
 * SDK 升级推进 sdk 版本，业务迭代推进 biz 版本，互不干扰。
 */
import type Database from "better-sqlite3";
import { applyMigrations } from "@lenovo/agent-sdk";

// SDK 迁移转出口，保持既有 import 路径可用
export { runSdkMigrations } from "@lenovo/agent-sdk";

/**
 * 执行业务表迁移（含版本记录）。永远留在宿主 server，不进入 SDK。
 * 将来知识库等业务模块需要数据库时，在此处追加迁移条目。
 */
export function runBizMigrations(db: Database.Database): void {
  applyMigrations(db, "_biz_migrations", [
    // 业务迁移从 version 1 开始（与 SDK 版本号互不干扰）
    // 示例：
    // { version: 1, name: "init-knowledge-tables", up: (db) => { db.exec(`create table if not exists kb_datasets ...`) } },
  ]);
}
