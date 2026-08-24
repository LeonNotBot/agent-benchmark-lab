import * as vscode from "vscode";

/**
 * 生成原生 Webview 的 HTML:加载本地打包的 webview 前端(webview-dist/main.js +
 * index.css),而非 iframe。前端在 webview 内直连 server(CSP 放开 connect-src),
 * server 基址由 window.__LOCALCODING_SERVER__ 注入。主题跟随 VSCode(vscodeTheme)。
 */
export function renderHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  serverUrl: string,
): string {
  const nonce = makeNonce();
  const dist = vscode.Uri.joinPath(extensionUri, "webview-dist");
  const jsUri = webview.asWebviewUri(vscode.Uri.joinPath(dist, "main.js"));
  const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(dist, "index.css"));

  const csp = [
    `default-src 'none'`,
    `img-src ${webview.cspSource} data: https:`,
    `font-src ${webview.cspSource}`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `script-src 'nonce-${nonce}'`,
    // 前端在 webview 内直连本地 server 的 HTTP/WS。
    `connect-src http://127.0.0.1:* http://localhost:* ws://127.0.0.1:* ws://localhost:*`,
  ].join("; ");

  return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<link rel="stylesheet" href="${cssUri}" />
<style>
  html, body, #root { margin: 0; padding: 0; height: 100%; }
  body { background: var(--vscode-sideBar-background); }
</style>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}">
    window.__LOCALCODING_SERVER__ = ${JSON.stringify(serverUrl || "")};
  </script>
  <script nonce="${nonce}" type="module" src="${jsUri}"></script>
</body>
</html>`;
}

function makeNonce(): string {
  let s = "";
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
  return s;
}
