// 「打开」下拉：主按钮默认执行「打开所在文件夹」，下拉含 Default app / 打开所在文件夹
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { useLocale } from "../i18n";

interface Props {
  // 当前选中文件路径；无选中时按钮禁用
  filePath: string | null;
  // 用系统默认程序打开文件
  onOpenDefaultApp: () => void;
  // 打开所在文件夹并选中当前文件
  onRevealInFolder: () => void;
}

export function OpenMenu({ filePath, onOpenDefaultApp, onRevealInFolder }: Props) {
  const { t } = useLocale();
  const disabled = !filePath;
  return (
    <div className="flex shrink-0 items-center">
      {/* 主按钮：默认执行「打开所在文件夹」 */}
      <button
        onClick={onRevealInFolder}
        disabled={disabled}
        title={t("files.openReveal")}
        className="flex h-7 items-center gap-1.5 rounded-l-lg border border-r-0 border-border-300 pl-2 pr-2 text-xs text-text-200 hover:bg-bg-200 disabled:opacity-40 disabled:hover:bg-transparent"
      >
        <FolderIcon />
        <span>{t("files.open")}</span>
      </button>
      {/* 下拉触发 */}
      <DropdownMenu.Root modal={false}>
        <DropdownMenu.Trigger asChild>
          <button
            disabled={disabled}
            aria-label={t("files.openMenu")}
            className="flex h-7 w-6 items-center justify-center rounded-r-lg border border-border-300 text-text-400 hover:bg-bg-200 hover:text-text-200 disabled:opacity-40 disabled:hover:bg-transparent"
          >
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9l6 6 6-6" /></svg>
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content align="end" sideOffset={6} className="z-50 min-w-[200px] rounded-xl border border-border-300 bg-bg-000 p-1.5 shadow-elevated">
            <MenuItem onSelect={onOpenDefaultApp}>
              <span className="text-base">🖥️</span>
              {t("files.openDefaultApp")}
            </MenuItem>
            <DropdownMenu.Separator className="my-1 h-px bg-border-200" />
            <MenuItem onSelect={onRevealInFolder}>
              <FolderIcon />
              {t("files.openReveal")}
            </MenuItem>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  );
}

function FolderIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
    </svg>
  );
}

function MenuItem({ onSelect, children }: { onSelect: () => void; children: React.ReactNode }) {
  return (
    <DropdownMenu.Item
      onSelect={onSelect}
      className="flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-text-200 outline-none hover:bg-bg-200"
    >
      {children}
    </DropdownMenu.Item>
  );
}
