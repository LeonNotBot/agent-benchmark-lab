/**
 * This file is the entry point for the React app, it sets up the root
 * element and renders the App component to the DOM.
 *
 * It is included in `src/index.html`.
 */

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AppShell } from "./shell";
import { useAppStore, applyTheme, watchSystemTheme } from "./store/useAppStore";
import { ErrorBoundary } from "./telemetry/ErrorBoundary";
import { initTelemetry, trackError, markNoticeShown } from "./telemetry/client";
import { showToast } from "./components/Toast";
import { zh, en } from "./i18n/locales";
import { initBridge, onHostMessage } from "./vscode/bridge";

// VSCode 插件桥接:尽早握手。非 VSCode 环境(桌面版/浏览器)内部 no-op。
initBridge();
// 宿主告知工作区根目录 -> 设为新会话默认 cwd(替代默认 ~/localcoding-workspace)。
onHostMessage((msg) => {
  if (msg.type === "localcoding:workspaceRoot" && msg.path) {
    useAppStore.getState().setDefaultWorkspace(msg.path);
  }
});

// Apply saved theme immediately to avoid flash
applyTheme(useAppStore.getState().theme);
// Watch OS color scheme changes when user has "system" selected
watchSystemTheme(() => useAppStore.getState().theme);

// Telemetry：启动初始化(dev/开关关闭时内部 no-op,不发任何请求)。
// 首启知情提示:release 且从未提示过时,弹一次非阻塞 toast 并标记已提示。
// 渲染期错误由 ErrorBoundary 捕获;这里兜底其余运行时错误与未处理 rejection。
void initTelemetry().then(({ needNotice }) => {
  if (!needNotice) return;
  const dict = useAppStore.getState().locale === "en" ? en : zh;
  showToast("warning", dict["telemetry.firstNotice"]);
  void markNoticeShown();
});
window.addEventListener("error", (e) => {
  trackError(e.message, { source: "window.onerror" });
});
window.addEventListener("unhandledrejection", (e) => {
  trackError(String(e.reason), { source: "unhandledrejection" });
});

const elem = document.getElementById("root")!;
const app = (
  <StrictMode>
    <ErrorBoundary>
      <AppShell />
    </ErrorBoundary>
  </StrictMode>
);

const meta = import.meta as any;
if (meta.hot) {
  // With hot module reloading, `import.meta.hot.data` is persisted.
  const root = (meta.hot.data.root ??= createRoot(elem));
  root.render(app);
} else {
  // The hot module reloading API is not available in production.
  createRoot(elem).render(app);
}
