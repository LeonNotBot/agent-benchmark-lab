import { Module } from "@nestjs/common";
import { WorkspaceService, WORKSPACE_SERVICE } from "./workspace.service";
import { WorkspaceWatcherService } from "./workspace-watcher.service";
import { GitModule } from "../../core/git/git.module";

/**
 * 工作空间能力模块（SDK）。不含 HTTP controller —— REST 路由由宿主编排（模式 A）。
 * 同时以 WORKSPACE_SERVICE 令牌 re-provide 同一单例（useExisting），供接口注入。
 * 新增 WorkspaceWatcherService：文件系统监听能力（chokidar），供宿主编排 WebSocket 推送。
 */
@Module({
  imports: [GitModule],
  providers: [
    WorkspaceService,
    { provide: WORKSPACE_SERVICE, useExisting: WorkspaceService },
    WorkspaceWatcherService,
  ],
  exports: [WorkspaceService, WORKSPACE_SERVICE, WorkspaceWatcherService],
})
export class WorkspaceModule {}
