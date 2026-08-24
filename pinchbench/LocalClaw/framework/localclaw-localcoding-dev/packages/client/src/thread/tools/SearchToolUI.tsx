// Glob/Grep：命中文件列表
import { makeAssistantToolUI } from "@assistant-ui/react";
import { ToolCard } from "./ToolCard";
import { getStatus, resultToString, errorTextFromResult } from "./helpers";

const SearchIcon = (
  <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="11" cy="11" r="8" />
    <path d="M21 21l-4.35-4.35" />
  </svg>
);

function renderHits(toolName: string) {
  return ({ args, result, status, isError }: any) => {
    const s = getStatus(status, isError);
    const text = isError ? "" : resultToString(result);
    const lines = text ? text.split("\n").filter(Boolean) : [];
    const pattern = args?.pattern ?? args?.path ?? "";
    const summary = pattern ? `${pattern}${lines.length ? ` · ${lines.length} hits` : ""}` : "";

    const body = lines.length > 0 ? (
      <ul className="max-h-60 overflow-auto bg-zinc-50 p-2 font-mono text-[11px] text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
        {lines.slice(0, 50).map((l, i) => (
          <li key={i} className="truncate" title={l}>{l}</li>
        ))}
        {lines.length > 50 && <li className="text-zinc-500">… {lines.length - 50} more</li>}
      </ul>
    ) : null;

    return (
      <ToolCard
        icon={SearchIcon}
        toolName={toolName}
        summary={summary}
        status={s}
        body={body}
        errorText={isError ? errorTextFromResult(result) : undefined}
      />
    );
  };
}

export const GlobToolUI = makeAssistantToolUI({ toolName: "Glob", render: renderHits("Glob") });
export const GrepToolUI = makeAssistantToolUI({ toolName: "Grep", render: renderHits("Grep") });