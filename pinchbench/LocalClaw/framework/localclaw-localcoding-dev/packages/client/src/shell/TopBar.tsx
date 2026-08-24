// 顶部全宽 Bar：左侧前进/后退 + 中间标题 + 右侧右面板切换 + Electron 窗口按钮
// 不含 文件/编辑/查看/窗口/帮助 菜单

import { useState, useEffect, useCallback } from "react";
import { useAppStore } from "../store/useAppStore";
import { useLocale } from "../i18n";

export function TopBar() {
  const [maximized, setMaximized] = useState(false);
  const isElectron = !!window.electronAPI?.minimize;
  const isMac = window.electronAPI?.platform === "darwin";
  const { t } = useLocale();

  const sidebarOpen = useAppStore((s) => s.sidebarOpen);
  const setSidebarOpen = useAppStore((s) => s.setSidebarOpen);
  const goBack = useAppStore((s) => s.goBack);
  const goForward = useAppStore((s) => s.goForward);
  const canGoBack = useAppStore((s) => s.navIndex > 0 || !!s.automationDetailId);
  const canGoForward = useAppStore((s) => s.navIndex < s.navStack.length - 1);

  const refreshMaximized = useCallback(async () => {
    if (!window.electronAPI?.isMaximized) return;
    setMaximized(await window.electronAPI.isMaximized());
  }, []);

  useEffect(() => {
    refreshMaximized();
    window.addEventListener("resize", refreshMaximized);
    return () => window.removeEventListener("resize", refreshMaximized);
  }, [refreshMaximized]);

  return (
    <header
      className="chrome-surface z-50 flex h-[35px] shrink-0 items-center gap-2 px-3 backdrop-blur-sm select-none"
      style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
    >
      {/* mac 红绿灯占位：系统绘制，左侧留出空间 */}
      {isMac && <div className="w-16 shrink-0" />}

      {/* 切换左侧面板 + 前进/后退 */}
      <div
        className="flex items-center gap-0.5"
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      >
        <NavButton
          label={sidebarOpen ? t("topbar.collapseSidebar") : t("topbar.expandSidebar")}
          active={sidebarOpen}
          onClick={() => setSidebarOpen(!sidebarOpen)}
        >
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <path d="M9 3v18" />
        </NavButton>
        <NavButton label={t("topbar.back")} onClick={goBack} disabled={!canGoBack} big>
          <path d="M15 18l-6-6 6-6" />
        </NavButton>
        <NavButton label={t("topbar.forward")} onClick={goForward} disabled={!canGoForward} big>
          <path d="M9 18l6-6-6-6" />
        </NavButton>
      </div>

      {/* 中间留白（标题已移至中间面板顶部 ThreadHeader） */}
      <div className="flex-1" />

      {/* Electron 窗口按钮（Windows/Linux） */}
      {isElectron && !isMac && (
        <div
          className="-mr-3 flex h-full"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        >
          <WinButton onClick={() => window.electronAPI?.minimize?.()} label={t("topbar.minimize")}>
            <rect width="10" height="1" y="4.5" fill="currentColor" />
          </WinButton>
          <WinButton
            onClick={async () => { window.electronAPI?.maximize?.(); setTimeout(refreshMaximized, 100); }}
            label={maximized ? t("topbar.restore") : t("topbar.maximize")}
          >
            <rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" />
          </WinButton>
          <WinButton onClick={() => window.electronAPI?.close?.()} label={t("topbar.close")} danger>
            <path d="M0 0l10 10M10 0L0 10" stroke="currentColor" strokeWidth="1.2" />
          </WinButton>
        </div>
      )}
    </header>
  );
}

function NavButton({ label, onClick, active, disabled, big, children }: {
  label: string; onClick: () => void; active?: boolean; disabled?: boolean; big?: boolean; children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors ${
        disabled
          ? "cursor-default text-text-500 opacity-40"
          : active
            ? "text-text-100 hover:bg-[#ECE6E2] dark:hover:bg-[#242424]"
            : big
              ? "text-text-200 hover:bg-[#ECE6E2] hover:text-text-100 dark:hover:bg-[#242424]"
              : "text-text-400 hover:bg-[#ECE6E2] hover:text-text-200 dark:hover:bg-[#242424]"
      }`}
    >
      <svg viewBox="0 0 24 24" className={big ? "h-6 w-6" : "h-4 w-4"} fill="none" stroke="currentColor" strokeWidth="2">
        {children}
      </svg>
    </button>
  );
}

function WinButton({ onClick, label, danger, children }: {
  onClick: () => void; label: string; danger?: boolean; children: React.ReactNode;
}) {
  return (
    <button
      className={`flex h-full w-11 items-center justify-center transition-colors ${
        danger ? "text-text-300 hover:bg-danger-100 hover:text-white" : "text-text-300 hover:bg-[#ECE6E2] dark:hover:bg-[#242424]"
      }`}
      onClick={onClick}
      aria-label={label}
    >
      <svg width="10" height="10" viewBox="0 0 10 10">{children}</svg>
    </button>
  );
}
