// 文件列表面板顶部的筛选输入框：放大镜图标 + 实时过滤。
// 受控组件，值与 onChange 由外部（各 Tab）持有，便于对树/diff 列表做过滤。
import { useLocale } from "../i18n";

interface Props {
  value: string;
  onChange: (v: string) => void;
}

export function FileFilterInput({ value, onChange }: Props) {
  const { t } = useLocale();
  return (
    <div className="relative px-2 py-2 shrink-0">
      <svg
        viewBox="0 0 24 24"
        className="pointer-events-none absolute left-5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-400"
        fill="none" stroke="currentColor" strokeWidth="2"
      >
        <circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" />
      </svg>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={t("files.filterPlaceholder")}
        className="w-full rounded-lg border border-border-200 bg-bg-100 py-1.5 pl-8 pr-8 text-xs text-text-200 outline-none placeholder:text-text-400 focus:border-accent-brand"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label={t("files.filterClear")}
          title={t("files.filterClear")}
          className="absolute right-4 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-md text-text-400 hover:bg-bg-300 hover:text-text-200"
        >
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      )}
    </div>
  );
}
