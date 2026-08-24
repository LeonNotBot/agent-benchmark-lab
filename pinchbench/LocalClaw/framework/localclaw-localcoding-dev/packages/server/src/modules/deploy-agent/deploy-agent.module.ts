import { Module } from "@nestjs/common";
import { DeployAgentModule as SdkDeployAgentModule } from "@lenovo/agent-sdk";
import { DeployAgentController } from "./deploy-agent.controller";

/** 宿主 deploy-agent 模块：能力来自 SDK，controller 留宿主（模式 A）。 */
@Module({
  imports: [SdkDeployAgentModule],
  controllers: [DeployAgentController],
  exports: [SdkDeployAgentModule],
})
export class DeployAgentModule {}
