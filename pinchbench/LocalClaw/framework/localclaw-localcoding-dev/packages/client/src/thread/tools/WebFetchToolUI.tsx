// WebFetch：URL 卡片
import { makeAssistantToolUI } from "@assistant-ui/react";
import { ToolCard } from "./ToolCard";
import { getStatus, resultToString, truncate, errorTextFromResult } from "./helpers";

const Icon = (
  <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="12" r="10" />
    <path d="M2 12h20M12 2a15 15 0 010 20M12 2a15 15 0 000 20" />
  </svg>
);

export const WebFetchToolUI = makeAssistantToolUI<{ url: string; prompt?: string }, unknown>({
  toolName: "WebFetch",
  render: ({ args, result, status, isError }) => {
    const s = getStatus(status, isError);
    const url = args?.url ?? "";
    let host = "";
    try { host = url ? new URL(url).host : ""; } catch { host = url; }
    const summary = truncate(host || url, 60);
    const text = isError ? "" : resultToString(result);

    const body = text ? (
      <div className="max-h-60 overflow-auto bg-zinc-50 p-3 text-[12px] leading-relaxed text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
        {text.length > 2000 ? text.slice(0, 2000) + "\n…" : text}
      </div>
    ) : null;

    return (
      <ToolCard
        icon={Icon}
        toolName="WebFetch"
        summary={summary}
        status={s}
        body={body}
        errorText={isError ? errorTextFromResult(result) : undefined}
      />
    );
  },
});