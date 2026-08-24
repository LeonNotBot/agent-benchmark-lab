import { Controller, Get, Post, Patch, Body, Query, Param, Inject, Res, NotFoundException } from "@nestjs/common";
import { SESSION_SERVICE, type ISessionService, GIT_SERVICE, type IGitService, TaskSnapshotWatcherService, ToolDiffService, SessionRevertService } from "@lenovo/agent-sdk";
import { FileChangeService } from "./file-change.service";
import { createReadStream, existsSync } from "fs";
import { extname } from "path";
import type { FileDiff } from "@lenovo/agent-protocol";

@Controller("api")
export class SessionController {
  constructor(
    @Inject(SESSION_SERVICE) private readonly sessionService: ISessionService,
    @Inject(FileChangeService) private readonly fileChangeService: FileChangeService,
    @Inject(GIT_SERVICE) private readonly gitService: IGitService,
    @Inject(TaskSnapshotWatcherService) private readonly taskWatcher: TaskSnapshotWatcherService,
    @Inject(ToolDiffService) private readonly toolDiffService: ToolDiffService,
    @Inject(SessionRevertService) private readonly revertService: SessionRevertService,
  ) {}

  @Get("health")
  health(): string { return "ok"; }

  @Get("sessions")
  listSessions() {
    const sessions = this.sessionService.listSessions();
    return { sessions };
  }

  @Get("sessions/:id/history")
  async getHistory(@Param("id") id: string) {
    const history = this.sessionService.getSessionHistory(id);
    if (!history) {
      throw new NotFoundException(`Session "${id}" not found`);
    }
    // diff 不在此同步计算：getWorkingDiff 对大/慢的工作区可能耗时数秒，会阻塞会话打开。
    // 改为前端拿到 messages 后，单独异步拉取 GET /sessions/:id/diff（见下）。
    // 按需读任务快照：刷新后会话进程可能已退出（watcher 已停），从磁盘恢复任务列表
    const tasks = history.session.claudeSessionId
      ? (await this.taskWatcher.readSnapshot(history.session.claudeSessionId).catch(() => null)) ?? []
      : [];
    return {
      sessionId: id,
      status: history.session.status,
      messages: history.messages,
      diffs: [] as FileDiff[],
      tasks,
    };
  }

  // 会话工作区 diff：从 history 接口拆出来单独异步拉取，避免 git diff 阻塞会话打开。
  @Get("sessions/:id/diff")
  async getDiff(@Param("id") id: string) {
    const session = this.sessionService.getSession(id);
    if (!session) throw new NotFoundException(`Session "${id}" not found`);
    // getWorkingDiff 内部已短路非 git 目录并对大/多文件设上限，这里无需再判断。
    const diffs = session.cwd
      ? await this.gitService.getWorkingDiff(session.cwd).catch(() => [] as FileDiff[])
      : ([] as FileDiff[]);
    return { sessionId: id, diffs };
  }

  // 会话工具累计 diff（Write/Edit/MultiEdit 重建，不依赖 git）：审查面板「上一轮」数据源。
  @Get("sessions/:id/session-diff")
  getSessionDiff(@Param("id") id: string) {
    const session = this.sessionService.getSession(id);
    if (!session) throw new NotFoundException(`Session "${id}" not found`);
    return { sessionId: id, diffs: this.toolDiffService.buildSessionDiff(id) };
  }

  // 按轮次拆分的 diff：对话流「已编辑 N 个文件」汇总卡片数据源。
  @Get("sessions/:id/round-diffs")
  getRoundDiffs(@Param("id") id: string) {
    const session = this.sessionService.getSession(id);
    if (!session) throw new NotFoundException(`Session "${id}" not found`);
    return { sessionId: id, rounds: this.toolDiffService.buildRoundDiffs(id) };
  }

  // 是否 git 仓库（撤销前置校验，4.png）。
  @Get("sessions/:id/git-check")
  async gitCheck(@Param("id") id: string) {
    const session = this.sessionService.getSession(id);
    if (!session?.cwd) return { isGit: false };
    return { isGit: await this.revertService.isGitRepo(session.cwd) };
  }

  // 撤销一轮编辑（依赖 git）：after 快照写服务端文件（按 roundKey 隔离），前端只持有 roundKey。
  @Post("sessions/:id/revert-round")
  async revertRound(@Param("id") id: string, @Body() body: { roundKey?: string; files?: string[] }) {
    const session = this.sessionService.getSession(id);
    if (!session) throw new NotFoundException(`Session "${id}" not found`);
    return this.revertService.revertRound(id, body?.roundKey ?? "", body?.files ?? []);
  }

  // 重新应用一轮：后端按 roundKey 从快照目录读回内容写盘。
  @Post("sessions/:id/reapply-round")
  async reapplyRound(@Param("id") id: string, @Body() body: { roundKey?: string }) {
    const session = this.sessionService.getSession(id);
    if (!session) throw new NotFoundException(`Session "${id}" not found`);
    return this.revertService.reapplyRound(id, body?.roundKey ?? "");
  }

  @Get("sessions/recent-cwd")
  recentCwd(@Query("limit") limitParam?: string) {
    const limit = limitParam ? Number(limitParam) : 8;
    const bounded = Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 20) : 8;
    return { cwds: this.sessionService.listRecentCwds(bounded) };
  }

  // 探测会话工作目录是否仍存在。无 cwd（纯 daily 会话）视为 ok，不挂横幅。
  @Get("sessions/:id/cwd-status")
  cwdStatus(@Param("id") id: string) {
    const session = this.sessionService.getSession(id);
    if (!session) throw new NotFoundException(`Session "${id}" not found`);
    const cwd = session.cwd;
    const exists = !cwd || existsSync(cwd);
    return { cwd: cwd ?? null, exists };
  }

  // 写回会话工作目录（「重新选择目录」用）。校验新目录存在后持久化。
  @Patch("sessions/:id/cwd")
  updateCwd(@Param("id") id: string, @Body() body: { cwd?: string }) {
    const session = this.sessionService.getSession(id);
    if (!session) throw new NotFoundException(`Session "${id}" not found`);
    const cwd = body?.cwd;
    if (!cwd || !existsSync(cwd)) {
      return { ok: false, error: "目录不存在" };
    }
    this.sessionService.updateSession(id, { cwd });
    return { ok: true, cwd };
  }

  @Post("sessions/title")
  async sessionTitle(@Body() body: { userInput?: string }) {
    const title = await this.sessionService.generateSessionTitle(body.userInput || null);
    return { title };
  }

  @Get("sessions/:id/usage")
  getUsageSummary(@Param("id") id: string) {
    return { summary: this.sessionService.getUsageSummary(id) };
  }

  @Get("sessions/:id/changed-files")
  getChangedFiles(@Param("id") id: string) {
    const session = this.sessionService.getSession(id);
    if (!session?.cwd) return { files: [] };
    if (this.fileChangeService.hasSnapshot(id)) {
      const result = this.fileChangeService.getChangedFiles(id, session.cwd);
      this.sessionService.saveChangedFiles(id, result.files);
      return result;
    }
    // snapshot gone (e.g. after restart): return persisted data
    const persisted = this.sessionService.getPersistedChangedFiles(id);
    return { files: persisted ?? [] };
  }

  @Get("sessions/:id/file-content")
  getFileContent(@Param("id") id: string, @Query("path") filePath: string) {
    const session = this.sessionService.getSession(id);
    if (!session?.cwd) return { error: "No workspace" };
    try {
      return this.fileChangeService.getFileContent(session.cwd, filePath);
    } catch (e: any) {
      return { error: e.message };
    }
  }

  @Get("sessions/:id/file-raw")
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getFileRaw(
    @Param("id") id: string,
    @Query("path") filePath: string,
    @Res() res: any,
  ) {
    const session = this.sessionService.getSession(id);
    if (!session?.cwd) { res.status(404).end(); return; }
    try {
      const absPath = this.fileChangeService.getFilePath(session.cwd, filePath);
      const ext = extname(absPath).toLowerCase();
      if (ext === ".html" || ext === ".htm") {
        const inlined = this.fileChangeService.getInlinedHtmlContent(session.cwd, absPath);
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.send(inlined);
        return;
      }
      const mimeMap: Record<string, string> = {
        ".pdf": "application/pdf",
        ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
        ".gif": "image/gif", ".svg": "image/svg+xml", ".webp": "image/webp",
        ".bmp": "image/bmp",
      };
      res.setHeader("Content-Type", mimeMap[ext] ?? "text/plain");
      createReadStream(absPath).pipe(res);
    } catch (e: any) {
      res.status(e.status ?? 500).end();
    }
  }
}
