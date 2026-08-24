// TASK_SNAPSHOT_WATCHER —— 监听 CLI 写到磁盘的任务 JSON 目录，把全量任务快照推给前端。
//
// 背景：CLI（claude-cli）开启 CLAUDE_CODE_ENABLE_TASKS 后，会把每个任务写成独立 JSON
//   文件，落在 <CLAUDE_CONFIG_DIR>/tasks/<claudeSessionId>/<id>.json。这与 Claude Code
//   终端 UI 的数据源完全一致（终端用 fs.watch 监听同一目录）。本 service 充当“外部观察者”，
//   用 fs.watch + 轮询兜底监听该目录，读全量 JSON 后通过 WS `tasks.snapshot` 事件转发，
//   前端据此渲染任务卡片——彻底取代旧的“解析发给模型的 tool_result 文本”方案。
//
// 路径定位用的是 claudeSessionId（CLI 在 system/init 返回、与任务目录命名一致），
// 而 WS 事件 payload.sessionId 用 server 内部 sessionId（前端按它过滤）。

import { Injectable } from "@nestjs/common";
import { type FSWatcher, watch } from "fs";
import { readdir, readFile } from "fs/promises";
import { join } from "path";
import type { ServerEvent, TaskSnapshotItem } from "@lenovo/agent-protocol";
import { getClaudeConfigDir } from "../../config/paths";
import { logger } from "../../util/logger";

const DEBOUNCE_MS = 80;
// fs.watch 在某些平台/网络盘会漏事件，用轮询兜底（与 Claude Code useTasksV2 同思路）。
const FALLBACK_POLL_MS = 5000;

interface WatchEntry {
  sessionId: string;        // server 内部 sessionId，用于 WS payload + 前端过滤
  claudeSessionId: string;  // CLI 的 session id，用于定位任务目录
  dir: string;
  watcher: FSWatcher | null;
  debounceTimer: ReturnType<typeof setTimeout> | null;
  pollTimer: ReturnType<typeof setInterval> | null;
  // single-flight：同一 entry 同时只跑一个 readSnapshot。飞行中再来触发只置 rereadPending，
  // 读完补一次。既消除并发读乱序 emit（旧读后 resolve 覆盖新读），又省掉重复磁盘 I/O。
  reading: boolean;
  rereadPending: boolean;
}

@Injectable()
export class TaskSnapshotWatcherService {
  private readonly entries = new Map<string, WatchEntry>();
  private emitter: ((e: ServerEvent) => void) | null = null;

  setEmitter(fn: (e: ServerEvent) => void): void {
    this.emitter = fn;
  }

  /**
   * 开始监听某会话的任务目录。claudeSessionId 在 CLI system/init 后才可用，
   * 调用方应在拿到它时调用（早于任何任务创建）。重复调用同一 sessionId 幂等。
   */
  start(sessionId: string, claudeSessionId: string): void {
    if (!claudeSessionId) return;
    const existing = this.entries.get(sessionId);
    if (existing && existing.claudeSessionId === claudeSessionId) return;
    // claudeSessionId 变了（极少见）：先停旧的再建新的。stop() 同步 close、不 emit，
    // 旧目录数据是噪音；新 entry 立即 fetch 给出正确态。fetchAndEmit 的身份守卫
    // 会丢弃旧 entry 任何 in-flight 读的 emit。
    if (existing) this.stop(sessionId);

    const dir = join(getClaudeConfigDir(), "tasks", claudeSessionId);
    const entry: WatchEntry = {
      sessionId,
      claudeSessionId,
      dir,
      watcher: null,
      debounceTimer: null,
      pollTimer: null,
      reading: false,
      rereadPending: false,
    };
    this.entries.set(sessionId, entry);
    logger.log(`[task-watcher] start session=${sessionId} dir=${dir}`);

    this.tryWatch(entry);
    // 轮询兜底：覆盖目录尚不存在（watch 失败）和 fs.watch 漏事件两种情况
    entry.pollTimer = setInterval(() => {
      if (!entry.watcher) this.tryWatch(entry);
      void this.fetchAndEmit(entry);
    }, FALLBACK_POLL_MS);
    entry.pollTimer.unref?.();

    // 立即读一次（可能已有持久化任务，如续聊恢复）
    void this.fetchAndEmit(entry);
  }

  /**
   * 停止监听并清理。会话进程退出（killAndEvict）或 rewatch（claudeSessionId 变更）时调用。
   *
   * 同步 close，不做最终 flush——对齐本家 useTasksV2 的 #stop()（只 close+清 timer，不 emit）。
   * 「全部完成的最终态」由两条已有路径保证，无需在 stop 时抢读：
   *  1) 进程完成后仍驻留（runner-spawn 完成不 kill，idle 才回收），驻留期 5s 轮询会读到
   *     最终写盘并 emit——等真正 stop 时最终态早已推送过。
   *  2) 冷恢复（刷新/切回会话）走 session.history REST 读盘（readSnapshot），无 race。
   * 之前在此处做异步 flush 反而引入「旧目录数据竞态覆盖新会话」「空目录抹列表」等 race，故移除。
   */
  stop(sessionId: string): void {
    const entry = this.entries.get(sessionId);
    if (!entry) return;
    entry.watcher?.close();
    if (entry.debounceTimer) clearTimeout(entry.debounceTimer);
    if (entry.pollTimer) clearInterval(entry.pollTimer);
    this.entries.delete(sessionId);
    logger.log(`[task-watcher] stop session=${sessionId}`);
  }

  /** 尝试对目录建立 fs.watch；目录不存在会抛错，由轮询兜底重试。 */
  private tryWatch(entry: WatchEntry): void {
    if (entry.watcher) return;
    try {
      entry.watcher = watch(entry.dir, () => this.debouncedFetch(entry));
      entry.watcher.unref?.();
      entry.watcher.on("error", () => {
        entry.watcher?.close();
        entry.watcher = null; // 下次轮询重建
      });
    } catch {
      // 目录还没被 CLI 创建——轮询会重试，不算错误
      entry.watcher = null;
    }
  }

  private debouncedFetch(entry: WatchEntry): void {
    if (entry.debounceTimer) clearTimeout(entry.debounceTimer);
    // fs.watch 触发 = 真实变更，fromChange:true → 读期间到来会武装补读，不漏最后一个事件。
    entry.debounceTimer = setTimeout(() => void this.fetchAndEmit(entry, true), DEBOUNCE_MS);
    entry.debounceTimer.unref?.();
  }

  /**
   * 读目录下全部任务 JSON 并整体推送。single-flight：同一 entry 同时只跑一个读。
   * fromChange 区分触发来源：
   *  - fs.watch 变更（debouncedFetch）→ true：读期间到来要置 rereadPending，读完补一次，
   *    否则这次变更（可能是最后一个事件、之后无触发）会被漏掉。
   *  - 5s 轮询兜底 / start 立即读 → false：读已在飞时直接跳过，不补读。轮询是心跳，
   *    在飞的读已满足其目的；若它也武装 rereadPending，慢盘上会对零变更目录无限重读。
   */
  private async fetchAndEmit(entry: WatchEntry, fromChange = false): Promise<void> {
    // 身份守卫（发起前）：sessionId 会被 warm pool 复用，光查 key 在不在不够——
    // 必须确认这个 entry 仍是该 sessionId 当前指向的对象，否则旧回调会污染新会话。
    if (this.entries.get(entry.sessionId) !== entry) return;
    // single-flight：已有读在飞 → 仅真实变更触发才标记待重读，由在飞的读收尾补一次；
    // 轮询心跳（fromChange=false）直接返回，不武装重读。
    if (entry.reading) {
      if (fromChange) entry.rereadPending = true;
      return;
    }
    entry.reading = true;
    try {
      do {
        entry.rereadPending = false;
        const tasks = await this.readSnapshot(entry.claudeSessionId);
        if (tasks === null) continue; // 目录不存在/不可读：本轮跳过（若有 pending 会再读）
        // 身份守卫（emit 前）：await 期间 start() 可能用同一 sessionId 重建了 entry → 丢弃。
        if (this.entries.get(entry.sessionId) !== entry) return;
        this.emitter?.({
          type: "tasks.snapshot",
          payload: { sessionId: entry.sessionId, tasks },
        });
      } while (entry.rereadPending && this.entries.get(entry.sessionId) === entry);
    } finally {
      entry.reading = false;
    }
  }

  /**
   * 按需读取某会话任务目录的全量快照（纯读，不 emit）。
   * 供 history REST 端点在会话进程已退出时恢复任务列表（刷新后任务不丢）。
   * 返回 null 表示目录不存在/不可读；返回 [] 表示无任务。
   */
  async readSnapshot(claudeSessionId: string): Promise<TaskSnapshotItem[] | null> {
    if (!claudeSessionId) return null;
    const dir = join(getClaudeConfigDir(), "tasks", claudeSessionId);
    let files: string[];
    try {
      files = (await readdir(dir)).filter((f) => f.endsWith(".json"));
    } catch {
      return null; // 目录不存在 / 不可读
    }

    const tasks: TaskSnapshotItem[] = [];
    for (const file of files) {
      // 跨进程读：CLI 可能正在写，读到半个文件会 parse 失败——跳过，下次补上
      try {
        const raw = await readFile(join(dir, file), "utf-8");
        const t = JSON.parse(raw);
        if (!t || typeof t.id !== "string" || typeof t.status !== "string") continue;
        if (t.metadata?._internal) continue; // 与 CLI 一致：过滤内部任务
        tasks.push({
          id: t.id,
          subject: typeof t.subject === "string" ? t.subject : "",
          description: typeof t.description === "string" ? t.description : undefined,
          status: t.status,
          activeForm: typeof t.activeForm === "string" ? t.activeForm : undefined,
          owner: typeof t.owner === "string" ? t.owner : undefined,
          blockedBy: Array.isArray(t.blockedBy) ? t.blockedBy : undefined,
          critical: t.critical === true ? true : undefined,
        });
      } catch {
        continue;
      }
    }

    tasks.sort((a, b) => (Number(a.id) || 0) - (Number(b.id) || 0));
    return tasks;
  }
}
