import { Module } from "@nestjs/common";
import { ScheduledTaskService, SCHEDULED_TASK_SERVICE } from "./scheduled-task.service";
import { ScheduledTaskRunnerService } from "./scheduled-task-runner.service";
import { CronMcpRegistrarService } from "./cron-mcp-registrar.service";
import { RunnerModule } from "../runner/runner.module";
import { SessionModule } from "../../core/session/session.module";
import { WorkspaceModule } from "../workspace/workspace.module";

/** 定时任务能力模块（SDK）。无 HTTP controller —— REST 路由由宿主编排（模式 A）。 */
@Module({
  imports: [RunnerModule, SessionModule, WorkspaceModule],
  providers: [
    ScheduledTaskService,
    ScheduledTaskRunnerService,
    CronMcpRegistrarService,
    { provide: SCHEDULED_TASK_SERVICE, useExisting: ScheduledTaskService },
  ],
  exports: [ScheduledTaskService, ScheduledTaskRunnerService, SCHEDULED_TASK_SERVICE],
})
export class ScheduledTaskModule {}
