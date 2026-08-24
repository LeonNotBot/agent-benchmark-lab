// 内嵌浏览器标签：地址栏 + <webview> + Local 服务列表（空态）
// 仅 Electron 下可用 webview；非 Electron 环境降级为外链提示
import { useState, useRef, useCallback, useEffect } from "react";
import { useLocale } from "../../i18n";
import { AddressBar } from "./AddressBar";
import { LocalServiceList } from "./LocalServiceList";
import type { WebviewHandle } from "./types";
import { useWorkbenchStore } from "../store";
import { resolvePreviewDir, fileUrlToLocalDir, normalizePath } from "../../utils/browserPreview";
import { workspaceFileEventBus } from "../../events/workspaceFileEventBus";
import type { ClientEvent } from "@lenovo/agent-protocol";

interface Props {
  workDir?: string;
  sendEvent?: (event: ClientEvent) => void;
}

function normalizeUrl(input: string): string {
  if (/^https?:\/\//i.test(input)) return input;
  if (/^file:\/\//i.test(input)) return input;
  if (/^localhost(:\d+)?/i.test(input) || /^\d+\.\d+\.\d+\.\d+/.test(input)) return `http://${input}`;
  return `https://${input}`;
}

export function BrowserTab({ workDir, sendEvent }: Props) {
  // 内嵌浏览器可用性：依赖 browser* 桥接能力（openExternal 等），而非窗口控制能力。
  // 整合外壳（LocalCoding）只注入 browser* 而不注入 minimize，故此判据与窗口按钮
  // 判据（TopBar 的 electronAPI.minimize）解耦，避免外壳里多出一排窗口按钮。
  const canWebview = !!window.electronAPI?.browserOpenExternal;
  const { t } = useLocale();
  const [url, setUrl] = useState("");
  const [currentUrl, setCurrentUrl] = useState("");
  const [canBack, setCanBack] = useState(false);
  const [canFwd, setCanFwd] = useState(false);
  const wvRef = useRef<WebviewHandle | null>(null);

  const navigate = useCallback((raw: string) => {
    const u = normalizeUrl(raw);
    setUrl(u);
    setCurrentUrl(u);
  }, []);

  // 监听 store 中的 workbenchUrl，从外部导航到此浏览器标签
  const pendingUrl = useWorkbenchStore((s) => s.workbenchUrl);
  const clearWorkbenchUrl = useWorkbenchStore((s) => s.clearWorkbenchUrl);
  const requestDeploy = useWorkbenchStore((s) => s.requestDeploy);
  useEffect(() => {
    if (pendingUrl) {
      navigate(pendingUrl);
      clearWorkbenchUrl();
    }
  }, [pendingUrl, navigate, clearWorkbenchUrl]);

  // 当前预览页面是否对应可部署的本地目录：file:// 反解目录 / 本地服务用工作目录 / 远程为 null。
  // 仅用于决定「一键部署」按钮是否可用；部署目录本身由部署面板按会话 workDir 取。
  const localDir = resolvePreviewDir(currentUrl, workDir);

  // 一键部署：切到部署页签（部署面板按当前会话 workDir 打包预填）
  const onDeploy = useCallback(() => {
    if (!localDir) return;
    requestDeploy();
  }, [localDir, requestDeploy]);

  // 绑定 webview 导航事件，同步地址栏与前进后退可用态
  useEffect(() => {
    const wv = wvRef.current;
    if (!wv || !url) return;
    const sync = () => {
      setCurrentUrl(wv.getURL());
      setCanBack(wv.canGoBack());
      setCanFwd(wv.canGoForward());
    };
    wv.addEventListener("did-navigate", sync);
    wv.addEventListener("did-navigate-in-page", sync);
    return () => {
      wv.removeEventListener("did-navigate", sync);
      wv.removeEventListener("did-navigate-in-page", sync);
    };
  }, [url]);

  // 自动刷新 file:// 预览：当监听到预览目录下文件变更时，防抖后 reload webview。
  // 严格只对 file:// 静态预览启用（localhost 开发服务器自带 HMR，不应干扰）。
  useEffect(() => {
    if (!sendEvent || !currentUrl) return;

    // 只处理 file:// 预览（排除 localhost / 远程）
    const previewDir = fileUrlToLocalDir(currentUrl);
    if (!previewDir) return;

    // 发送 watch 订阅预览目录（watcher service 引用计数共享，多次 watch 同一目录安全）
    sendEvent({ type: "workspace.watch", payload: { path: previewDir } });

    const normalizedPreviewDir = normalizePath(previewDir);
    let reloadTimer: NodeJS.Timeout | null = null;

    const scheduleReload = () => {
      if (reloadTimer) clearTimeout(reloadTimer);
      reloadTimer = setTimeout(() => {
        const wv = wvRef.current;
        if (wv) {
          // reloadIgnoringCache 确保 CSS/图片不走浏览器缓存，立即看到最新效果
          wv.reloadIgnoringCache();
        }
      }, 250); // 250ms 防抖：保存多个文件时合并成一次刷新
    };

    const onFileChange = (payload: { path: string }) => {
      // 判断变更文件是否在当前预览目录下（按目录边界匹配，避免 /app 误匹配 /app-backup）
      const changePath = normalizePath(payload.path);
      if (changePath === normalizedPreviewDir || changePath.startsWith(normalizedPreviewDir + "/")) {
        scheduleReload();
      }
    };

    const unsubAdded = workspaceFileEventBus.on("workspace.file.added", onFileChange);
    const unsubChanged = workspaceFileEventBus.on("workspace.file.changed", onFileChange);
    const unsubDeleted = workspaceFileEventBus.on("workspace.file.deleted", onFileChange);

    return () => {
      if (reloadTimer) clearTimeout(reloadTimer);
      unsubAdded();
      unsubChanged();
      unsubDeleted();
      sendEvent({ type: "workspace.unwatch", payload: { path: previewDir } });
    };
  }, [currentUrl, sendEvent]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <AddressBar
        url={currentUrl}
        canGoBack={canBack}
        canGoForward={canFwd}
        webview={wvRef.current}
        onNavigate={navigate}
        canDeploy={!!localDir}
        onDeploy={onDeploy}
      />
      <div className="relative flex-1 overflow-hidden bg-bg-000">
        {!url ? (
          <div className="h-full overflow-y-auto">
            <LocalServiceList onOpen={navigate} />
          </div>
        ) : canWebview ? (
          <webview
            ref={(el: any) => { wvRef.current = el; }}
            src={url}
            partition="persist:webview"
            allowpopups
            style={{ width: "100%", height: "100%", border: "none" }}
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
            <p className="text-sm text-text-300">{t("browser.webviewDesktopOnly")}</p>
            <button onClick={() => window.open(url, "_blank")}
              className="rounded-lg bg-accent-brand px-4 py-2 text-sm text-white hover:opacity-90">
              {t("browser.openInNewTab", { url })}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
