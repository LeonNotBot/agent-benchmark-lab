// ProjectPicker 下拉面板内容：搜索框 + 目录列表 + 添加新项目(子菜单)
// 「不使用项目」仅在已选项目时显示于菜单底部（onClear 存在即已选）。
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { useLocale } from "../i18n";
import {
  FolderIcon, PlusFolderIcon, NoFolderIcon, SearchIcon,
  CheckIcon, PlusIcon, ChevronRightIcon,
} from "./pickerIcons";

function dirName(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || p;
}

interface Props {
  items: string[];
  current: string;
  query: string;
  onQuery: (v: string) => void;
  onPick: (path: string) => void;
  onNewBlank: () => void;
  onBrowse: () => void;
  /** 已选项目时传入 = 清空回调；未传（未选）则菜单不显示「不使用项目」项。 */
  onClear?: () => void;
}

export function PickerBody(props: Props) {
  const { items, current, query, onQuery, onPick, onNewBlank, onBrowse, onClear } = props;
  const { t } = useLocale();
  return (
    <>
      {/* 搜索框：阻止 Radix 的键盘选中行为抢焦点 */}
      <div className="flex items-center gap-2 px-2.5 py-1.5" onKeyDown={(e) => e.stopPropagation()}>
        <SearchIcon />
        <input
          autoFocus
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder={t("picker.searchProject")}
          className="w-full bg-transparent text-sm text-text-100 outline-none placeholder:text-text-400"
        />
      </div>
      <div className="my-1 h-px bg-border-200" />

      <div className="max-h-[40vh] overflow-y-auto">
        {items.length === 0 && (
          <div className="px-3 py-2 text-xs text-text-400">{t("picker.noMatch")}</div>
        )}
        {items.map((p) => (
          <DropdownMenu.Item key={p} onSelect={() => onPick(p)}
            className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-text-200 outline-none hover:bg-bg-200">
            <FolderIcon />
            <span className="flex-1 truncate" title={p}>{dirName(p)}</span>
            {p === current && <CheckIcon />}
          </DropdownMenu.Item>
        ))}
      </div>

      <div className="my-1 h-px bg-border-200" />

      <DropdownMenu.Sub>
        <DropdownMenu.SubTrigger className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-text-200 outline-none hover:bg-bg-200 data-[state=open]:bg-bg-200">
          <PlusFolderIcon />
          <span className="flex-1">{t("picker.addProject")}</span>
          <ChevronRightIcon />
        </DropdownMenu.SubTrigger>
        <DropdownMenu.Portal>
          <DropdownMenu.SubContent sideOffset={4}
            className="z-50 w-[200px] rounded-xl border border-border-300 bg-bg-000 p-1 shadow-elevated">
            <DropdownMenu.Item onSelect={onNewBlank}
              className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-text-200 outline-none hover:bg-bg-200">
              <PlusIcon /><span>{t("picker.newBlank")}</span>
            </DropdownMenu.Item>
            <DropdownMenu.Item onSelect={onBrowse}
              className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-text-200 outline-none hover:bg-bg-200">
              <FolderIcon /><span>{t("picker.useExisting")}</span>
            </DropdownMenu.Item>
          </DropdownMenu.SubContent>
        </DropdownMenu.Portal>
      </DropdownMenu.Sub>

      {/* 「不使用项目」仅在已选项目时显示（onClear 存在），点击清空回到「选择项目」态 */}
      {onClear && (
        <>
          <div className="my-1 h-px bg-border-200" />
          <DropdownMenu.Item onSelect={onClear}
            className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-text-200 outline-none hover:bg-bg-200">
            <NoFolderIcon /><span className="flex-1">{t("picker.noProject")}</span>
          </DropdownMenu.Item>
        </>
      )}
    </>
  );
}
