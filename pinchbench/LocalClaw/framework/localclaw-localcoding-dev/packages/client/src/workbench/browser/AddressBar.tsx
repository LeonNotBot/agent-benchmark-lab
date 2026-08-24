// 地址栏：前进 / 后退 / 刷新 / URL 输入 / 外链打开 / ⋮ 菜单
import { useState, useEffect } from "react";
import { useLocale } from "../../i18n";
import type { WebviewHandle } from "./types";
import { BrowserMenu } from "./BrowserMenu";

interface Props {
  url: string;
  canGoBack: boolean;
  canGoForward: boolean;
  webview: WebviewHandle | null;
  onNavigate: (url: string) => void;
  canDeploy?: boolean;
  onDeploy?: () => void;
}

export function AddressBar({ url, canGoBack, canGoForward, webview, onNavigate, canDeploy, onDeploy }: Props) {
  const [input, setInput] = useState(url);
  const { t } = useLocale();
  useEffect(() => { setInput(url); }, [url]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const v = input.trim();
    if (v) onNavigate(v);
  };

  // 刷新：输入框地址与当前渲染地址不一致时，按输入框地址导航；否则重载当前页。
  // 宽松比较——用户输入常缺协议头（localhost:5173），与已归一化的 url 直接比会判为不同，
  // 此时走 onNavigate 由上层归一化后加载，结果仍正确。
  const refresh = () => {
    const v = input.trim();
    if (v && v !== url) onNavigate(v);
    else webview?.reload();
  };

  const openExternal = () => {
    if (url) window.electronAPI?.browserOpenExternal?.(url);
  };

  return (
    <div className="flex items-center gap-1 border-b border-border-200 px-2 py-1.5">
      <NavBtn label={t("browser.back")} disabled={!canGoBack} onClick={() => webview?.goBack()}>
        <path d="M15 18l-6-6 6-6" />
      </NavBtn>
      <NavBtn label={t("browser.forward")} disabled={!canGoForward} onClick={() => webview?.goForward()}>
        <path d="M9 18l6-6-6-6" />
      </NavBtn>
      <NavBtn label={t("browser.refresh")} onClick={refresh}>
        <path d="M23 4v6h-6M1 20v-6h6" />
        <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
      </NavBtn>

      <form onSubmit={submit} className="flex flex-1 items-center">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={t("browser.urlPlaceholder")}
          className="w-full rounded-lg bg-bg-100 px-3 py-1.5 text-[13px] text-text-100 outline-none placeholder:text-text-400 focus:bg-bg-200"
        />
      </form>

      {canDeploy && (
        <button
          onClick={onDeploy}
          title={t("browser.deployTooltip")}
          className="flex h-7 shrink-0 items-center gap-1 rounded-md bg-blue-600 px-2 text-xs text-white transition-colors hover:bg-blue-700"
        >
          <span>🚀</span>
          <span>{t("browser.oneClickDeploy")}</span>
        </button>
      )}

      <NavBtn label={t("browser.openExternal")} disabled={!url} onClick={openExternal}>
        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
        <path d="M15 3h6v6M10 14L21 3" />
      </NavBtn>
      <BrowserMenu webview={webview} />
    </div>
  );
}

function NavBtn({ label, onClick, disabled, children }: {
  label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode;
}) {
  return (
    <button onClick={onClick} disabled={disabled} aria-label={label} title={label}
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-text-400 transition-colors hover:bg-bg-200 hover:text-text-200 disabled:opacity-30">
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">{children}</svg>
    </button>
  );
}
