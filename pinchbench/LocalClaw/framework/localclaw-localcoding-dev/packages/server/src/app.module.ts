import { Module, OnApplicationBootstrap } from "@nestjs/common";
import { ModuleRef } from "@nestjs/core";
import { ServeStaticModule } from "@nestjs/serve-static";
import { join, resolve } from "path";
import { existsSync } from "fs";
import { AgentModule } from "@lenovo/agent-sdk";
import { createDatabase } from "./modules/database/create-database";
import { runBizMigrations } from "./modules/database/database.migrations";
import { SessionModule } from "./modules/session/session.module";
import { WebsocketModule } from "./modules/websocket/websocket.module";
import { RoutingModule } from "./modules/routing/routing.module";
import { SkillModule } from "./modules/skill/skill.module";
import { SkillMarketModule } from "./modules/skill-market/skill-market.module";
import { SystemModule } from "./modules/system/system.module";
import { ChannelModule } from "./modules/channel/channel.module";
import { TemplateModule } from "./modules/template/template.module";
import { MemoryModule } from "./modules/memory/memory.module";
import { SecretModule } from "./modules/secret/secret.module";
import { ScheduledTaskModule } from "./modules/scheduled-task/scheduled-task.module";
import { WorkspaceModule } from "./modules/workspace/workspace.module";
import { KnowledgeModule } from "./modules/knowledge/knowledge.module";
import { GatewayModule } from "./modules/gateway/gateway.module";
import { DeployAgentModule } from "./modules/deploy-agent/deploy-agent.module";
import { TechStackModule } from "./modules/tech-stack/tech-stack.module";
import { McpModule } from "./modules/mcp/mcp.module";
import { TelemetryModule } from "./modules/telemetry/telemetry.module";
import { ProjectCapabilityModule } from "./modules/project-capability/project-capability.module";
import { PluginModule } from "./modules/plugin/plugin.module";
import { WorkspaceService } from "./modules/workspace/workspace.service";

const distDir = resolve(__dirname, "..", "dist");
const hasDistDir = existsSync(join(distDir, "index.html"));

// 宿主决定连接：三个产品唯一需要修改的地方是 DB_PATH 环境变量
const db = createDatabase();

// AgentModule.forRoot 一站式提供全部 SDK 能力（global 注入）：
// DATABASE 连接 + 会话/Runner/路由/工作区/定时任务/Git/Deploy。
// 原先散在 app.module 的 DatabaseModule.forRoot + RunnerModule + GitModule 等已收进此处。
const imports: any[] = [AgentModule.forRoot({ db }), SessionModule, WebsocketModule, RoutingModule, GatewayModule, DeployAgentModule, SkillModule, SkillMarketModule, SystemModule, ChannelModule, TemplateModule, MemoryModule, SecretModule, ScheduledTaskModule, WorkspaceModule, KnowledgeModule, TechStackModule, McpModule, TelemetryModule, ProjectCapabilityModule, PluginModule];

// 业务迁移必须在 SDK 迁移（forRoot 内已执行）之后运行，保证 SDK 表先就绪
runBizMigrations(db);

if (hasDistDir) {
  imports.push(
    ServeStaticModule.forRoot({
      rootPath: distDir,
      serveRoot: "/",
      exclude: ["/api/(.*)", "/ws", "/v1/(.*)"],
    }),
  );
}

@Module({ imports })
export class AppModule implements OnApplicationBootstrap {
  constructor(private readonly moduleRef: ModuleRef) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      const workspaceService = this.moduleRef.get(WorkspaceService, { strict: false });
      await workspaceService.cleanupOldSessions(7 * 24 * 60 * 60 * 1000);
    } catch { /* ignore */ }
  }
}

