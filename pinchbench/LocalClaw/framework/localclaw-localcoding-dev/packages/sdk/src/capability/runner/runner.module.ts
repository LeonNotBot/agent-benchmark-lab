import { Module } from "@nestjs/common";
import { RunnerService } from "./runner.service";
import { RunnerSpawnService } from "./runner-spawn.service";
import { RunnerHostService } from "./runner-host.service";
import { TaskSnapshotWatcherService } from "./task-snapshot-watcher.service";
import { PreviewGuardService } from "./preview-guard.service";
import { RoutingModule } from "../routing/routing.module";
import { SessionModule } from "../../core/session/session.module";
import { WorkspaceModule } from "../workspace/workspace.module";

/**
 * Runner 能力模块（SDK）：CLI 进程管理。无 HTTP controller。
 */
@Module({
  imports: [RoutingModule, SessionModule, WorkspaceModule],
  providers: [RunnerService, RunnerSpawnService, RunnerHostService, TaskSnapshotWatcherService, PreviewGuardService],
  exports: [RunnerService, RunnerHostService, TaskSnapshotWatcherService],
})
export class RunnerModule {}
