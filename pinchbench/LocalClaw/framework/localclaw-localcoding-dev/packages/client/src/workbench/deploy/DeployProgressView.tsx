import { type DeployPayload, type DeployStage, STATUS_LABELS } from "./autoDeployTypes";
import { useLocale } from "../../i18n";

interface Props {
  payload: DeployPayload | null;
  connected: boolean;
  terminal?: boolean;
}

// ISO 时间 → 2026-06-03 15:22:19
function fmtTime(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// 部署进度、阶段时间线、结果地址、终端输出与诊断展示
export function DeployProgressView({ payload, connected, terminal }: Props) {
  const { t } = useLocale();
  if (!payload) {
    return connected
      ? <div className="text-xs text-text-400">{t("deploy.waitingEvents")}</div>
      : null;
  }

  const { status, currentAction, progress, stageHistory, result, diagnostics, repair, terminalTail } = payload;
  const percent = progress?.percent ?? 0;
  const url = result?.publishedUrl || result?.url;
  const isFailed = status === "failed";
  const isStopped = status === "stopped" || status === "deleted";
  const isDone = !!terminal && !isFailed && !isStopped;

  let headTitle: string;
  let headSub: string;
  if (isFailed) {
    headTitle = t("deploy.failed");
    headSub = diagnostics?.repairFailureReason || diagnostics?.error || t("deploy.taskFailed");
  } else if (isStopped) {
    headTitle = STATUS_LABELS[status] ?? status;
    headSub = currentAction || t("deploy.taskEnded");
  } else if (isDone) {
    headTitle = t("deploy.done");
    headSub = t("deploy.doneRunning");
  } else {
    headTitle = STATUS_LABELS[status] ?? status;
    headSub = currentAction || t("deploy.executing");
  }

  const headColor = isFailed ? "text-red-500" : isDone ? "text-green-600" : "text-text-100";

  return (
    <div className="space-y-3">
      {/* 状态标题 */}
      <div className="space-y-0.5">
        <div className={`text-base font-bold ${headColor}`}>{headTitle}</div>
        <div className="text-xs text-text-400">{headSub}</div>
      </div>

      {/* 进行中进度条 */}
      {progress && !terminal && (
        <div className="space-y-1">
          <div className="h-1.5 w-full rounded bg-bg-200 overflow-hidden">
            <div
              className={`h-full transition-all ${isFailed ? "bg-red-500" : "bg-accent-brand"}`}
              style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
            />
          </div>
          <div className="text-[10px] text-text-400">{progress.currentStep}/{progress.totalSteps} · {percent}%</div>
        </div>
      )}

      {url && (
        <div className="text-xs">
          {t("deploy.visitUrl")}<a href={url} target="_blank" rel="noreferrer" className="text-accent-brand underline break-all">{url}</a>
        </div>
      )}

      {isFailed && diagnostics?.suggestion && (
        <div className="text-xs text-text-400">{t("deploy.suggestion")}{diagnostics.suggestion}</div>
      )}

      {repair?.status === "repairing" && (
        <div className="text-xs text-amber-500">{t("deploy.aiRepairing")}</div>
      )}

      <StageTimeline stages={stageHistory} />
      <TerminalOutput text={terminalTail} />
    </div>
  );
}

// 阶段时间线：序号圆点 + 连接线 + 标题/时间/消息
function StageTimeline({ stages }: { stages?: DeployStage[] }) {
  if (!stages || stages.length === 0) return null;
  const sorted = [...stages].sort((a, b) => a.sequence - b.sequence);

  return (
    <div className="border-t border-border-200 pt-2 max-h-72 overflow-y-auto">
      <div className="space-y-0">
        {sorted.map((s, i) => {
          const dotColor =
            s.status === "success" ? "bg-green-600"
            : s.status === "failed" ? "bg-red-500"
            : "bg-blue-500";
          const title = s.action || s.message || s.stage;
          const showMsg = s.message && s.message !== title;
          return (
            <div key={`${s.stage}-${s.sequence}-${i}`} className="relative flex gap-2.5 pb-3">
              {/* 连接线 */}
              {i < sorted.length - 1 && (
                <span className="absolute left-2.75 top-6 bottom-0 w-px bg-border-200" />
              )}
              {/* 序号圆点 */}
              <span className={`relative z-10 shrink-0 grid place-items-center w-5.5 h-5.5 rounded-full text-white text-[10px] font-semibold ${dotColor} ${s.status === "running" ? "animate-pulse" : ""}`}>
                {s.sequence}
              </span>
              <div className="min-w-0 flex-1 -mt-0.5">
                <div className="text-xs font-semibold text-text-100 truncate">#{s.sequence} {title}</div>
                {s.startedAt && <div className="text-[10px] text-text-400 mt-0.5">{fmtTime(s.startedAt)}</div>}
                {showMsg && <div className="text-[11px] text-text-400 mt-0.5 wrap-break-word">{s.message}</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// 终端输出：黑底等宽日志块
function TerminalOutput({ text }: { text?: string }) {
  const { t } = useLocale();
  if (!text) return null;
  return (
    <div className="space-y-1.5">
      <div className="text-sm font-bold text-text-100">{t("deploy.terminalOutput")}</div>
      <pre className="font-mono text-[11px] bg-[#0d1117] text-[#7ee787] rounded-md p-3 max-h-72 overflow-auto whitespace-pre-wrap leading-5">{text}</pre>
    </div>
  );
}
