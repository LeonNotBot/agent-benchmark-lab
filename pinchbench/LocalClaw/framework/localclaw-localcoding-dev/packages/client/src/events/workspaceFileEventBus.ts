/**
 * 全局工作区文件事件总线。
 *
 * AppShell 接收到 workspace.file.* 事件后派发到这里，
 * FileBrowserTab 等组件订阅后处理文件树更新。
 *
 * 使用浏览器原生 EventTarget 实现，轻量无依赖。
 * on() 返回取消订阅函数，避免 EventTarget.removeEventListener 的引用匹配问题
 * （内部包装了 listener，外部无法直接传原始引用移除）。
 */

import type { ServerEvent } from "@lenovo/agent-protocol";

type WorkspaceFileEventType =
  | "workspace.file.added"
  | "workspace.file.deleted"
  | "workspace.file.changed";

type WorkspaceFileEvent = Extract<ServerEvent, { type: WorkspaceFileEventType }>;
type WorkspaceFilePayload = WorkspaceFileEvent["payload"];

class WorkspaceFileEventBus extends EventTarget {
  dispatch(event: WorkspaceFileEvent): void {
    this.dispatchEvent(new CustomEvent(event.type, { detail: event.payload }));
  }

  /** 订阅事件，返回取消订阅函数。 */
  on(
    type: WorkspaceFileEventType,
    listener: (payload: WorkspaceFilePayload) => void,
  ): () => void {
    const wrapped = (e: Event) => listener((e as CustomEvent).detail);
    this.addEventListener(type, wrapped);
    return () => this.removeEventListener(type, wrapped);
  }
}

export const workspaceFileEventBus = new WorkspaceFileEventBus();
