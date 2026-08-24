// ⋮ 菜单：强制刷新 / 缩放 / 清除 Cookie / 清除缓存
import { useState } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { useLocale } from "../../i18n";
import type { WebviewHandle } from "./types";

interface Props {
  webview: WebviewHandle | null;
}

export function BrowserMenu({ webview }: Props) {
  const [zoom, setZoom] = useState(100);
  const { t } = useLocale();

  const applyZoom = (z: number) => {
    const clamped = Math.max(50, Math.min(200, z));
    setZoom(clamped);
    webview?.setZoomFactor(clamped / 100);
  };

  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>
        <button className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-text-400 hover:bg-bg-200 hover:text-text-200" aria-label={t("browser.more")}>
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor"><circle cx="12" cy="5" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="12" cy="19" r="1.6" /></svg>
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={6} className="z-50 min-w-[240px] rounded-xl border border-border-300 bg-bg-000 p-1.5 shadow-elevated">
          <Item onSelect={() => webview?.reloadIgnoringCache()}>{t("browser.hardRefresh")}</Item>
          <DropdownMenu.Separator className="my-1 h-px bg-border-200" />
          <div className="flex items-center justify-between gap-2 px-3 py-1.5 text-sm text-text-200">
            <span>{t("browser.zoom")}</span>
            <div className="flex items-center gap-1">
              <ZoomBtn onClick={() => applyZoom(zoom - 10)}>−</ZoomBtn>
              <span className="w-12 text-center text-xs tabular-nums">{zoom}%</span>
              <ZoomBtn onClick={() => applyZoom(zoom + 10)}>+</ZoomBtn>
              <ZoomBtn onClick={() => applyZoom(100)} title={t("browser.reset")}>⟳</ZoomBtn>
            </div>
          </div>
          <DropdownMenu.Separator className="my-1 h-px bg-border-200" />
          <Item onSelect={() => window.electronAPI?.browserClearCookies?.()}>{t("browser.clearCookies")}</Item>
          <Item onSelect={() => window.electronAPI?.browserClearCache?.()}>{t("browser.clearCache")}</Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function Item({ onSelect, children }: { onSelect: () => void; children: React.ReactNode }) {
  return (
    <DropdownMenu.Item onSelect={onSelect}
      className="cursor-pointer rounded-lg px-3 py-2 text-sm text-text-200 outline-none hover:bg-bg-200">
      {children}
    </DropdownMenu.Item>
  );
}

function ZoomBtn({ onClick, title, children }: { onClick: () => void; title?: string; children: React.ReactNode }) {
  return (
    <button onClick={onClick} title={title}
      className="flex h-6 w-6 items-center justify-center rounded-md bg-bg-200 text-text-300 hover:bg-bg-300 hover:text-text-100">
      {children}
    </button>
  );
}
