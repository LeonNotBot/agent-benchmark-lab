import { useEffect, useState } from "react";
import type { PermissionResult } from "@anthropic-ai/claude-agent-sdk";
import type { PermissionRequest } from "../store/useAppStore";
import { useLocale } from "../i18n";

type AskUserQuestionInput = {
  questions?: Array<{
    question: string;
    header?: string;
    options?: Array<{
      label: string;
      description?: string;
    }>;
    multiSelect?: boolean;
  }>;
  answers?: Record<string, string>;
};

export function DecisionPanel({
  request,
  onSubmit
}: {
  request: PermissionRequest;
  onSubmit: (result: PermissionResult) => void;
}) {
  const input = request.input as AskUserQuestionInput | null;
  // 强制成数组：历史/异常数据里 questions 可能是非数组，否则下游 .map/.forEach 会白屏整个应用。
  const questions = Array.isArray(input?.questions) ? input!.questions : [];
  const [selectedOptions, setSelectedOptions] = useState<Record<number, string[]>>({});
  const [otherInputs, setOtherInputs] = useState<Record<number, string>>({});
  const { t } = useLocale();

  useEffect(() => {
    setSelectedOptions({});
    setOtherInputs({});
  }, [request.toolUseId]);

  const toggleOption = (qIndex: number, optionLabel: string, multiSelect?: boolean) => {
    setSelectedOptions((prev) => {
      const current = prev[qIndex] ?? [];
      if (multiSelect) {
        const next = current.includes(optionLabel)
          ? current.filter((label) => label !== optionLabel)
          : [...current, optionLabel];
        return { ...prev, [qIndex]: next };
      }
      return { ...prev, [qIndex]: [optionLabel] };
    });
  };

  const buildAnswers = () => {
    const answers: Record<string, string> = {};
    questions.forEach((q, qIndex) => {
      const selected = selectedOptions[qIndex] ?? [];
      const otherText = otherInputs[qIndex]?.trim() ?? "";
      let value = "";

      if (q.multiSelect) {
        const combined = [...selected];
        if (otherText) combined.push(otherText);
        value = combined.join(", ");
      } else {
        value = otherText || selected[0] || "";
      }

      if (value) {
        answers[q.question] = value;
      }
    });
    return answers;
  };

  const canSubmit = questions.every((q, qIndex) => {
    const selected = selectedOptions[qIndex] ?? [];
    const otherText = otherInputs[qIndex]?.trim() ?? "";
    if (q.multiSelect) {
      return selected.length > 0 || otherText.length > 0;
    }
    return selected.length > 0 || otherText.length > 0;
  });

  // For simple AskUserQuestion with options
  if (request.toolName === "AskUserQuestion" && questions.length > 0) {
    return (
      <div className="rounded-2xl border border-accent-brand/20 bg-purple-light3 p-5 shadow-card">
        <div className="text-xs font-semibold text-accent-brand">{t("decision.questionFrom")}</div>

        {questions.map((q, qIndex) => (
          <div key={qIndex} className="mt-4">
            <p className="text-sm text-text-200">{q.question}</p>
            {q.header && (
              <span className="mt-2 inline-flex items-center rounded-full bg-purple-light2 px-2 py-0.5 text-xs text-text-400 border border-border-300">
                {q.header}
              </span>
            )}

            <div className="mt-3 grid gap-2">
              {(q.options ?? []).map((option, optIndex) => {
                const shouldAutoSubmit = questions.length === 1 && !q.multiSelect;
                return (
                  <button
                    key={optIndex}
                    className={`rounded-lg border px-4 py-3 text-left text-sm text-text-200 transition-all ${
                      (selectedOptions[qIndex] ?? []).includes(option.label)
                        ? "border-accent-brand/40 bg-purple-light2"
                        : "border-border-300 bg-bg-000 hover:border-accent-brand/30 hover:bg-purple-light2"
                    }`}
                    onClick={() => {
                      if (shouldAutoSubmit) {
                        onSubmit({
                          behavior: "allow",
                          updatedInput: {
                            ...(input as Record<string, unknown>),
                            answers: { [q.question]: option.label }
                          }
                        });
                        return;
                      }
                      toggleOption(qIndex, option.label, q.multiSelect);
                    }}
                  >
                    <div className="font-medium">{option.label}</div>
                    {option.description && (
                      <div className="mt-1 text-xs text-text-400">{option.description}</div>
                    )}
                  </button>
                );
              })}
            </div>

            <div className="mt-3">
              <label className="block text-xs font-medium text-text-400">{t("decision.other")}</label>
              <input
                type="text"
                className="mt-1 w-full rounded-lg border border-border-300 bg-bg-000 px-3 py-2 text-sm text-text-200 shadow-soft placeholder:text-text-400"
                placeholder={t("decision.typePlaceholder")}
                value={otherInputs[qIndex] ?? ""}
                onChange={(event) => {
                  const value = event.target.value;
                  setOtherInputs((prev) => ({ ...prev, [qIndex]: value }));
                }}
              />
            </div>
            {q.multiSelect && (
              <div className="mt-2 text-xs text-text-400">{t("decision.multiSelect")}</div>
            )}
          </div>
        ))}

        <div className="mt-5 flex flex-wrap gap-3">
          <button
            className={`rounded-lg px-5 py-2 text-sm font-medium text-white shadow-soft transition-colors ${
              canSubmit ? "bg-accent-brand hover:bg-accent-hover" : "bg-text-400/40 cursor-not-allowed"
            }`}
            onClick={() => {
              if (!canSubmit) return;
              const answers = buildAnswers();
              onSubmit({
                behavior: "allow",
                updatedInput: {
                  ...(input as Record<string, unknown>),
                  answers
                }
              });
            }}
            disabled={!canSubmit}
          >
            {t("decision.submit")}
          </button>
          <button
            className="rounded-lg border border-border-300 bg-bg-000 px-5 py-2 text-sm font-medium text-text-200 hover:bg-purple-light2 transition-colors"
            onClick={() => onSubmit({ behavior: "deny", message: "User canceled the question" })}
          >
            {t("decision.cancel")}
          </button>
        </div>
      </div>
    );
  }

  // Default permission request UI
  return (
    <div className="rounded-2xl border border-accent-brand/20 bg-purple-light3 p-5 shadow-card">
      <div className="text-xs font-semibold text-accent-brand">{t("decision.permRequest")}</div>
      <p className="mt-2 text-sm text-text-200">
        {t("decision.wantsToUse")} <span className="font-medium">{request.toolName}</span>
      </p>

      <div className="mt-3 rounded-lg bg-purple-light2 border border-border-300 p-3">
        <pre className="text-xs text-text-300 font-mono whitespace-pre-wrap break-words max-h-40 overflow-auto">
          {JSON.stringify(request.input, null, 2)}
        </pre>
      </div>

      <div className="mt-4 flex flex-wrap gap-3">
        <button
          className="rounded-lg bg-accent-brand px-5 py-2 text-sm font-medium text-white shadow-soft hover:bg-accent-hover transition-colors"
          onClick={() => onSubmit({ behavior: "allow", updatedInput: request.input as Record<string, unknown> })}
        >
          {t("decision.allow")}
        </button>
        <button
          className="rounded-lg border border-border-300 bg-bg-000 px-5 py-2 text-sm font-medium text-text-200 hover:bg-purple-light2 transition-colors"
          onClick={() => onSubmit({ behavior: "deny", message: "User denied the request" })}
        >
          {t("decision.deny")}
        </button>
      </div>
    </div>
  );
}
