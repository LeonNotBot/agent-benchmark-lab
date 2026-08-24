// AskUserQuestion 翻页式问答卡（覆盖输入框），还原 docs/images/21.png、22.png。
// 单题翻页（1 of N）、编号选项（单/多选）、其他输入、忽略/上一题/下一题/提交。
// 忽略 = 回带 (No answer provided) 的反馈，模型据此继续输出（见 23.png）。
import { useState } from "react";
import type { PermissionResult } from "@anthropic-ai/claude-agent-sdk";
import type { PermissionRequest } from "../store/useAppStore";
import { useLocale } from "../i18n";

interface Question {
  question: string;
  header?: string;
  options?: { label: string; description?: string }[];
  multiSelect?: boolean;
}

interface AskInput {
  questions?: Question[];
  answers?: Record<string, string>;
}

interface Props {
  request: PermissionRequest;
  onSubmit: (result: PermissionResult) => void;
}

export function AskUserQuestionCard({ request, onSubmit }: Props) {
  const { t } = useLocale();
  const input = request.input as AskInput | null;
  const questions = Array.isArray(input?.questions) ? input!.questions : [];
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Record<number, string[]>>({});
  const [others, setOthers] = useState<Record<number, string>>({});

  const total = questions.length;
  const q = questions[page];
  const isLast = page >= total - 1;

  if (!q) return null;

  const toggle = (label: string) => {
    setSelected((prev) => {
      const cur = prev[page] ?? [];
      if (q.multiSelect) {
        const next = cur.includes(label) ? cur.filter((l) => l !== label) : [...cur, label];
        return { ...prev, [page]: next };
      }
      return { ...prev, [page]: [label] };
    });
    // 单选互斥：点选项即清空「其他」输入，避免与输入框同时生效造成歧义。
    if (!q.multiSelect) {
      setOthers((prev) => (prev[page] ? { ...prev, [page]: "" } : prev));
    }
  };

  // 单选互斥：一旦在「其他」里输入文字，就取消已选选项；清空文字则不动选项。
  const handleOther = (v: string) => {
    setOthers((prev) => ({ ...prev, [page]: v }));
    if (!q.multiSelect && v.trim()) {
      setSelected((prev) => (prev[page]?.length ? { ...prev, [page]: [] } : prev));
    }
  };

  const pageAnswered = (selected[page]?.length ?? 0) > 0 || (others[page]?.trim().length ?? 0) > 0;

  const buildAnswers = () => {
    const ans: Record<string, string> = {};
    questions.forEach((qq, i) => {
      const sel = selected[i] ?? [];
      const other = others[i]?.trim() ?? "";
      const combined = qq.multiSelect ? [...sel, ...(other ? [other] : [])] : [other || sel[0] || ""];
      const val = combined.filter(Boolean).join(", ");
      if (val) ans[qq.question] = val;
    });
    return ans;
  };

  const handleSubmit = () => {
    onSubmit({
      behavior: "allow",
      updatedInput: { ...(input as Record<string, unknown>), answers: buildAnswers() },
    });
  };

  // 忽略：回 CLI 同款「用户想澄清」反馈，未答问题标 (No answer provided)，模型据此继续。
  const handleIgnore = () => {
    const lines = questions
      .map((qq) => `- "${qq.question}"\n  (No answer provided)`)
      .join("\n");
    const message =
      `The user chose not to answer. Take this into account and continue.\n\nQuestions asked:\n${lines}`;
    onSubmit({ behavior: "deny", message });
  };

  return (
    <div className="mx-auto w-full max-w-3xl">
      <AskCardBody
        q={q} page={page} total={total} isLast={isLast} pageAnswered={pageAnswered}
        selected={selected[page] ?? []} other={others[page] ?? ""}
        onToggle={toggle}
        onOther={handleOther}
        onPrev={() => setPage((p) => Math.max(0, p - 1))}
        onNext={() => setPage((p) => Math.min(total - 1, p + 1))}
        onSubmit={handleSubmit}
        onIgnore={handleIgnore}
        t={t}
      />
    </div>
  );
}

/* ── 卡片主体（展示态，便于复用/测试） ── */
function AskCardBody({
  q, page, total, isLast, pageAnswered, selected, other,
  onToggle, onOther, onPrev, onNext, onSubmit, onIgnore, t,
}: {
  q: Question; page: number; total: number; isLast: boolean; pageAnswered: boolean;
  selected: string[]; other: string;
  onToggle: (label: string) => void; onOther: (v: string) => void;
  onPrev: () => void; onNext: () => void; onSubmit: () => void; onIgnore: () => void;
  t: (k: string, p?: Record<string, string | number>) => string;
}) {
  return (
    <div className="rounded-2xl border border-border-300 bg-bg-000 p-5 shadow-card">
      {/* 标题行 + 翻页指示 */}
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-[15px] font-semibold text-text-100">{q.question}</h3>
        {total > 1 && (
          <div className="flex shrink-0 items-center gap-2 text-xs text-text-400">
            <button onClick={onPrev} disabled={page === 0} className="disabled:opacity-30 hover:text-text-200" aria-label={t("ask.prev")}>
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6" /></svg>
            </button>
            <span>{t("ask.pageIndicator", { cur: page + 1, total })}</span>
            <button onClick={onNext} disabled={isLast} className="disabled:opacity-30 hover:text-text-200" aria-label={t("ask.next")}>
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18l6-6-6-6" /></svg>
            </button>
          </div>
        )}
      </div>

      {/* 选项列表 */}
      <div className="mt-3 space-y-0.5">
        {(q.options ?? []).map((opt, i) => {
          const active = selected.includes(opt.label);
          return (
            <div
              key={i}
              onClick={() => onToggle(opt.label)}
              className={`flex cursor-pointer items-center gap-3 rounded-xl px-4 py-3 transition-colors ${active ? "bg-bg-100" : "hover:bg-bg-200"}`}
            >
              <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${active ? "bg-text-100 text-bg-000" : "bg-bg-200 text-text-400"}`}>
                {i + 1}
              </span>
              <span className="flex-1 text-sm text-text-200">
                <span className="font-medium text-text-100">{opt.label}</span>
                {opt.description && <span className="ml-2 text-text-400">{opt.description}</span>}
              </span>
            </div>
          );
        })}
      </div>

      {/* 其他输入 + 底栏 */}
      <div className="mt-2 flex items-center gap-3 rounded-xl px-4 py-2">
        <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-text-400" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z" /></svg>
        <input
          className="flex-1 bg-transparent text-sm text-text-200 outline-none placeholder:text-text-400"
          placeholder={t("ask.otherPlaceholder")}
          value={other}
          onChange={(e) => onOther(e.target.value)}
        />
        <button onClick={onIgnore} className="shrink-0 text-sm text-text-400 hover:text-text-200">{t("ask.ignore")}</button>
        <button
          onClick={isLast ? onSubmit : onNext}
          disabled={!pageAnswered}
          className="flex shrink-0 items-center gap-1.5 rounded-full bg-accent-brand px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-40"
        >
          {isLast ? t("ask.submit") : t("ask.next")}
          <kbd className="text-[10px] opacity-70">⏎</kbd>
        </button>
      </div>
      {q.multiSelect && <p className="mt-1 px-4 text-[11px] text-text-400">{t("ask.multiSelect")}</p>}
    </div>
  );
}
