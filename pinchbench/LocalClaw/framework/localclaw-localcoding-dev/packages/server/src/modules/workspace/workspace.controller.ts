import { Controller, Post, Get, Body, Query, Inject, Res } from "@nestjs/common";
import type { Response } from "express";
import { execFile } from "child_process";
import { promisify } from "util";
import { existsSync } from "fs";
import { GIT_SERVICE, type IGitService, WORKSPACE_SERVICE, type IWorkspaceService } from "@lenovo/agent-sdk";

const execFileAsync = promisify(execFile);

function openCmd(filePath: string): { cmd: string; args: string[] } {
  if (process.platform === "win32") return { cmd: "cmd", args: ["/c", "start", "", filePath] };
  if (process.platform === "darwin") return { cmd: "open", args: [filePath] };
  return { cmd: "xdg-open", args: [filePath] };
}

// 打开文件所在文件夹并高亮选中该文件。
// Windows: explorer /select,<path>；macOS: open -R <path>；
// Linux 无统一的「选中」协议，回退为打开父目录。
function revealCmd(filePath: string): { cmd: string; args: string[] } {
  if (process.platform === "win32") return { cmd: "explorer", args: [`/select,${filePath}`] };
  if (process.platform === "darwin") return { cmd: "open", args: ["-R", filePath] };
  const dir = filePath.replace(/\\/g, "/").replace(/\/[^/]*$/, "") || "/";
  return { cmd: "xdg-open", args: [dir] };
}

@Controller("api")
export class WorkspaceController {
  constructor(
    @Inject(GIT_SERVICE) private readonly gitService: IGitService,
    @Inject(WORKSPACE_SERVICE) private readonly workspaceService: IWorkspaceService,
  ) {}

  @Post("workspace/open-file")
  async openFile(@Body() body: { path: string }): Promise<{ ok: boolean }> {
    try {
      const { cmd, args } = openCmd(body.path);
      await execFileAsync(cmd, args);
      return { ok: true };
    } catch {
      return { ok: false };
    }
  }

  @Post("workspace/open-dir")
  async openDir(@Body() body: { path: string }): Promise<{ ok: boolean }> {
    try {
      const { cmd, args } = openCmd(body.path);
      await execFileAsync(cmd, args);
      return { ok: true };
    } catch {
      return { ok: false };
    }
  }

  @Post("workspace/reveal-file")
  async revealFile(@Body() body: { path: string }): Promise<{ ok: boolean }> {
    if (!body?.path) return { ok: false };
    const { cmd, args } = revealCmd(body.path);
    try {
      await execFileAsync(cmd, args);
      return { ok: true };
    } catch {
      // Windows explorer /select 成功时也可能返回非 0 退出码，视为已触发。
      if (process.platform === "win32") return { ok: true };
      return { ok: false };
    }
  }

  @Get("git/status")
  async gitStatus(@Query("cwd") cwd: string): Promise<{ isRepo: boolean; currentBranch: string; isEmpty: boolean }> {
    if (!cwd) return { isRepo: false, currentBranch: "", isEmpty: false };
    const isRepo = await this.gitService.isGitRepo(cwd);
    const currentBranch = isRepo ? await this.gitService.getCurrentBranch(cwd) : "";
    let isEmpty = false;
    try {
      const { readdirSync } = await import("fs");
      isEmpty = readdirSync(cwd).length === 0;
    } catch { /* ignore */ }
    return { isRepo, currentBranch, isEmpty };
  }

  @Get("workspace/tree")
  async getTree(
    @Query("path") path: string,
    @Query("depth") depth: string,
  ): Promise<{ nodes: Array<{ name: string; path: string; isDir: boolean; size?: number }> }> {
    if (!path) return { nodes: [] };
    const nodes = await this.workspaceService.listDir(path);
    return { nodes };
  }

  @Get("workspace/search")
  async searchFiles(
    @Query("cwd") cwd: string,
    @Query("q") q: string,
    @Query("limit") limit?: string,
  ): Promise<{ results: Array<{ name: string; path: string; relativePath: string; isDir: boolean }> }> {
    if (!cwd || !q) return { results: [] };
    const n = limit ? parseInt(limit, 10) : undefined;
    const results = await this.workspaceService.searchFiles(cwd, q, Number.isNaN(n as number) ? undefined : n);
    return { results };
  }

  @Get("workspace/file-content")
  async getFileContent(
    @Query("path") filePath: string,
    @Query("cwd") cwd?: string,
  ): Promise<{ content: string; encoding: string; size: number }> {
    if (!filePath) return { content: "", encoding: "utf8", size: 0 };
    return this.workspaceService.readFileContent(filePath, cwd);
  }

  @Get("git/diff")
  async getGitDiff(@Query("cwd") cwd: string): Promise<{ diffs: import("@lenovo/agent-protocol").FileDiff[] }> {
    if (!cwd) return { diffs: [] };
    // getWorkingDiff 内部已短路非 git 目录，无需在此再判断（避免双 spawn）。
    const diffs = await this.gitService.getWorkingDiff(cwd);
    return { diffs };
  }

  @Get("git/repo-info")
  async getRepoInfo(
    @Query("path") cwd: string,
  ): Promise<{ isRepo: boolean; suggestedCommitMsg?: string; currentBranch?: string }> {
    if (!cwd) return { isRepo: false };
    const isRepo = await this.gitService.isGitRepo(cwd);
    if (!isRepo) return { isRepo: false };
    const currentBranch = await this.gitService.getCurrentBranch(cwd);
    let suggestedCommitMsg: string | undefined;
    try {
      suggestedCommitMsg = await Promise.race([
        this.gitService.generateCommitMessage(cwd, []),
        new Promise<string>((_, reject) => setTimeout(() => reject(new Error("timeout")), 8000)),
      ]);
    } catch { /* ignore */ }
    return { isRepo: true, currentBranch, suggestedCommitMsg };
  }

  @Post("git/init")
  async gitInit(@Body() body: { path: string }): Promise<{ ok: boolean; createdReadme?: boolean; error?: string }> {
    if (!body.path) return { ok: false, error: "path is required" };
    try {
      await execFileAsync("git", ["init"], { cwd: body.path });

      const { readdirSync, writeFileSync } = await import("fs");
      const entries = readdirSync(body.path).filter(e => e !== ".git");
      let createdReadme = false;

      if (entries.length === 0) {
        writeFileSync(`${body.path}/README.md`, "# Project\n");
        createdReadme = true;
      }

      await execFileAsync("git", ["add", "."], { cwd: body.path });
      await execFileAsync("git", ["commit", "-m", "初始提交"], { cwd: body.path });

      return { ok: true, createdReadme };
    } catch (e: any) {
      return { ok: false, error: String(e.message ?? e) };
    }
  }

  @Post("git/commit")
  async gitCommit(@Body() body: { path: string; message: string }): Promise<{ ok: boolean; hash?: string; error?: string }> {
    if (!body.path || !body.message) return { ok: false, error: "path and message are required" };
    try {
      const hash = await this.gitService.commitChanges(body.path, body.message, []);
      return { ok: true, hash };
    } catch (e: any) {
      console.error("[git.commit] error:", e.message, e.stderr, e.stack);
      return { ok: false, error: e.message + (e.stderr ? " | " + e.stderr : "") };
    }
  }

  @Post("git/push")
  async gitPush(@Body() body: { path: string }): Promise<{ ok: boolean; error?: string }> {
    if (!body.path) return { ok: false, error: "path is required" };
    try {
      await this.gitService.pushToRemote(body.path);
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: String(e.message ?? e) };
    }
  }

  @Post("git/add-remote")
  async gitAddRemote(
    @Body() body: { path: string; remoteUrl: string },
  ): Promise<{ ok: boolean; error?: string }> {
    if (!body.path || !body.remoteUrl) return { ok: false, error: "path and remoteUrl are required" };
    try {
      await this.gitService.addRemoteAndPush(body.path, body.remoteUrl);
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: String(e.message ?? e) };
    }
  }

  @Get("workspace/serve-file")
  async serveFile(
    @Query("path") filePath: string,
    @Res() res: Response,
  ): Promise<void> {
    if (!filePath || !existsSync(filePath)) {
      res.status(404).json({ error: "文件不存在" });
      return;
    }
    await this.workspaceService.serveFile(filePath, res);
  }

  @Post("workspace/pack-dir")
  async packDir(
    @Body() body: { path: string },
  ): Promise<{ zipPath: string; dirName: string; hash: string; fileCount: number; skipped: number } | { error: string }> {
    if (!body?.path) return { error: "path is required" };
    try {
      return await this.workspaceService.packDir(body.path);
    } catch (e: any) {
      return { error: String(e?.message ?? e) };
    }
  }

  @Get("git/has-remote")
  async gitHasRemote(@Query("cwd") cwd: string): Promise<{ hasRemote: boolean }> {
    if (!cwd) return { hasRemote: false };
    return { hasRemote: await this.gitService.hasRemote(cwd) };
  }

  @Get("git/ahead-behind")
  async gitAheadBehind(@Query("cwd") cwd: string): Promise<{ ahead: number; behind: number; hasUpstream: boolean; hasCommits: boolean }> {
    if (!cwd) return { ahead: 0, behind: 0, hasUpstream: false, hasCommits: false };
    const count = await this.gitService.getCommitCount(cwd);
    const ab = await this.gitService.aheadBehind(cwd);
    return { ...ab, hasCommits: count > 0 };
  }

  @Get("workspace/detect-commands")
  async detectCommands(@Query("path") path: string): Promise<{ commands: Array<{ label: string; command: string }> }> {
    if (!path) return { commands: [] };
    try {
      const commands = this.workspaceService.detectCommands(path);
      return { commands };
    } catch {
      return { commands: [] };
    }
  }

  @Get("workspace/file-content-base64")
  async getFileBase64(
    @Query("path") filePath: string,
  ): Promise<{ base64: string; mime: string; size: number } | { error: string }> {
    if (!filePath) return { error: "path is required" };
    const result = await this.workspaceService.readFileBase64(filePath);
    if (!result) return { error: "not an image or file not found" };
    return { base64: result.base64, mime: result.mimeType, size: result.size };
  }

  @Post("workspace/new-project")
  async newProject(
    @Body() body: { name?: string },
  ): Promise<{ path: string; name: string } | { error: string }> {
    try {
      return this.workspaceService.createProjectInDocuments(body?.name ?? "");
    } catch (e) {
      return { error: e instanceof Error ? e.message : "failed to create project" };
    }
  }
}
