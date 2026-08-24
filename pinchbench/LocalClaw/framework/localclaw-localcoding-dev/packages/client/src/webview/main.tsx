/**
 * VSCode 原生 Webview 入口(区别于桌面版 frontend.tsx)。
 *
 * 与桌面版差异:
 * - 只装配核心对话链(runtime + ToolUI + ThreadPane),不含桌面外壳
 *   (TopBar/ThreadSidebar/Workbench/大管理页)。
 * - webview 的 window.location 是 vscode-webview://,无法相对访问 server。
 *   宿主在 HTML 注入 window.__LOCALCODING_SERVER__ = "http://127.0.0.1:PORT";
 *   此处 patch 全局 fetch 把相对 /api 重写为绝对地址(53 处 fetch 零改动)。
 * - 主题跟随 VSCode:样式由 theme-bridge 把色板变量映射到 --vscode-* 变量。
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { initBridge, onHostMessage } from "../vscode/bridge";
import { useAppStore } from "../store/useAppStore";
import { WebviewApp } from "./WebviewApp";
import { syncVscodeTheme } from "./vscodeTheme";
import "../index.css";

// server 基址:宿主注入。缺省回退同源(便于纯浏览器调试)。
const SERVER_URL: string =
  (window as unknown as { __LOCALCODING_SERVER__?: string }).__LOCALCODING_SERVER__ ||
  window.location.origin;

// patch fetch:相对路径(/api、/v1、/ws 除外)重写到 server 绝对地址。
const _fetch = window.fetch.bind(window);
window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  if (typeof input === "string" && input.startsWith("/")) {
    return _fetch(SERVER_URL + input, init);
  }
  return _fetch(input, init);
}) as typeof window.fetch;

// 暴露给 useWebSocket 派生 ws 地址(它原用 window.location.host)。
(window as unknown as { __LOCALCODING_WS__?: string }).__LOCALCODING_WS__ =
  SERVER_URL.replace(/^http/, "ws") + "/ws";

// 宿主握手后推来工作区根目录 → 设为新会话默认 cwd + 会话树按工作区过滤的依据。
// (桌面版在 frontend.tsx 接,原生 webview 入口需单独接。)
onHostMessage((msg) => {
  if (msg.type === "localcoding:workspaceRoot" && msg.path) {
    useAppStore.getState().setDefaultWorkspace(msg.path);
  }
});

initBridge();
syncVscodeTheme();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <WebviewApp />
  </StrictMode>,
);
