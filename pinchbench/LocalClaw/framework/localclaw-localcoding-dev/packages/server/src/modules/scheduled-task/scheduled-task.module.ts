import { Module } from "@nestjs/common";
import { ScheduledTaskModule as SdkScheduledTaskModule } from "@lenovo/agent-sdk";
import { ScheduledTaskController } from "./scheduled-task.controller";

/** 宿主 scheduled-task 模块：能力来自 SDK，controller 留宿主（模式 A）。 */
@Module({
  imports: [SdkScheduledTaskModule],
  controllers: [ScheduledTaskController],
  exports: [SdkScheduledTaskModule],
})
export class ScheduledTaskModule {}
