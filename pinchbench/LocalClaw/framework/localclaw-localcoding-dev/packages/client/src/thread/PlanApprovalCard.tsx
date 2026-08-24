// 计划批准决策条：覆盖输入框上方（见 docs/images/4.png）。
// 计划内容本身在消息流里展示（见 MessageList），这里只做决策：选执行模式 + 批准/继续完善。
import { useState } from "react";
import type { PermissionMode } from "@lenovo/agent-protocol";
import { useLocale } from "../i18n";

interface Props {
  onApprove: (mode: PermissionMode) => void;
  onKeepPlanning: () => void;
}

export function PlanApprovalCard({ onApprove, onKeepPlanning }: Props) {
  const { t } = useLocale();
  const [execMode, setExecMode] = useState<"default" | "acceptEdits">("default");

  return (
    <div className="rounded-2xl border border-accent-brand/30 bg-purple-light3 px-5 py-4 shadow-card">
      {/* 标题 */}
      <div className="flex items-center gap-1.5 text-xs font-semibold text-accent-brand">
        <span className="leading-none">⏸</span>
        <span>{t("decision.planReady")}</span>
      </div>

      {/* 操作行：模式开关 + 按钮 */}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          className="rounded-lg bg-accent-brand px-5 py-2 text-sm font-medium text-white shadow-soft transition-colors hover:bg-accent-hover"
          onClick={() => onApprove(execMode)}
        >
          {t("decision.approvePlan")}
        </button>
        <button
          className="rounded-lg border border-border-300 bg-bg-000 px-5 py-2 text-sm font-medium text-text-200 transition-colors hover:bg-purple-light2"
          onClick={onKeepPlanning}
        >
          {t("decision.keepPlanning")}
        </button>

        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-text-400">{t("plan.modeLabel")}</span>
          <div className="flex rounded-lg border border-border-300 bg-bg-100 p-0.5">
            <ModeTab
              label={t("plan.modeStandard")}
              active={execMode === "default"}
              onClick={() => setExecMode("default")}
            />
            <ModeTab
              label={t("plan.modeAuto")}
              active={execMode === "acceptEdits"}
              onClick={() => setExecMode("acceptEdits")}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function ModeTab({ label, active, onClick }: {
  label: string; active: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
        active ? "bg-bg-000 text-text-100 shadow-soft" : "text-text-400 hover:text-text-200"
      }`}
    >
      {label}
    </button>
  );
}
