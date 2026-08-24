import { type DynamicModule, Module } from "@nestjs/common";
import type Database from "better-sqlite3";
import { DatabaseModule } from "./database/database.module";
import { SessionModule } from "./core/session/session.module";
import { GitModule } from "./core/git/git.module";
import { RunnerModule } from "./capability/runner/runner.module";
import { RoutingModule } from "./capability/routing/routing.module";
import { WorkspaceModule } from "./capability/workspace/workspace.module";
import { ScheduledTaskModule } from "./capability/scheduled-task/scheduled-task.module";
import { DeployAgentModule } from "./capability/deploy-agent/deploy-agent.module";

/**
 * AgentModule —— SDK 能力的一站式聚合入口（@public，推荐宿主用这个）。
 *
 * 解决的问题：宿主原本要在 app.module 里手动 import 一长串 SDK 能力 module，
 * 还要正确编排 DatabaseModule.forRoot 与迁移顺序。AgentModule.forRoot 把这些
 * 收成一行，并以 **global** 形式 re-export 全部能力 Service —— 宿主任意模块
 * （含自己的 Controller）都能直接 @Inject 这些 Service，无需再逐个 import。
 *
 *   imports: [
 *     AgentModule.forRoot({ db }),   // ← 一行拿到 Session/Runner/Routing/...
 *     MyFeatureModule,               // 宿主自己的业务/Controller
 *   ]
 *
 * 不含传输层：WebsocketModule 依赖宿主业务（模板/语音/渠道贡献者），
 * 编排留在宿主侧（见 WebsocketModule.forRoot）。需要时宿主单独 import。
 */
@Module({})
export class AgentModule {
  /**
   * @param db            宿主创建的 better-sqlite3 连接（路径决策归宿主）。
   * @param runMigrations 是否执行 SDK 表迁移（默认 true，同步完成，早于消费 Service）。
   */
  static forRoot(opts: {
    db: Database.Database;
    runMigrations?: boolean;
  }): DynamicModule {
    const capabilities = [
      SessionModule,
      GitModule,
      RunnerModule,
      RoutingModule,
      WorkspaceModule,
      ScheduledTaskModule,
      DeployAgentModule,
    ];
    return {
      module: AgentModule,
      global: true,
      imports: [
        // DatabaseModule 自身已是 global，并在此跑 SDK 迁移（返回时表已就绪）。
        DatabaseModule.forRoot({ db: opts.db, runMigrations: opts.runMigrations }),
        ...capabilities,
      ],
      // re-export 能力 module：配合 global，宿主全局可注入这些 Service。
      exports: [DatabaseModule, ...capabilities],
    };
  }
}
