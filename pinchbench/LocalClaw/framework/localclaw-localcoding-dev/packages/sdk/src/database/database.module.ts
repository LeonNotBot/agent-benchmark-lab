import { type DynamicModule, Module } from "@nestjs/common";
import type Database from "better-sqlite3";
import { runSdkMigrations } from "./database.migrations";

/** 注入 token：需要数据库的 Service 通过 @Inject(DATABASE) 获取共享连接。 */
export const DATABASE = "DATABASE";

/**
 * 数据库动态模块（连接反转设计）。
 *
 * 连接的创建与 DB 路径决策由**宿主**负责（见 create-database.ts），
 * 通过 forRoot({ db }) 注入。本模块不再 `new Database`，只把宿主连接
 * provide 出去并在构造期跑 SDK 表迁移。
 *
 * 这样三个产品（localcoding / teamai / localclaw）可各自决定库路径，
 * 业务模块（知识库等）也能注入同一个连接、与 SDK 表共享事务。
 * 将来抽 SDK 时，本模块 + runSdkMigrations 整体迁出，宿主侧零改动。
 */
@Module({})
export class DatabaseModule {
  /**
   * @param db          宿主创建的 better-sqlite3 连接
   * @param runMigrations 是否在此执行 SDK 表迁移（默认 true）。
   *                      better-sqlite3 同步执行，返回时表已就绪，
   *                      早于任何消费 Service 的构造。
   */
  static forRoot(opts: {
    db: Database.Database;
    runMigrations?: boolean;
  }): DynamicModule {
    if (opts.runMigrations !== false) {
      runSdkMigrations(opts.db);
    }
    return {
      module: DatabaseModule,
      global: true,
      providers: [{ provide: DATABASE, useValue: opts.db }],
      exports: [DATABASE],
    };
  }
}
