// 工具卡片通用外壳：图标 + 名字 + 摘要 + 状态徽章 + 可折叠主体
// 各专用 ToolUI 通过 children 注入定制内容（终端输出 / 文件路径 / diff 等）

import { useState, useSyncExternalStore, type ReactNode } from "react";
import { subscribeVscodeActive, isInVscode, requestOpenFile } from "../../vscode/bridge";

interface ToolCardProps {
  icon: ReactNode;
  toolName: string;
  summary?: string;
  status: "running" | "success" | "error";
  body?: ReactNode;
  /**
   * 工具失败时的错误正文（来自 tool_result 的错误内容，如 Edit 的
   * "String to replace not found in file"）。仅在 status==="error" 时展示，
   * 渲染为红色错误块。错误卡片默认展开（否则用户只看到 "failed" 徽章却不知原因），
   * 但用户仍可手动收起——倒三角是真正可用的控件，而非锁定展开的假按钮。
   */
  errorText?: string;
  defaultOpen?: boolean;
  /**
   * VSCode 插件：文件类工具（Write/Edit/Read）传入文件路径后，摘要变可点击，
   * 点击调用宿主在原生编辑器打开该文件。非 VSCode 环境（active=false）保持纯文本。
   */
  filePath?: string;
}

const STATUS_BADGE = {
  running: { text: "running…", color: "text-blue-500" },
  success: { text: "✓", color: "text-emerald-500" },
  error: { text: "failed", color: "text-amber-600" },
};

export function ToolCard({ icon, toolName, summary, status, body, errorText, defaultOpen = false, filePath }: ToolCardProps) {
  const showError = status === "error" && !!errorText;
  // 错误卡片默认展开，让失败原因第一眼可见；之后展开/收起完全交给用户控制。
  const [open, setOpen] = useState(defaultOpen || showError);
  const badge = STATUS_BADGE[status];
  const hasBody = (body !== undefined && body !== null) || showError;
  const isOpen = open;
  // 响应式读取握手状态:首屏(握手前)active=false,握手完成后 subscribeVscodeActive
  // 通知重渲染,摘要转为可点击。避免用裸 isInVscode() 导致永久停留非 VSCode 态。
  const inVscode = useSyncExternalStore(subscribeVscodeActive, isInVscode, () => false);
  const canOpenFile = inVscode && !!filePath;

  return (
    <div className="my-2 overflow-hidden rounded-lg border border-zinc-200 bg-bg-000 dark:border-zinc-700 dark:bg-bg-100">
      <div
        className={`flex items-center gap-2 px-3 py-1.5 text-xs ${hasBody ? "cursor-pointer hover:bg-bg-100 dark:hover:bg-bg-200" : ""}`}
        onClick={hasBody ? () => setOpen(!open) : undefined}
      >
        <span className="shrink-0 text-text-400">{icon}</span>
        <span className="font-mono font-medium text-text-200 dark:text-text-100">{toolName}</span>
        {summary && (
          canOpenFile ? (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); requestOpenFile(filePath!); }}
              className="truncate text-left font-mono text-[11px] text-blue-500 hover:underline"
              title="在编辑器中打开"
            >
              {summary}
            </button>
          ) : (
            <span className="truncate font-mono text-[11px] text-text-400" title={summary}>
              {summary}
            </span>
          )
        )}
        <span className={`ml-auto text-[11px] ${badge.color}`}>{badge.text}</span>
        {hasBody && (
          <span className="text-[10px] text-text-400">{isOpen ? "▼" : "▶"}</span>
        )}
      </div>
      {hasBody && isOpen && (
        <div className="border-t border-zinc-200 dark:border-zinc-700">
          {showError && (
            <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-words bg-rose-50 p-3 font-mono text-[11px] text-rose-700 dark:bg-rose-950/40 dark:text-rose-200">
              {errorText}
            </pre>
          )}
          {body}
        </div>
      )}
    </div>
  );
}
