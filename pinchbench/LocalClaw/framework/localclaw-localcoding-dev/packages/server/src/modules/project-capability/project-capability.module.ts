import { Module } from "@nestjs/common";
import { ProjectCapabilityModule as SdkProjectCapabilityModule } from "@lenovo/agent-sdk";
import { ProjectCapabilityController } from "./project-capability.controller";

/** 宿主 project-capability 模块：能力来自 SDK，controller 留宿主（模式 A）。 */
@Module({
  imports: [SdkProjectCapabilityModule],
  controllers: [ProjectCapabilityController],
  exports: [SdkProjectCapabilityModule],
})
export class ProjectCapabilityModule {}
