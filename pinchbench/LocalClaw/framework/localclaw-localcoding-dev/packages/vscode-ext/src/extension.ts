import * as vscode from "vscode";
import { ServerManager } from "./server/ServerManager";
import { ChatViewProvider } from "./webview/ChatViewProvider";
import { DiffReviewer } from "./editor/DiffReviewer";
import { SessionTreeProvider } from "./sessions/SessionTreeProvider";

let serverManager: ServerManager | null = null;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const log = vscode.window.createOutputChannel("LocalCoding");
  context.subscriptions.push(log);
  log.appendLine("[ext] activating…");

  serverManager = new ServerManager(context, log);

  // 原生 diff 审阅门:编辑类工具落盘前弹 vscode.diff 审阅。
  const reviewer = new DiffReviewer(log);
  context.subscriptions.push({ dispose: () => reviewer.dispose() });

  // 会话列表原生 TreeView(数据由 webview 经 bridge 推来)。
  const tree = new SessionTreeProvider();
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("localcoding.sessions", tree),
  );

  // Webview 先注册(显示 loading),server 异步就绪后再通知前端连接。
  const provider = new ChatViewProvider(context, log, () => serverManager?.serverUrl ?? "", reviewer, tree);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(ChatViewProvider.viewId, provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );

  // 会话树命令:点击打开 / 新建 / 删除,均经 provider 通知 webview 执行。
  context.subscriptions.push(
    vscode.commands.registerCommand("localcoding.openSession", (id: string) => {
      provider.sendToWebview({ type: "localcoding:openSession", id });
    }),
    vscode.commands.registerCommand("localcoding.newSession", () => {
      provider.sendToWebview({ type: "localcoding:newSession" });
    }),
    vscode.commands.registerCommand("localcoding.deleteSession", (item?: { id?: string }) => {
      if (item?.id) provider.sendToWebview({ type: "localcoding:deleteSession", id: item.id });
    }),
  );

  // 拉起后端(失败不阻断激活,前端展示错误并可手动重启)。
  void startServer(provider, log);

  context.subscriptions.push(
    vscode.commands.registerCommand("localcoding.restartServer", async () => {
      log.appendLine("[ext] restart server requested");
      await startServer(provider, log, true);
    }),
    vscode.commands.registerCommand("localcoding.openInBrowser", () => {
      const url = serverManager?.serverUrl;
      if (url) vscode.env.openExternal(vscode.Uri.parse(url));
    }),
  );
}

async function startServer(
  provider: ChatViewProvider,
  log: vscode.OutputChannel,
  restart = false,
): Promise<void> {
  try {
    const url = restart ? await serverManager!.restart() : await serverManager!.start();
    provider.onServerReady(url);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.appendLine(`[ext] server start failed: ${msg}`);
    provider.onServerError(msg);
  }
}

export async function deactivate(): Promise<void> {
  await serverManager?.stop();
  serverManager = null;
}
