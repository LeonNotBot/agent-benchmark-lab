// 竖式（unified/inline）diff 渲染器（2.png）：删除行/新增行上下堆叠成单列，
// 左侧红/绿色条标识增删；保留「N unmodified lines」折叠条。
// 数据仍复用 side-by-side 的对齐 left/right（buildFullSideBySide + foldContext），
// 在此渲染层交织成单列——故 ReviewTab 无需改动。
import { useLocale } from "../../i18n";
import type { ReviewLine } from "./reviewDiffModel";

interface Props {
  left: ReviewLine[];
  right: ReviewLine[];
  noWrap: boolean;
  /** 点击「N unmodified lines」折叠条展开：传入该 fold 的 foldStart 标识。 */
  onExpandFold?: (foldStart: number) => void;
}

// 把对齐的 left/right 两栏合并成单列 unified 序列：
// context → 取 new 侧（右，行号与后续 add 连续）；remove → 左；add → 右；
// fold → 取左；变更块内先输出所有 remove 再所有 add（标准 unified 分组）。
function toUnified(left: ReviewLine[], right: ReviewLine[]): ReviewLine[] {
  const out: ReviewLine[] = [];
  let i = 0;
  while (i < left.length) {
    const l = left[i];
    if (l.type === "context") { out.push(right[i] ?? l); i++; continue; }
    if (l.type === "fold") { out.push(l); i++; continue; }
    // 变更块：连续的 remove/empty（左）与 add/empty（右）。先收 remove 再收 add。
    const removes: ReviewLine[] = [];
    const adds: ReviewLine[] = [];
    while (i < left.length && (left[i].type === "remove" || left[i].type === "empty")) {
      if (left[i].type === "remove") removes.push(left[i]);
      if (right[i]?.type === "add") adds.push(right[i]);
      i++;
    }
    out.push(...removes, ...adds);
  }
  return out;
}

export function ReviewDiff({ left, right, noWrap, onExpandFold }: Props) {
  const { t } = useLocale();

  // 是否折叠无变更行由上游（ReviewTab 的 foldUnchanged）通过 foldContext 决定，
  // 折叠后 left/right 里已含 fold 行；此处直接交织渲染即可。
  const lines = toUnified(left, right);

  const bg = (type: ReviewLine["type"]) =>
    type === "remove" ? "bg-red-50 dark:bg-red-950/30" :
    type === "add" ? "bg-green-50 dark:bg-green-950/30" : "";

  const fg = (type: ReviewLine["type"]) =>
    type === "remove" ? "text-red-800 dark:text-red-300" :
    type === "add" ? "text-green-800 dark:text-green-300" :
    "text-text-300 dark:text-text-500";

  // 左侧色条：add 绿、remove 红，其余透明（占位保持行号左对齐）。
  const bar = (type: ReviewLine["type"]) =>
    type === "add" ? "border-green-500" :
    type === "remove" ? "border-red-400" :
    "border-transparent";

  const pfx = (type: ReviewLine["type"]) =>
    type === "remove" ? "−" : type === "add" ? "+" : " ";

  return (
    <div className={noWrap ? "flex-1 min-h-0 overflow-auto whitespace-nowrap" : "flex-1 min-h-0 overflow-auto"}>
      <div className={noWrap ? "min-w-max" : ""}>
        {lines.map((line, i) => (
          <DiffLine key={i} line={line} noWrap={noWrap} bg={bg} fg={fg} bar={bar} pfx={pfx} onExpandFold={onExpandFold} t={t} />
        ))}
      </div>
    </div>
  );
}

function DiffLine({ line, noWrap, bg, fg, bar, pfx, onExpandFold, t }: {
  line: ReviewLine;
  noWrap: boolean;
  bg: (t: ReviewLine["type"]) => string;
  fg: (t: ReviewLine["type"]) => string;
  bar: (t: ReviewLine["type"]) => string;
  pfx: (t: ReviewLine["type"]) => string;
  onExpandFold?: (foldStart: number) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
}) {
  // 折叠条（2.png「N unmodified lines」）：整行可点击展开。
  if (line.type === "fold") {
    return (
      <div
        className="flex h-6 cursor-pointer items-center bg-bg-200/60 px-4 text-[11px] leading-6 text-text-400 hover:bg-bg-200"
        onClick={() => line.foldStart != null && onExpandFold?.(line.foldStart)}
      >
        ⋯ {t("review.unmodifiedLines", { count: line.foldCount ?? 0 })}
      </div>
    );
  }
  return (
    <div className={`flex text-[11px] font-mono leading-5 border-l-[3px] ${bar(line.type)} ${bg(line.type)}`}>
      <span className="w-10 shrink-0 select-none border-r border-border-200 pr-2 text-right text-text-400">
        {line.lineNo ?? ""}
      </span>
      <span
        className={`px-2 min-w-0 ${fg(line.type)} ${
          noWrap
            ? "whitespace-pre"                 // 禁用换行：保留空格，横向溢出滚动
            : "whitespace-pre-wrap break-all"  // 启用换行：保留空格但允许折行
        }`}
      >
        {pfx(line.type)}{line.content}
      </span>
    </div>
  );
}
