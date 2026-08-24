// Write：文件路径徽章 + 写入字节数 + 内容预览 + 跳转右侧 changes tab
import { makeAssistantToolUI } from "@assistant-ui/react";
import { ToolCard } from "./ToolCard";
import { getStatus, errorTextFromResult } from "./helpers";

const Icon = (
  <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M17 3a2.83 2.83 0 114 4L7.5 20.5 2 22l1.5-5.5z" />
  </svg>
);

export const WriteToolUI = makeAssistantToolUI<{ file_path: string; content: string }, unknown>({
  toolName: "Write",
  render: ({ args, result, status, isError }) => {
    const s = getStatus(status, isError);
    const path = args?.file_path ?? "";
    const file = path.split(/[\\/]/).pop() ?? path;
    const content = args?.content ?? "";
    const lines = content ? content.split("\n").length : 0;
    const summary = path ? `${file} · ${lines} lines` : "";

    // 失败时不渲染内容预览：文件未写入，绿色预览会被误读为"已写入"，与 failed 徽章矛盾。
    // 此时只保留 ToolCard 的红色错误块说明失败原因。
    const body = s === "error" ? undefined : (
      <div>
        {content && (
          <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-words bg-emerald-50 p-3 font-mono text-[11px] text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
            {content}
          </pre>
        )}
      </div>
    );

    return (
      <ToolCard
        icon={Icon}
        toolName="Write"
        summary={summary}
        filePath={path}
        status={s}
        body={body}
        errorText={isError ? errorTextFromResult(result) : undefined}
      />
    );
  },
});