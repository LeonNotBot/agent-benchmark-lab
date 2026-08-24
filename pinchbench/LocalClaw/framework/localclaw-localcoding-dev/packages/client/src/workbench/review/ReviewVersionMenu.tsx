// 顶栏版本选择器（3.png）：「未暂存/已暂存/提交/分支/上一轮」下拉。
// 本期仅「上一轮」可用并打勾（数据=会话工具累计 diff），其余项渲染但 disabled 占位。
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { useLocale } from "../../i18n";

// 版本项：key 决定文案，enabled 决定是否可点/打勾。本期只有 lastRound 可用。
const ITEMS: Array<{ key: string; labelKey: string; enabled: boolean }> = [
  { key: "unstaged", labelKey: "review.version.unstaged", enabled: false },
  { key: "staged", labelKey: "review.version.staged", enabled: false },
  { key: "commit", labelKey: "review.version.commit", enabled: false },
  { key: "branch", labelKey: "review.version.branch", enabled: false },
  { key: "lastRound", labelKey: "review.version.lastRound", enabled: true },
];

export function ReviewVersionMenu() {
  const { t } = useLocale();
  // 当前选中固定为「上一轮」（本期唯一可用项）。
  const currentLabel = t("review.version.lastRound");

  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>
        <button className="flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-xs font-medium text-text-200 hover:bg-bg-200">
          <span className="truncate">{currentLabel}</span>
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 text-text-400" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="start" sideOffset={6} className="z-50 min-w-[180px] rounded-xl border border-border-300 bg-bg-000 p-1.5 shadow-elevated">
          {ITEMS.map((it) => (
            <DropdownMenu.Item
              key={it.key}
              disabled={!it.enabled}
              onSelect={(e) => { if (!it.enabled) e.preventDefault(); }}
              className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm outline-none
                ${it.enabled
                  ? "cursor-pointer text-text-200 hover:bg-bg-200"
                  : "cursor-not-allowed text-text-400 opacity-60"}`}
            >
              <span className={`flex h-4 w-4 shrink-0 items-center justify-center text-[10px] font-bold ${it.enabled ? "text-accent-brand" : "text-transparent"}`}>
                ✓
              </span>
              {t(it.labelKey)}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
