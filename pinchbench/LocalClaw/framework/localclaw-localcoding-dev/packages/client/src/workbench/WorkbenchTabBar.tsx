// 右面板顶部标签栏：多标签页（浏览器/文件/审查/部署）+ 新建下拉 + 全屏 + 收起
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { useLocale } from "../i18n";
import type { WorkbenchTab, WorkbenchTabId } from "./types";
import { TAB_LABELS } from "./types";

interface Props {
  tabs: WorkbenchTabId[];
  activeTab: WorkbenchTab;
  fullscreen: boolean;
  onSelectTab: (tab: WorkbenchTab) => void;
  onOpenTab: (tab: WorkbenchTabId) => void;
  onCloseTab: (tab: WorkbenchTabId) => void;
  onToggleFullscreen: () => void;
}

const NEW_ITEMS: WorkbenchTabId[] = ["files", "browser", "review", "deploy"];

export function WorkbenchTabBar(props: Props) {
  const { tabs, activeTab, fullscreen, onSelectTab, onOpenTab, onCloseTab, onToggleFullscreen } = props;
  const { t } = useLocale();
  return (
    <div className="flex h-11 shrink-0 items-center gap-1 overflow-x-auto pl-2 pr-10">
      {tabs.length === 0 && (
        <span className="px-2 text-[13px] text-text-400">{t("workbench.title")}</span>
      )}
      {tabs.map((id) => (
        <TabChip
          key={id}
          label={t(TAB_LABELS[id])}
          active={id === activeTab}
          onSelect={() => onSelectTab(id)}
          onClose={() => onCloseTab(id)}
        />
      ))}

      <NewTabMenu onPick={onOpenTab} />

      <div className="ml-auto flex shrink-0 items-center gap-0.5">
        <BarButton label={fullscreen ? t("workbench.exitFullscreen") : t("workbench.fullscreen")} onClick={onToggleFullscreen}>
          {fullscreen
            ? <><path d="M8 3v3a2 2 0 0 1-2 2H3" /><path d="M21 8h-3a2 2 0 0 1-2-2V3" /><path d="M3 16h3a2 2 0 0 1 2 2v3" /><path d="M16 21v-3a2 2 0 0 1 2-2h3" /></>
            : <><path d="M8 3H5a2 2 0 0 0-2 2v3" /><path d="M21 8V5a2 2 0 0 0-2-2h-3" /><path d="M3 16v3a2 2 0 0 0 2 2h3" /><path d="M16 21h3a2 2 0 0 0 2-2v-3" /></>}
        </BarButton>
      </div>
    </div>
  );
}

function BarButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} aria-label={label} title={label}
      className="flex h-7 w-7 items-center justify-center rounded-lg text-text-400 hover:bg-bg-200 hover:text-text-200">
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">{children}</svg>
    </button>
  );
}

function TabChip({ label, active, closable = true, onSelect, onClose }: { label: string; active: boolean; closable?: boolean; onSelect: () => void; onClose: () => void }) {
  const { t } = useLocale();
  return (
    <div
      onClick={onSelect}
      className={`group flex shrink-0 cursor-pointer items-center gap-1 rounded-lg py-1 text-[13px] font-medium transition-colors
        ${closable ? "pl-2.5 pr-1" : "px-2.5"}
        ${active ? "bg-bg-200 text-text-100" : "text-text-400 hover:bg-bg-200/60 hover:text-text-200"}`}
    >
      {label}
      {closable && (
        <button
          onClick={(e) => { e.stopPropagation(); onClose(); }}
          aria-label={t("workbench.closeTab")}
          className="flex h-4 w-4 items-center justify-center rounded text-text-400 hover:bg-bg-300 hover:text-text-100"
        >
          <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
      )}
    </div>
  );
}

function NewTabMenu({ onPick }: { onPick: (tab: WorkbenchTabId) => void }) {
  const { t } = useLocale();
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>
        <button className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-text-400 hover:bg-bg-200 hover:text-text-200" aria-label={t("workbench.newTab")}>
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="start" sideOffset={6} className="z-50 min-w-[180px] rounded-xl border border-border-300 bg-bg-000 p-1 shadow-elevated">
          {NEW_ITEMS.map((id) => (
            <DropdownMenu.Item key={id} onSelect={() => onPick(id)}
              className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm text-text-200 outline-none hover:bg-bg-200">
              {t(TAB_LABELS[id])}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
