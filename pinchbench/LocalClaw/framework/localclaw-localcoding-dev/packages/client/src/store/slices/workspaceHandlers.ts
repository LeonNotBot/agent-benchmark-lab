import type { ServerEvent } from "@lenovo/agent-protocol";

/**
 * Workspace 事件处理器（stub）。
 *
 * workspace.file.* 事件由各组件直接订阅（通过自定义 hook），
 * 不走全局 store，所以这个 handler 当前只是占位兜底。
 *
 * 如果将来需要全局聚合文件变更（如跨面板通知），可在此实现。
 */
export function handleWorkspaceEvents(event: ServerEvent): boolean {
  switch (event.type) {
    case "workspace.file.added":
    case "workspace.file.deleted":
    case "workspace.file.changed":
      // 目前由 FileBrowserTab 通过自定义订阅直接处理，store 不处理
      return true;
    default:
      return false;
  }
}
