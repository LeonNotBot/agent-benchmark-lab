import { Module } from "@nestjs/common";
import { DeployAgentService } from "./deploy-agent.service";

/** 部署能力模块（SDK）。无 HTTP controller —— REST 路由由宿主编排（模式 A）。 */
@Module({
  providers: [DeployAgentService],
  exports: [DeployAgentService],
})
export class DeployAgentModule {}
