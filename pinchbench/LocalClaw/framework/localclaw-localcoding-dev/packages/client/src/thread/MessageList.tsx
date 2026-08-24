// 消息列表 + 流式 partial + thinking 指示器（搬自 aui/ThreadView）
// 「↓ 最新」按钮显隐与滚动到底由 ScrollToLatestButton 自行用 viewport 几何控制，
// 绕开 assistant-ui 内部判定不可靠的 isAtBottom（在本布局下反复误显）。
import { useEffect, useRef, useState } from "react";
import { ThreadPrimitive } from "@assistant-ui/react";
import { useLocale } from "../i18n";
import { useAppStore } from "../store/useAppStore";
import { UserMessage } from "./messages/UserMessage";
import { AssistantMessage } from "./messages/AssistantMessage";
import MarkdownView from "./messages/MarkdownView";
import { AutomationHeader } from "./AutomationHeader";
import { ScrollToLatestButton } from "./ScrollToLatestButton";
import { hasPendingAskUserQuestion } from "../runtime/buildThreadMessages";
import type { PartialState } from "../runtime/usePartialStream";

interface Props {
  partial: PartialState;
}

export function MessageList({ partial }: Props) {
  const { t } = useLocale();
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const activeSession = useAppStore((s) => (s.activeSessionId ? s.sessions[s.activeSessionId] : undefined));
  const isCron = activeSession?.kind === "cron";

  // 待批准的计划：从 permissionRequests 提取 ExitPlanMode，在消息流末尾渲染计划内容。
  const pendingPlan = (activeSession?.permissionRequests ?? []).find(
    (r: { toolName: string }) => r.toolName === "ExitPlanMode" || r.toolName === "exit_plan_mode",
  );
  const planInput = pendingPlan?.input as { plan?: string; content?: string } | null;
  const planText = planInput?.plan ?? planInput?.content ?? "";

  // 计划卡片注入后自动滚动到底（否则卡片在视口外看不到）。
  // planText 从空变非空 → 计划刚出现，延迟少许等 DOM 渲染完再滚动。
  const viewportRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (planText && viewportRef.current) {
      // 延迟等计划卡片 DOM 完全渲染（含 markdown）
      requestAnimationFrame(() => {
        viewportRef.current?.scrollTo({ top: viewportRef.current.scrollHeight, behavior: "smooth" });
      });
    }
  }, [planText]);
  // 运行中指示器直接以 store 的 status 为准，不依赖 assistant-ui 的 running 判定
  // （后者在本布局下不可靠，等待 tool_result 期间会误判为非 running，导致圆点中断）。
  // 这样文本流式结束→工具执行→下一段文本，整段「运行中」圆点连续显示，视觉统一。
  // 但等用户回答 AskUserQuestion、等待写类工具权限确认、等待计划批准时是等输入而非运行，
  // 需排除：此时 CLI 阻塞在 can_use_tool 等用户决策，不应显示「思考中」动画，提交后再恢复。
  const CONFIRM_TOOLS = ["Write", "Edit", "MultiEdit", "NotebookEdit", "Bash", "ExitPlanMode", "exit_plan_mode"];
  const awaitingPermission = (activeSession?.permissionRequests ?? []).some(
    (r: { toolName: string }) => CONFIRM_TOOLS.includes(r.toolName),
  );
  const awaitingUserAnswer =
    hasPendingAskUserQuestion(activeSession?.messages ?? []) || awaitingPermission;
  const isRunning = activeSession?.status === "running" && !awaitingUserAnswer;
  return (
    <ThreadPrimitive.Viewport ref={viewportRef} className="relative flex-1 overflow-y-auto py-6 pl-6 pr-[14px] [scrollbar-gutter:stable]">
      <div className="mx-auto max-w-3xl">
        {isCron && activeSessionId && (
          <AutomationHeader
            sessionId={activeSessionId}
            fallbackTitle={activeSession?.title}
          />
        )}
        <ThreadPrimitive.Messages
          components={{ UserMessage, AssistantMessage, SystemMessage: () => null }}
        />
        {partial.segments.length > 0 && (
          <div className="my-3">
            {partial.segments.map((seg, i) =>
              seg.type === "reasoning" ? (
                <div key={i} className="my-1 border-l-2 border-border-300 pl-3 text-xs italic text-text-400">
                  {seg.text}
                </div>
              ) : (
                <div key={i} className="text-sm"><MarkdownView text={seg.text} /></div>
              )
            )}
          </div>
        )}
        {planText && <PlanCard text={planText} title={t("plan.title")} expandLabel={t("plan.expand")} collapseLabel={t("plan.collapse")} />}
        {isRunning && partial.segments.length === 0 && (
          partial.retry ? (
            <div className="my-2 flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400">
              <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-amber-400 border-t-transparent" />
              <span>{t("thread.reconnecting", { attempt: partial.retry.attempt, max: partial.retry.maxRetries })}</span>
            </div>
          ) : (
            <div className="my-2 flex items-center gap-2 text-xs text-text-400">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent-brand opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-accent-brand" />
              </span>
              <span>{t("thread.thinking")}</span>
            </div>
          )
        )}
      </div>
      <div className="pointer-events-none sticky bottom-0 left-0 h-0 w-full">
        <ScrollToLatestButton />
      </div>
    </ThreadPrimitive.Viewport>
  );
}

// 计划卡片：默认折叠显示前几行（渐变遮罩 + 展开按钮），点击展开看全部。
function PlanCard({ text, title, expandLabel, collapseLabel }: {
  text: string; title: string; expandLabel: string; collapseLabel: string;
}) {
  const [expanded, setExpanded] = useState(false);
  // 折叠时限制最大高度，超出部分裁掉 + 底部渐变遮罩提示"还有更多"。
  const COLLAPSED_MAX_H = 120;

  return (
    <div className="my-4 rounded-2xl border border-accent-brand/20 bg-purple-light3 p-5 shadow-card">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-accent-brand">
        <span className="leading-none">📋</span>
        <span>{title}</span>
      </div>
      <div className="relative mt-3">
        <div
          className="overflow-hidden text-sm text-text-200 transition-[max-height] duration-300"
          style={{ maxHeight: expanded ? "none" : COLLAPSED_MAX_H }}
        >
          <MarkdownView text={text} />
        </div>
        {/* 折叠态底部渐变遮罩：从透明到卡片背景色，柔和淡出被裁切的内容 */}
        {!expanded && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-b from-transparent to-purple-light3" />
        )}
      </div>
      <button
        onClick={() => setExpanded((v) => !v)}
        className="mt-2 flex items-center gap-1 text-xs font-medium text-accent-brand transition-colors hover:text-accent-hover"
      >
        <span>{expanded ? collapseLabel : expandLabel}</span>
        <svg
          viewBox="0 0 24 24"
          className={`h-3.5 w-3.5 transition-transform ${expanded ? "rotate-180" : ""}`}
          fill="none" stroke="currentColor" strokeWidth="2.5"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
    </div>
  );
}
