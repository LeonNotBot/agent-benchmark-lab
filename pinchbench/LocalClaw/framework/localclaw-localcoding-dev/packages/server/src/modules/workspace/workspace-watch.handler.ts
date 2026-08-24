import { Injectable, Inject } from "@nestjs/common";
import { WorkspaceWatcherService } from "@lenovo/agent-sdk";
import type { WsEventHandler } from "@lenovo/agent-sdk";
import type { ServerEvent } from "@lenovo/agent-protocol";

/**
 * workspace.watch 事件处理器（宿主侧编排层）。
 * 桥接前端订阅请求到 SDK 的 WorkspaceWatcherService，将领域事件翻译成 ServerEvent。
 */
@Injectable()
export class WorkspaceWatchHandler implements WsEventHandler {
  readonly type = "workspace.watch";

  constructor(
    @Inject(WorkspaceWatcherService)
    private readonly watcherService: WorkspaceWatcherService,
  ) {}

  handle(
    payload: unknown,
    emit: (event: ServerEvent) => void,
  ): void {
    const { path } = (payload ?? {}) as { path: string };
    if (!path) return;

    // 订阅 SDK 的领域事件，翻译成 WebSocket 传输层事件
    this.watcherService.watch(path, (change) => {
      if (change.type === "added") {
        emit({ type: "workspace.file.added", payload: { path: change.path, isDir: change.isDir } });
      } else if (change.type === "deleted") {
        emit({ type: "workspace.file.deleted", payload: { path: change.path, isDir: change.isDir } });
      } else if (change.type === "changed") {
        emit({ type: "workspace.file.changed", payload: { path: change.path } });
      }
    });
  }
}
