// Bash：终端风格输出
import { makeAssistantToolUI } from "@assistant-ui/react";
import { ToolCard } from "./ToolCard";
import { getStatus, resultToString, truncate } from "./helpers";

const Icon = (
  <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M4 17l6-6-6-6M12 19h8" />
  </svg>
);

export const BashToolUI = makeAssistantToolUI<{ command: string; description?: string }, unknown>({
  toolName: "Bash",
  render: ({ args, result, status, isError }) => {
    const s = getStatus(status, isError);
    const summary = truncate(args?.command ?? "", 110);
    const stdout = resultToString(result);

    const body = stdout ? (
      <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words bg-bg-200 p-3 font-mono text-[11px] text-text-200">
        {stdout}
      </pre>
    ) : null;

    return (
      <ToolCard icon={Icon} toolName="Bash" summary={summary} status={s} body={body} defaultOpen={false} />
    );
  },
});