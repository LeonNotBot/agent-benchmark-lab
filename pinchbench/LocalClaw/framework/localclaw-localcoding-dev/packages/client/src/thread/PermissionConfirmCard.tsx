// 权限确认卡片（覆盖输入框位置），高度还原 docs/images/1-3.png 样式。
// 三选项：是 / 是且本次会话不再询问 / 否并反馈；选「否」时该行变为可换行输入框，
// 用户填写的调整建议作为 deny message 回馈给模型。底部跳过+提交。
import { useState, useRef, useEffect } from "react";
import type { PermissionRequest } from "../store/useAppStore";
import { calcDiffSummary } from "../utils/diffSummary";
import { useLocale } from "../i18n";

type Choice = "yes" | "yesDontAsk" | "noAdjust";

export interface PermissionConfirmResult {
  behavior: "allow" | "deny";
  updatedInput?: unknown;
  message?: string;
  dontAskAgain?: boolean;
}

interface Props {
  request: PermissionRequest;
  onSubmit: (result: PermissionConfirmResult) => void;
}

export function PermissionConfirmCard({ request, onSubmit }: Props) {
  const { t } = useLocale();
  const [choice, setChoice] = useState<Choice>("yes");
  const [feedback, setFeedback] = useState("");
  const feedbackRef = useRef<HTMLTextAreaElement>(null);

  const diff = calcDiffSummary(request.toolName, request.input);
  const isCommand = request.toolName === "Bash";
  const title = isCommand ? t("confirm.runCommand") : t("confirm.title");

  // 选中「否」时自动聚焦输入框，方便用户直接输入调整建议。
  useEffect(() => {
    if (choice === "noAdjust") feedbackRef.current?.focus();
  }, [choice]);

  const handleSubmit = () => {
    if (choice === "noAdjust") {
      // 选「否」：拒绝该操作。deny message 须明确终止语义，否则模型会把用户的
      // 模糊理由（如"先不删除"）当成"当前尝试的障碍"，换个路径/写法重试（见 4.png）。
      // 故统一加终止指令前缀，用户填写的具体理由作为补充说明附在后面。
      const text = feedback.trim();
      const message = buildDenyMessage(text);
      onSubmit({ behavior: "deny", message });
      return;
    }
    onSubmit({
      behavior: "allow",
      updatedInput: request.input as Record<string, unknown>,
      dontAskAgain: choice === "yesDontAsk",
    });
  };

  const handleSkip = () => {
    onSubmit({ behavior: "deny", message: buildDenyMessage("skipped") });
  };

  // 输入框内 Enter 提交、Shift+Enter 换行（对齐主输入框交互）。
  const handleFeedbackKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="rounded-2xl border border-border-300 bg-bg-000 p-5 shadow-card">
      <h3 className="text-[15px] font-semibold text-text-100">{title}</h3>

      {/* diff 摘要 */}
      <DiffLine diff={diff} />

      {/* 选项列表 */}
      <div className="mt-4 space-y-0.5">
        <OptionRow idx={1} active={choice === "yes"} label={t("confirm.yes")} onClick={() => setChoice("yes")} />
        <OptionRow idx={2} active={choice === "yesDontAsk"} label={t("confirm.yesDontAsk")} onClick={() => setChoice("yesDontAsk")} />

        {/* 选项3：未选中时是按钮，选中时变为可换行输入框（参考 docs/images/*.png） */}
        {choice !== "noAdjust" ? (
          <OptionRow idx={3} active={false} label={t("confirm.noAdjust")} onClick={() => setChoice("noAdjust")} />
        ) : (
          <div className="rounded-xl bg-bg-100 px-4 py-3">
            <div className="flex items-start gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-brand text-xs font-bold text-white">
                3
              </span>
              <div className="flex-1 min-w-0">
                <label className="mb-1.5 block text-sm text-text-200">{t("confirm.noAdjust")}</label>
                <textarea
                  ref={feedbackRef}
                  value={feedback}
                  onChange={(e) => setFeedback(e.target.value)}
                  onKeyDown={handleFeedbackKeyDown}
                  placeholder={t("confirm.adjustPlaceholder")}
                  rows={2}
                  className="w-full resize-none rounded-lg border border-border-200 bg-bg-000 px-3 py-2 text-sm text-text-100 placeholder:text-text-400 focus:border-accent-brand focus:outline-none"
                />
              </div>
              <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-text-400" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M7 11l5-5M7 11l5 5M7 11h10" />
              </svg>
            </div>
          </div>
        )}
      </div>

      {/* 底部按钮 */}
      <div className="mt-4 flex items-center justify-end gap-3">
        <button onClick={handleSkip} className="text-sm text-text-400 hover:text-text-200 transition-colors">
          {t("confirm.skip")}
        </button>
        <button
          onClick={handleSubmit}
          className="flex items-center gap-1.5 rounded-full bg-accent-brand px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition-opacity"
        >
          {t("confirm.submit")}
          <kbd className="text-[10px] opacity-60">⏎</kbd>
        </button>
      </div>
    </div>
  );
}

/* ── 内部子组件 ── */

function DiffLine({ diff }: { diff: ReturnType<typeof calcDiffSummary> }) {
  if (!diff) return null;
  if (diff.command) {
    return (
      <pre className="mt-3 max-h-20 overflow-auto rounded-lg bg-bg-100 p-2 text-xs text-text-300 font-mono">
        {diff.command}
      </pre>
    );
  }
  return (
    <div className="mt-3 flex items-center gap-2 text-sm">
      {diff.fileName && <span className="font-medium text-accent-brand">{diff.fileName}</span>}
      {diff.added > 0 && <span className="text-emerald-500">+{diff.added}</span>}
      {diff.removed > 0 && <span className="text-red-500">-{diff.removed}</span>}
      <span className="h-2 w-2 rounded-full bg-accent-brand/60" />
    </div>
  );
}

/**
 * 构造 deny message，明确终止语义，避免模型误解为"当前尝试的障碍"而换写法重试。
 *
 * 问题（见 4.png）：
 * - 用户填"先不删除" → 模型理解为"路径格式不对？" → 换 POSIX 路径重试
 * - 用户填"先不要删除了" → 模型才停止
 *
 * 原因：口语式理由对模型来说是模糊信号，它会倾向于"帮用户解决障碍"而非终止。
 *
 * 解决：统一加明确指令"User declined this action. Do not retry with variations."
 * 用户的具体理由作为补充说明附在后面，让模型理解背景但不误解为可绕过的技术问题。
 */
function buildDenyMessage(userReason: string): string {
  const prefix = "User declined this action. Do not retry with variations or alternative approaches.";
  if (!userReason) {
    return prefix;
  }
  return `${prefix} User's reason: ${userReason}`;
}

function OptionRow({ idx, active, label, onClick }: {
  idx: number; active: boolean; label: string; onClick: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className={`cursor-pointer rounded-xl px-4 py-3 transition-colors ${active ? "bg-bg-100" : "hover:bg-bg-200"}`}
    >
      <div className="flex items-center gap-3">
        <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${active ? "bg-accent-brand text-white" : "bg-bg-200 text-text-400"}`}>
          {idx}
        </span>
        <span className="text-sm text-text-200">{label}</span>
        {active && (
          <svg viewBox="0 0 24 24" className="ml-auto h-4 w-4 text-text-400" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M7 11l5-5M7 11l5 5M7 11h10" />
          </svg>
        )}
      </div>
    </div>
  );
}
