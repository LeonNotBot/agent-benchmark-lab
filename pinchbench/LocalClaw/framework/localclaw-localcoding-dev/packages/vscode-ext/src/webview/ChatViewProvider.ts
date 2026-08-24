import * as vscode from "vscode";
import * as path from "path";
import { renderHtml } from "./html";
import { DiffReviewer, type ReviewRequest } from "../editor/DiffReviewer";
import type { SessionTreeProvider, SessionItem } from "../sessions/SessionTreeProvider";

/**
 * 侧栏 Chat 面板。Phase 1 采用「iframe 直连」策略:顶层 Webview 内嵌 <iframe>
 * 加载 server 托管的现有 SPA(http://127.0.0.1:PORT),前端整套零改动复用。
 * server 就绪后经 postMessage 把 URL 交给顶层脚本切换 iframe src。
 *
 * Phase 3:收到前端转发的 permissionRequest(Write/Edit)时,用 DiffReviewer 弹
 * 原生 diff 审阅,决策经 postMessage(permissionDecision)回传前端发 permission.response。
 */
export class ChatViewProvider implements vscode.WebviewViewProvider {
  static readonly viewId = "localcoding.chat";

  private view: vscode.WebviewView | null = null;
  private serverUrl = "";
  private lastError = "";
  private readonly ctx: vscode.ExtensionContext;
  private readonly log: vscode.OutputChannel;
  private readonly getServerUrl: () => string;
  private readonly reviewer: DiffReviewer;
  private readonly tree: SessionTreeProvider;

  constructor(
    ctx: vscode.ExtensionContext,
    log: vscode.OutputChannel,
    getServerUrl: () => string,
    reviewer: DiffReviewer,
    tree: SessionTreeProvider,
  ) {
    this.ctx = ctx;
    this.log = log;
    this.getServerUrl = getServerUrl;
    this.reviewer = reviewer;
    this.tree = tree;
  }

  /** 供命令向 webview 发消息(切换/新建/删除会话)。 */
  sendToWebview(msg: unknown): void {
    void this.view?.webview.postMessage(msg);
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.ctx.extensionUri, "media"),
        vscode.Uri.joinPath(this.ctx.extensionUri, "webview-dist"),
      ],
    };
    view.webview.html = renderHtml(view.webview, this.ctx.extensionUri, this.serverUrl);
    view.webview.onDidReceiveMessage((msg) => this.onMessage(msg));

    // 活动编辑器/选区变化时,实时把上下文推给前端(自动注入用)。
    this.ctx.subscriptions.push(
      vscode.window.onDidChangeActiveTextEditor(() => this.pushEditorContext()),
      vscode.window.onDidChangeTextEditorSelection(() => this.pushEditorContext()),
    );

    // 若 server 已就绪(激活时已 start 完成),补发一次。
    const url = this.getServerUrl();
    if (url) this.onServerReady(url);
    else if (this.lastError) this.onServerError(this.lastError);
  }

  onServerReady(url: string): void {
    const changed = this.serverUrl !== url;
    this.serverUrl = url;
    this.lastError = "";
    // server 基址注入在 HTML 里(window.__LOCALCODING_SERVER__),就绪/变更后重设
    // html 让原生 webview 前端拿到新地址并(重新)连接。
    if (this.view && changed) {
      this.view.webview.html = renderHtml(this.view.webview, this.ctx.extensionUri, url);
    }
  }

  onServerError(message: string): void {
    this.lastError = message;
    void this.view?.webview.postMessage({ type: "server.error", message });
  }

  /**
   * 收集活动编辑器上下文(当前文件相对路径 + 选中代码 + 行号)推给前端,
   * 供发消息时自动注入 prompt。无活动编辑器时推 null(前端不注入)。
   */
  private pushEditorContext(): void {
    if (!this.view) return;
    const ed = vscode.window.activeTextEditor;
    let ctx: { filePath: string; selectedText?: string; startLine?: number; endLine?: number } | null = null;
    if (ed && ed.document.uri.scheme === "file") {
      const filePath = vscode.workspace.asRelativePath(ed.document.uri, false);
      const sel = ed.selection;
      if (!sel.isEmpty) {
        ctx = {
          filePath,
          selectedText: ed.document.getText(sel),
          startLine: sel.start.line + 1,
          endLine: sel.end.line + 1,
        };
      } else {
        ctx = { filePath };
      }
    }
    void this.view.webview.postMessage({ type: "localcoding:editorContext", ctx });
  }

  private async onMessage(msg: unknown): Promise<void> {
    const m = msg as {
      type?: string;
      event?: { type?: string; payload?: unknown };
      toolUseId?: string;
      toolName?: string;
      input?: Record<string, unknown>;
      path?: string;
      sessions?: SessionItem[];
      activeId?: string | null;
    };
    const type = m?.type;
    if (type === "reload") {
      void this.view?.webview.postMessage({ type: "server.ready", url: this.serverUrl });
      return;
    }
    if (type === "localcoding:ready") {
      this.log.appendLine("[bridge] 前端已握手连通 ✓");
      this.pushEditorContext();
      // 握手成功后把工作区根目录告知前端,作为新会话默认 cwd。
      const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (root) void this.view?.webview.postMessage({ type: "localcoding:workspaceRoot", path: root });
      return;
    }
    if (type === "localcoding:sessionsList") {
      // webview 推来会话列表 → 刷新原生 TreeView。
      this.tree.setSessions(m.sessions ?? [], m.activeId ?? null);
      return;
    }
    if (type === "localcoding:serverEvent") {
      // 事件转发(文件树增量等);原生 diff 审阅门走 permissionRequest 通道,不在此处。
      return;
    }
    // ── 原生 diff 审阅门:前端把 Write/Edit 的 permission 委托给宿主 ──
    if (type === "localcoding:permissionRequest" && m.toolUseId && m.toolName) {
      const req: ReviewRequest = {
        toolUseId: m.toolUseId,
        toolName: m.toolName,
        input: m.input ?? {},
      };
      this.log.appendLine(`[diff] 审阅 ${req.toolName} (${req.toolUseId})`);
      const result = await this.reviewer.review(req);
      void this.view?.webview.postMessage({
        type: "localcoding:permissionDecision",
        toolUseId: req.toolUseId,
        approved: result.approved,
        message: result.message,
      });
      return;
    }
    // ── @文件:前端请求弹原生 QuickPick 选工作区文件 ──
    if (type === "localcoding:pickFile") {
      await this.handlePickFile();
      return;
    }
    // ── 点击路径:前端请求在原生编辑器打开文件 ──
    if (type === "localcoding:openFile" && m.path) {
      await this.handleOpenFile(m.path);
      return;
    }
  }

  /** 弹原生 QuickPick 列工作区文件,回传选中的相对路径(取消回空串)。 */
  private async handlePickFile(): Promise<void> {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
      void this.view?.webview.postMessage({ type: "localcoding:filePicked", path: "" });
      return;
    }
    const uris = await vscode.workspace.findFiles(
      "**/*",
      "**/{node_modules,.git,dist,out,build}/**",
      2000,
    );
    const items = uris
      .map((u) => vscode.workspace.asRelativePath(u, false))
      .sort((a, b) => a.localeCompare(b));
    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: "选择要引用的文件（@）",
      matchOnDetail: true,
    });
    void this.view?.webview.postMessage({
      type: "localcoding:filePicked",
      path: picked ?? "",
    });
  }

  /** 在原生编辑器打开文件。相对路径按工作区根解析,绝对路径直接用。 */
  private async handleOpenFile(p: string): Promise<void> {
    const folders = vscode.workspace.workspaceFolders;
    const uri = path.isAbsolute(p)
      ? vscode.Uri.file(p)
      : folders && folders.length > 0
        ? vscode.Uri.joinPath(folders[0].uri, p)
        : vscode.Uri.file(p);
    // 优先用 git 原生 diff 看该文件相对 HEAD 的改动(覆盖 acceptEdits/bypass 事后查看);
    // 该文件有 git 改动时才用 diff,否则(无改动/非 git 仓库)回退到直接打开文件。
    if (await this.tryGitDiff(uri)) return;
    try {
      const doc = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(doc, { preview: true });
    } catch {
      void vscode.window.showWarningMessage(`无法打开文件：${p}`);
    }
  }

  /** 若文件在 git 工作区有改动,用内置 git 扩展打开其相对 HEAD 的原生 diff。返回是否已打开。 */
  private async tryGitDiff(uri: vscode.Uri): Promise<boolean> {
    try {
      const gitExt = vscode.extensions.getExtension("vscode.git");
      if (!gitExt) return false;
      const exports = gitExt.isActive ? gitExt.exports : await gitExt.activate();
      const api = exports?.getAPI?.(1);
      const repo = api?.getRepository?.(uri);
      if (!repo) return false;
      const changed = [...repo.state.workingTreeChanges, ...repo.state.indexChanges]
        .some((c: { uri: vscode.Uri }) => c.uri.fsPath === uri.fsPath);
      if (!changed) return false;
      await vscode.commands.executeCommand("git.openChange", uri);
      return true;
    } catch (e) {
      this.log.appendLine(`[openFile] git diff 失败,回退打开文件: ${String(e)}`);
      return false;
    }
  }
}
