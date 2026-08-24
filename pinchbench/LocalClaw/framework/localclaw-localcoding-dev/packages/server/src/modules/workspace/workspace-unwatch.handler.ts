import { Injectable, Inject } from "@nestjs/common";
import { WorkspaceWatcherService } from "@lenovo/agent-sdk";
import type { WsEventHandler } from "@lenovo/agent-sdk";

/**
 * workspace.unwatch 事件处理器（宿主侧编排层）。
 * 桥接前端取消订阅请求到 SDK 的 WorkspaceWatcherService。
 */
@Injectable()
export class WorkspaceUnwatchHandler implements WsEventHandler {
  readonly type = "workspace.unwatch";

  constructor(
    @Inject(WorkspaceWatcherService)
    private readonly watcherService: WorkspaceWatcherService,
  ) {}

  handle(payload: unknown): void {
    const { path } = (payload ?? {}) as { path: string };
    if (!path) return;
    this.watcherService.unwatch(path);
  }
}
