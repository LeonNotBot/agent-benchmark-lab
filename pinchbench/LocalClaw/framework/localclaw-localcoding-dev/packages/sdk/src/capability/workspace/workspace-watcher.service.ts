import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { watch as chokidarWatch, type FSWatcher } from "chokidar";
import { logger } from "../../util/logger";

/** 文件系统变更类型。 */
export type WorkspaceFileChangeType = "added" | "deleted" | "changed";

/** 单次文件变更事件（领域事件，传输无关）。 */
export interface WorkspaceFileChange {
  type: WorkspaceFileChangeType;
  /** 变更的文件/目录绝对路径。 */
  path: string;
  /** 是否为目录（changed 事件恒为 false）。 */
  isDir: boolean;
}

/** 变更回调。 */
export type WorkspaceFileChangeListener = (change: WorkspaceFileChange) => void;

/**
 * 工作区文件系统监听能力（SDK capability 层）。
 *
 * 职责：用 chokidar 监听目录，将文件 add/unlink/change 以领域事件
 * （WorkspaceFileChange）回调出去。传输无关——不认识 WebSocket / ServerEvent，
 * 由宿主的事件处理器把领域事件翻译成传输层协议事件（模式 A：能力在 SDK，编排在宿主）。
 *
 * 实现策略：
 * - 每个唯一 path 只创建一个 watcher，多个订阅共享（引用计数）。
 * - listener 以首次订阅为准：上层 emit 走广播语义（发给所有在线 WS 客户端），
 *   存哪个 listener 无关紧要——任何一路触发都等价于通知所有人。
 * - 最后一个订阅取消时才真正关闭 watcher。
 * - 忽略 node_modules/.git 等目录，防止性能问题。
 */
@Injectable()
export class WorkspaceWatcherService implements OnModuleDestroy {
  // path -> { watcher, refCount, listener }
  private watchers = new Map<string, { watcher: FSWatcher; refCount: number; listener: WorkspaceFileChangeListener }>();

  /**
   * 订阅某个目录的文件变更。
   * 多次订阅同一路径会增加引用计数，共享同一个 watcher（listener 以首次订阅为准）。
   */
  watch(path: string, listener: WorkspaceFileChangeListener): void {
    const existing = this.watchers.get(path);
    if (existing) {
      existing.refCount++;
      logger.log(`[workspace-watcher] path "${path}" refCount -> ${existing.refCount}`);
      return;
    }

    logger.log(`[workspace-watcher] starting watch on "${path}"`);

    const watcher = chokidarWatch(path, {
      ignored: /(^|[\/\\])(node_modules|\.git|dist|build|\.next|out|__pycache__|\.cache|coverage|\.turbo|\.vite)([\/\\]|$)/,
      persistent: true,
      ignoreInitial: true, // 只关心后续变更，不推送初始扫描
      awaitWriteFinish: {
        stabilityThreshold: 100, // 文件写入稳定后 100ms 才触发（防抖）
        pollInterval: 50,
      },
      depth: 10, // 最大递归深度
    });

    const emit = (change: WorkspaceFileChange) => {
      const entry = this.watchers.get(path);
      entry?.listener(change);
    };

    watcher
      .on("add", (p) => emit({ type: "added", path: p, isDir: false }))
      .on("addDir", (p) => emit({ type: "added", path: p, isDir: true }))
      .on("unlink", (p) => emit({ type: "deleted", path: p, isDir: false }))
      .on("unlinkDir", (p) => emit({ type: "deleted", path: p, isDir: true }))
      .on("change", (p) => emit({ type: "changed", path: p, isDir: false }))
      .on("error", (error) => {
        logger.error(`[workspace-watcher] error on "${path}":`, error);
      });

    this.watchers.set(path, { watcher, refCount: 1, listener });
  }

  /**
   * 取消订阅某个目录。
   * 引用计数归零时才真正关闭 watcher。
   */
  unwatch(path: string): void {
    const entry = this.watchers.get(path);
    if (!entry) {
      logger.warn(`[workspace-watcher] unwatch called on non-watched path "${path}"`);
      return;
    }

    entry.refCount--;
    logger.log(`[workspace-watcher] path "${path}" refCount -> ${entry.refCount}`);

    if (entry.refCount <= 0) {
      logger.log(`[workspace-watcher] stopping watch on "${path}"`);
      entry.watcher.close().catch((e) => {
        logger.error(`[workspace-watcher] failed to close watcher for "${path}":`, e);
      });
      this.watchers.delete(path);
    }
  }

  /** 模块销毁时关闭所有 watcher。 */
  onModuleDestroy(): void {
    logger.log(`[workspace-watcher] closing ${this.watchers.size} watchers`);
    for (const [path, { watcher }] of this.watchers) {
      watcher.close().catch((e) => {
        logger.error(`[workspace-watcher] failed to close watcher for "${path}":`, e);
      });
    }
    this.watchers.clear();
  }
}
