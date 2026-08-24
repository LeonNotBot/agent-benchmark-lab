// 项目 ··· 菜单：置顶 / 在资源管理器打开 / 重命名 / 移除
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { useLocale } from "../i18n";

interface Props {
  pinned: boolean;
  onTogglePin: () => void;
  onOpenDir: () => void;
  onRename: () => void;
  onRemove: () => void;
  onViewCapabilities: () => void;
  onScaffold: () => void;
  onExportPack: () => void;
  onOpenChange?: (open: boolean) => void;
}

const itemCls =
  "flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-text-200 outline-none hover:bg-bg-200";

export function ProjectMenu({ pinned, onTogglePin, onOpenDir, onRename, onRemove, onViewCapabilities, onScaffold, onExportPack, onOpenChange }: Props) {
  const { t } = useLocale();
  return (
    <DropdownMenu.Root onOpenChange={onOpenChange}>
      <DropdownMenu.Trigger asChild>
        <button
          onClick={(e) => e.stopPropagation()}
          aria-label={t("sidebar.projectMenu")}
          className="shrink-0 rounded p-0.5 text-text-400 opacity-0 transition-opacity hover:bg-bg-300 hover:text-text-200 group-hover:opacity-100 data-[state=open]:opacity-100"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor"><circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" /></svg>
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="start" sideOffset={4}
          className="z-50 min-w-[200px] rounded-xl border border-border-300 bg-bg-000 p-1 shadow-elevated">
          <DropdownMenu.Item className={itemCls} onSelect={onTogglePin}>
            <Icon><path d="M9 4v6l-2 4h10l-2-4V4" /><path d="M12 18v3" /><path d="M8 4h8" /></Icon>
            {pinned ? t("sidebar.unpin") : t("sidebar.pin")}
          </DropdownMenu.Item>
          <DropdownMenu.Item className={itemCls} onSelect={onOpenDir}>
            <Icon><path d="M4 7a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z" /></Icon>
            {t("sidebar.openInExplorer")}
          </DropdownMenu.Item>
          <DropdownMenu.Item className={itemCls} onSelect={onRename}>
            <Icon><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" /></Icon>
            {t("sidebar.renameProject")}
          </DropdownMenu.Item>
          <div className="my-1 h-px bg-border-200" />
          <DropdownMenu.Item className={itemCls} onSelect={onViewCapabilities}>
            <Icon><path d="M13 2 3 14h7l-1 8 10-12h-7z" /></Icon>
            {t("projectCapability.menuLabel")}
          </DropdownMenu.Item>
          <DropdownMenu.Item className={itemCls} onSelect={onScaffold}>
            <Icon><path d="M12 5v14M5 12h14" /></Icon>
            {t("plugin.scaffold")}
          </DropdownMenu.Item>
          <DropdownMenu.Item className={itemCls} onSelect={onExportPack}>
            <Icon><path d="M12 3v12M8 11l4 4 4-4" /><path d="M4 19h16" /></Icon>
            {t("plugin.exportPack")}
          </DropdownMenu.Item>
          <div className="my-1 h-px bg-border-200" />
          <DropdownMenu.Item className={`${itemCls} text-danger-200 hover:bg-danger-900`} onSelect={onRemove}>
            <Icon><path d="M6 6l12 12M18 6L6 18" /></Icon>
            {t("sidebar.removeProject")}
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function Icon({ children }: { children: React.ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-text-400" fill="none" stroke="currentColor" strokeWidth="1.8">
      {children}
    </svg>
  );
}
