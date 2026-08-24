import { Module } from "@nestjs/common";
import { WorkspaceModule as SdkWorkspaceModule, GitModule } from "@lenovo/agent-sdk";
import { WorkspaceController } from "./workspace.controller";

/**
 * 宿主 workspace 模块：能力来自 SDK，HTTP 路由（Controller）留宿主（模式 A）。
 * - imports SdkWorkspaceModule：提供 WorkspaceService + WorkspaceWatcherService
 * - imports GitModule：controller 注入 GitService 需要
 * - re-export SdkWorkspaceModule：透传 WorkspaceWatcherService，供 websocket handler 注入
 */
@Module({
  imports: [SdkWorkspaceModule, GitModule],
  controllers: [WorkspaceController],
  exports: [SdkWorkspaceModule],
})
export class WorkspaceModule {}
