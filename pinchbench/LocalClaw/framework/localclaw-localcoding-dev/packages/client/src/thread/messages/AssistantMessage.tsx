// Assistant message：text → MarkdownView，reasoning → 折叠 quote，tool-call → ToolFallback
// 出错（incomplete/error）时，底部显示中断提示 + Reload（重新生成）按钮

import { MessagePrimitive, ActionBarPrimitive, useMessage, useMessagePartText, useMessagePartReasoning } from "@assistant-ui/react";
import { useLocale } from "../../i18n";
import { useAppStore } from "../../store/useAppStore";
import MarkdownView from "./MarkdownView";
import { ToolFallback } from "./ToolFallback";
import { ApiErrorCard } from "./ApiErrorCard";
import type { ParsedApiError } from "../../runtime/parseApiError";
import { useEditSummaryFor } from "../EditSummaryContext";
import { EditSummaryCard } from "../EditSummaryCard";

export function AssistantMessage() {
  return (
    <MessagePrimitive.Root className="my-3">
      {/* 汇总卡片排在正文之前：让「已编辑」卡片显示在预览地址卡片之上（2.png）。 */}
      <RoundEditSummary />
      <div className="text-[15px] leading-[1.6] text-zinc-900 dark:text-zinc-100">
        <MessagePrimitive.Parts
          components={{
            Text: TextPart,
            Reasoning: ReasoningPart,
            tools: { Fallback: ToolFallback },
          }}
        />
      </div>
      <ErrorNotice />
    </MessagePrimitive.Root>
  );
}

// 若本条 assistant 消息是某轮的末条（且该轮有编辑），在消息末尾渲染汇总卡片（1.png / 5.png）。
function RoundEditSummary() {
  const messageId = useMessage((m) => m.id);
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const summary = useEditSummaryFor(messageId);
  if (!summary || !activeSessionId) return null;
  return <EditSummaryCard sessionId={activeSessionId} summary={summary} />;
}

// 结构化 API 错误（鉴权/额度/限流）→ 错误卡片；否则回退「回复中断」通用提示。
// 两者都自带「重新发送」，互斥渲染，避免一个错误出现两个提示。
function ErrorNotice() {
  const apiError = useMessage((m) => (m.metadata?.custom as any)?.apiError as ParsedApiError | undefined);
  const status = useMessage((m) => m.status);
  const { t } = useLocale();
  if (apiError) return <ApiErrorCard error={apiError} />;

  const isError = status?.type === "incomplete" && (status as any).reason === "error";
  if (!isError) return null;

  return (
    <div className="mt-1 flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400">
      <span>{t("thread.replyInterrupted")}</span>
      <ActionBarPrimitive.Root>
        <ActionBarPrimitive.Reload className="rounded-md border border-amber-400/60 px-2 py-0.5 font-medium text-amber-700 hover:bg-amber-100 dark:text-amber-300 dark:hover:bg-amber-900/40">
          {t("thread.continueRun")}
        </ActionBarPrimitive.Reload>
      </ActionBarPrimitive.Root>
    </div>
  );
}

function TextPart() {
  const { text } = useMessagePartText();
  return <MarkdownView text={text ?? ""} />;
}

function ReasoningPart() {
  const { text } = useMessagePartReasoning();
  if (!text) return null;
  return (
    <details className="my-1 text-xs text-zinc-500 dark:text-zinc-400">
      <summary className="cursor-pointer select-none">thinking</summary>
      <div className="mt-1 border-l-2 border-zinc-300 pl-3 italic leading-relaxed dark:border-zinc-700">
        {text}
      </div>
    </details>
  );
}