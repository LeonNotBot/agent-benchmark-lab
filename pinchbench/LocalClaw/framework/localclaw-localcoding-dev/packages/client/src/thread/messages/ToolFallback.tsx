// 默认工具卡片：用 assistant-ui 的 ToolCallContentPartComponent 接口
// PoC 阶段不按 toolName 区分，所有工具都走这个 fallback

import { type ToolCallMessagePartComponent } from "@assistant-ui/react";

export const ToolFallback: ToolCallMessagePartComponent = ({
  toolName,
  args,
  result,
  status,
}) => {
  const isRunning = status?.type === "running";
  const isError = status?.type === "incomplete" && (status as any).reason === "error";
  const summary = pickSummary(args);

  return (
    <div className="my-2 rounded-lg border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/50">
      <div className="flex items-center gap-2 border-b border-zinc-200 px-3 py-1.5 text-xs dark:border-zinc-800">
        <span className="font-mono font-medium text-zinc-700 dark:text-zinc-200">{toolName}</span>
        {summary && (
          <span className="truncate font-mono text-[11px] text-zinc-500">{summary}</span>
        )}
        {isRunning && <span className="ml-auto text-[11px] text-blue-500">running…</span>}
        {isError && <span className="ml-auto text-[11px] text-red-500">error</span>}
      </div>

      {(result !== undefined || args) && (
        <details className="px-3 py-1.5 text-[11px] text-zinc-600 dark:text-zinc-400">
          <summary className="cursor-pointer select-none text-zinc-500 hover:text-zinc-700">
            {result !== undefined ? "result" : "args"}
          </summary>
          <pre className="mt-1 max-h-60 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px]">
            {result !== undefined ? formatResult(result) : JSON.stringify(args, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
};

function pickSummary(args: any): string {
  if (!args || typeof args !== "object") return "";
  const candidate = args.file_path ?? args.command ?? args.pattern ?? args.url ?? args.path;
  if (typeof candidate !== "string") return "";
  return candidate.length > 90 ? candidate.slice(0, 90) + "…" : candidate;
}

function formatResult(result: unknown): string {
  if (typeof result === "string") return result;
  try {
    return JSON.stringify(result, null, 2);
  } catch {
    return String(result);
  }
}
