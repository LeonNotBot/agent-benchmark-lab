// 汇总卡片顶部行：图标 + 「已编辑 N 个文件」+ +X -Y 统计 + 撤销/重新应用 + 审核。
// applied 态显示「撤销 ↩」，reverted 态显示「重新应用 ↻」（对应 1.png / 5.png）。
type TFn = (key: string, params?: Record<string, string | number>) => string;

const EditIcon = (
  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="3" y="3" width="18" height="18" rx="4" />
    <path d="M8 12h8M12 8v8" />
  </svg>
);

const UndoIcon = (
  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M9 14L4 9l5-5" /><path d="M4 9h11a5 5 0 0 1 0 10h-1" />
  </svg>
);

const RedoIcon = (
  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M21 12a9 9 0 1 1-3-6.7L21 8" /><path d="M21 3v5h-5" />
  </svg>
);

interface HeaderProps {
  fileCount: number;
  firstFile?: string;
  totalAdded: number;
  totalRemoved: number;
  reverted: boolean;
  busy: boolean;
  onRevert: () => void;
  onReapply: () => void;
  onReview: () => void;
  t: TFn;
}

export function SummaryHeader(p: HeaderProps) {
  // N>1 显示「已编辑 N 个文件」；N==1 显示文件名（对应 5.png 的「已编辑 Lotter...」）
  const title = p.fileCount === 1 && p.firstFile
    ? p.t("review.summary.editedFile", { name: baseName(p.firstFile) })
    : p.t("review.summary.editedN", { count: p.fileCount });

  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-bg-200 text-text-300">
        {EditIcon}
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium text-text-100">{title}</span>
        <span className="text-xs">
          <span className="text-green-600">+{p.totalAdded}</span>{" "}
          <span className="text-red-600">-{p.totalRemoved}</span>
        </span>
      </div>
      {/* 撤销 / 重新应用 */}
      {p.reverted ? (
        <button onClick={p.onReapply} disabled={p.busy}
          className="flex shrink-0 items-center gap-1 text-sm text-text-300 hover:text-text-100 disabled:opacity-50">
          {RedoIcon}<span>{p.t("review.summary.reapply")}</span>
        </button>
      ) : (
        <button onClick={p.onRevert} disabled={p.busy}
          className="flex shrink-0 items-center gap-1 text-sm text-text-300 hover:text-text-100 disabled:opacity-50">
          {UndoIcon}<span>{p.t("review.summary.revert")}</span>
        </button>
      )}
      {/* 审核 */}
      <button onClick={p.onReview}
        className="shrink-0 rounded-lg border border-border-300 px-3 py-1 text-sm text-text-200 hover:bg-bg-200">
        {p.t("review.summary.review")}
      </button>
    </div>
  );
}

function baseName(p: string): string {
  return p.split(/[\\/]/).pop() ?? p;
}
