// Edit：old_string → new_string 的双栏 diff（逐行 LCS，相同行中性、变化行红/绿）
import { useMemo } from "react";
import { makeAssistantToolUI } from "@assistant-ui/react";
import { ToolCard } from "./ToolCard";
import { getStatus, errorTextFromResult } from "./helpers";
import { buildLineDiff, type DiffCell } from "./lineDiff";

const Icon = (
  <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
    <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
  </svg>
);

interface EditArgs {
  file_path: string;
  old_string: string;
  new_string: string;
  replace_all?: boolean;
}

export const EditToolUI = makeAssistantToolUI<EditArgs, unknown>({
  toolName: "Edit",
  render: ({ args, result, status, isError }) => {
    const s = getStatus(status, isError);
    const path = args?.file_path ?? "";
    const file = path.split(/[\\/]/).pop() ?? path;
    const oldS = args?.old_string ?? "";
    const newS = args?.new_string ?? "";
    const summary = path ? `${file}${args?.replace_all ? " · all" : ""}` : "";

    // LCS 是 O(n×m)，且流式渲染会频繁重算：按 old/new 内容缓存，只有内容变了才重算。
    const rows = useMemo(() => buildLineDiff(oldS, newS), [oldS, newS]);

    // 失败时不渲染 diff：编辑未生效，绿色 + 行会被误读为"已应用"，与 failed 徽章矛盾。
    // 此时只保留 ToolCard 的红色错误块说明失败原因。
    const body = s === "error" ? undefined : (
      <div>
        {(oldS || newS) && (
          <div className="max-h-72 overflow-auto bg-white dark:bg-zinc-900">
            {rows.map((row, i) => (
              <div key={i} className="grid grid-cols-2 gap-px">
                <DiffHalf cell={row.left} sign="-" />
                <DiffHalf cell={row.right} sign="+" />
              </div>
            ))}
          </div>
        )}
      </div>
    );

    return (
      <ToolCard
        icon={Icon}
        toolName="Edit"
        summary={summary}
        filePath={path}
        status={s}
        body={body}
        errorText={isError ? errorTextFromResult(result) : undefined}
        defaultOpen
      />
    );
  },
});

// 单栏一行：按 cell 类型上色。context 白底、remove 红、add 绿、empty 灰底占位。
function DiffHalf({ cell, sign }: { cell: DiffCell; sign: "-" | "+" }) {
  const bg =
    cell.type === "remove" ? "bg-rose-50 dark:bg-rose-950/40" :
    cell.type === "add" ? "bg-emerald-50 dark:bg-emerald-950/40" :
    cell.type === "empty" ? "bg-zinc-100/60 dark:bg-zinc-800/30" :
    "bg-white dark:bg-zinc-900"; // context（相同行）：白底
  const fg =
    cell.type === "remove" ? "text-rose-900 dark:text-rose-200" :
    cell.type === "add" ? "text-emerald-900 dark:text-emerald-200" :
    "text-text-300 dark:text-text-500";
  // 只有真正变化的行显示 -/+ 前缀，context/empty 用空格占位保持对齐。
  const prefix = cell.type === "remove" || cell.type === "add" ? sign : " ";
  return (
    <div className={`flex font-mono text-[11px] leading-5 ${bg}`}>
      <span className="w-8 shrink-0 select-none border-r border-zinc-200/70 pr-2 text-right text-text-400/60 dark:border-zinc-700/50">
        {cell.lineNo ?? ""}
      </span>
      <pre className={`min-w-0 flex-1 whitespace-pre-wrap break-words px-2 ${fg}`}>
        {cell.type === "empty" ? "" : `${prefix} ${cell.content}`}
      </pre>
    </div>
  );
}