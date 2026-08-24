// Read：文件路径徽章 + 行数统计（不展示内容，避免长文件刷屏）
import { makeAssistantToolUI } from "@assistant-ui/react";
import { ToolCard } from "./ToolCard";
import { getStatus, resultToString, errorTextFromResult } from "./helpers";

const Icon = (
  <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
    <polyline points="14 2 14 8 20 8" />
  </svg>
);

export const ReadToolUI = makeAssistantToolUI<{ file_path: string; offset?: number; limit?: number }, unknown>({
  toolName: "Read",
  render: ({ args, result, status, isError }) => {
    const s = getStatus(status, isError);
    const path = args?.file_path ?? "";
    const file = path.split(/[\\/]/).pop() ?? path;
    const text = isError ? "" : resultToString(result);
    const lines = text ? text.split("\n").length : 0;
    const summary = path
      ? `${file}${lines ? ` · ${lines} lines` : ""}${args?.offset ? ` (from line ${args.offset})` : ""}`
      : "";

    const body = text ? (
      <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-words bg-zinc-50 p-3 font-mono text-[11px] text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
        {text}
      </pre>
    ) : null;

    return (
      <ToolCard
        icon={Icon}
        toolName="Read"
        summary={summary}
        filePath={path}
        status={s}
        body={body}
        errorText={isError ? errorTextFromResult(result) : undefined}
      />
    );
  },
});