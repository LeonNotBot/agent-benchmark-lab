// ⋮ 菜单（2.png / 3.png）：刷新 + 自动换行切换 + 加载完整文件切换。三项，无分割线。
// 换行/加载均为双态：文案随当前状态显示「启用/禁用」「加载/不加载」。
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { useLocale } from "../../i18n";
import type { ReviewOptions } from "../../store/reviewOptions";

interface Props {
  options: ReviewOptions;
  onToggle: (key: keyof ReviewOptions) => void;
  onRefresh: () => void;
}

// 刷新
const RefreshIcon = (
  <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M21 12a9 9 0 1 1-3-6.7L21 8" /><path d="M21 3v5h-5" />
  </svg>
);
// 换行（折行箭头）
const WrapIcon = (
  <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M4 6h16M4 12h11a4 4 0 0 1 0 8h-3m0 0l2-2m-2 2l2 2M4 18h4" />
  </svg>
);
// 文件
const FileIcon = (
  <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" />
  </svg>
);

export function ReviewMenu({ options, onToggle, onRefresh }: Props) {
  const { t } = useLocale();
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>
        <button className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-text-400 hover:bg-bg-200 hover:text-text-200" aria-label={t("review.more")}>
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor"><circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" /></svg>
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={6} className="z-50 min-w-[200px] rounded-xl border border-border-300 bg-bg-000 p-1.5 shadow-elevated">
          <MenuItem icon={RefreshIcon} onSelect={onRefresh}>{t("review.refresh")}</MenuItem>
          {/* noWrap=true 表示已禁用换行 → 菜单给出「启用」；反之给出「禁用」 */}
          <MenuItem icon={WrapIcon} onSelect={() => onToggle("noWrap")}>
            {options.noWrap ? t("review.wrapEnable") : t("review.wrapDisable")}
          </MenuItem>
          {/* lazyLoad=true 表示不加载完整文件 → 菜单给出「加载」；反之给出「不加载」 */}
          <MenuItem icon={FileIcon} onSelect={() => onToggle("lazyLoad")}>
            {options.lazyLoad ? t("review.loadFull") : t("review.loadPartial")}
          </MenuItem>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function MenuItem({ icon, onSelect, children }: { icon: React.ReactNode; onSelect: () => void; children: React.ReactNode }) {
  return (
    <DropdownMenu.Item onSelect={onSelect}
      className="flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-text-200 outline-none hover:bg-bg-200">
      <span className="text-text-400">{icon}</span>
      {children}
    </DropdownMenu.Item>
  );
}
