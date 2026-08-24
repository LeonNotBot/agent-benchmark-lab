// 编辑页顶栏：左侧面包屑(返回)，右侧 暂停/恢复 + 删除 + 立即运行 三个按钮。
import { useLocale } from "../i18n";

interface Props {
  title?: string;
  paused: boolean;
  disabled: boolean;
  running?: boolean;
  onBack: () => void;
  onToggle: () => void;
  onDelete: () => void;
  onRun: () => void;
}

export function DetailTopBar({ title, paused, disabled, running = false, onBack, onToggle, onDelete, onRun }: Props) {
  const { t } = useLocale();
  return (
    <div className="flex shrink-0 items-center px-6 py-3">
      <div className="flex items-center gap-2 text-sm text-text-400">
        <button onClick={onBack} className="rounded-md px-1.5 py-0.5 transition-colors hover:bg-bg-200 hover:text-text-200">{t("auto.breadcrumb")}</button>
        <span>/</span>
        <span className="text-text-200">{title ?? t("auto.detail")}</span>
      </div>

      <div className="ml-auto flex items-center gap-1.5">
        <IconBtn label={paused ? t("auto.resume") : t("auto.pause")} onClick={onToggle} disabled={disabled}>
          {paused
            ? <polygon points="6 4 18 12 6 20 6 4" fill="currentColor" stroke="none" />
            : <><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></>}
        </IconBtn>
        <IconBtn label={t("auto.delete")} danger onClick={onDelete} disabled={disabled}>
          <polyline points="3 6 5 6 21 6" />
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        </IconBtn>
        <button
          onClick={onRun}
          disabled={disabled || running}
          className="ml-1 flex items-center gap-1.5 rounded-lg bg-accent-brand px-3.5 py-1.5 text-sm font-medium text-white shadow-soft transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-accent-brand"
        >
          {running ? (
            <>
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 animate-spin" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 12a9 9 0 1 1-6.219-8.56" strokeLinecap="round" />
              </svg>
              {t("auto.running")}
            </>
          ) : (
            <>
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor"><polygon points="6 4 18 12 6 20 6 4" /></svg>
              {t("auto.run")}
            </>
          )}
        </button>
      </div>
    </div>
  );
}

function IconBtn({ label, danger, disabled, onClick, children }: {
  label: string; danger?: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode;
}) {
  return (
    <div className="group/btn relative">
      <button
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
        className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors disabled:opacity-40 ${danger ? "text-text-400 hover:bg-danger/10 hover:text-danger" : "text-text-400 hover:bg-bg-200 hover:text-text-100"}`}
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          {children}
        </svg>
      </button>
      <span className="pointer-events-none absolute -bottom-7 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md bg-text-000 px-2 py-1 text-[11px] text-bg-000 opacity-0 transition-opacity group-hover/btn:opacity-100 z-30">
        {label}
      </span>
    </div>
  );
}
