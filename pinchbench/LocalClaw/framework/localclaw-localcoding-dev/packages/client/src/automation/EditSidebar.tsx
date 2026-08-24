// 编辑页右侧信息栏：状态/下次/上次(只读) + 详细信息(运行环境只读「本地」/项目/计划/模型 可编辑) + 运行历史。
import { useMemo } from "react";
import { useAppStore } from "../store/useAppStore";
import { useLocale } from "../i18n";
import { fmtAbsTime, fmtRelative } from "./detailFormat";
import { ScheduleDropdown, type ScheduleState } from "./ScheduleControl";
import { ProjectDropdown } from "./ManualCreateFooter";
import { PinnedConvoDropdown } from "./ManualCreateControls";
import { ModelChip } from "../thread/ModelChip";
import { useSidebarStore } from "../sidebar/store";
import type { TaskExecution } from "../api/automation";

type T = (key: string, params?: Record<string, string | number>) => string;

function fmtDate(t: T, ts?: number): string {
  if (!ts) return "";
  const d = new Date(ts);
  return t("auto.dateYMD", { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate() });
}

interface Props {
  paused: boolean;
  nextLabel: string;
  lastLabel: string;
  cwd: string;
  schedule: ScheduleState;
  modelValue: string;
  history: TaskExecution[];
  /** 任务类型：conversation 时「项目」栏改为关联置顶会话。缺省 project。 */
  taskType?: "project" | "conversation";
  /** 仅 conversation：当前绑定的会话 id。 */
  boundSessionId?: string;
  onSchedule: (s: ScheduleState) => void;
  onProject: (cwd: string) => void;
  onModel: (m: string) => void;
  /** 仅 conversation：切换绑定会话。 */
  onBoundSession?: (sessionId: string) => void;
}

export function EditSidebar({
  paused, nextLabel, lastLabel, cwd, schedule, modelValue, history, taskType, boundSessionId,
  onSchedule, onProject, onModel, onBoundSession,
}: Props) {
  const { t } = useLocale();
  const projects = useAppStore((s) => s.registeredProjects) as string[];
  const openView = useAppStore((s) => s.openView);
  const sessions = useAppStore((s) => s.sessions);
  const sessionsLoaded = useAppStore((s) => s.sessionsLoaded);
  const sessionPins = useSidebarStore((s) => s.sessionPins);
  const isConversation = taskType === "conversation";
  // 置顶会话列表（conversation 类型用于关联目标会话），与手动创建对话框口径一致。
  const pinnedConvos = useMemo(
    () => sessionPins
      .map((id) => sessions[id])
      .filter(Boolean)
      .map((s: any) => ({ id: s.id, title: s.title || t("thread.untitled"), date: fmtDate(t, s.updatedAt ?? s.createdAt) })),
    [sessions, sessionPins, t],
  );
  // modelValue 形如 "endpointId::model"（与 AutomationDetail.onModel 约定一致）：拆给 ModelChip。
  const [curEndpointId, curModel] = modelValue ? modelValue.split("::") : ["", ""];

  return (
    <aside className="w-72 shrink-0 overflow-y-auto pt-2">
      <div className="mb-6 flex flex-col gap-3 rounded-xl border border-border-300 bg-bg-000 p-4">
        <Row label={t("auto.statusLabel")}>
          <span className="flex items-center gap-1.5">
            <span className={`h-2 w-2 rounded-full ${paused ? "bg-text-400" : "bg-emerald-500"}`} />
            {paused ? t("auto.paused") : t("auto.active")}
          </span>
        </Row>
        <Row label={t("auto.nextRun")}>{nextLabel}</Row>
        <Row label={t("auto.lastRun")}>{lastLabel}</Row>
      </div>

      <div className="mb-6">
        <div className="mb-2 text-xs font-medium text-text-400">{t("auto.detailInfo")}</div>
        <div className="flex flex-col gap-1 rounded-xl border border-border-300 bg-bg-000 p-2">
          <EditRow label={t("auto.runEnv")}>
            <span className="px-2 text-sm text-text-100">{isConversation ? t("auto.chat") : t("auto.local")}</span>
          </EditRow>
          {isConversation ? (
            <EditRow label={t("auto.chat")}>
              <PinnedConvoDropdown
                convos={pinnedConvos}
                value={boundSessionId ?? ""}
                onChange={(id) => onBoundSession?.(id)}
              />
            </EditRow>
          ) : (
            <EditRow label={t("auto.project")}>
              <ProjectDropdown projects={projects} value={cwd} onChange={onProject} panelClass="top-full right-0 mt-1.5" />
            </EditRow>
          )}
          <EditRow label={t("auto.plan")}>
            <ScheduleDropdown value={schedule} onChange={onSchedule} allowInterval keepHourly panelClass="top-full right-0 mt-1.5" />
          </EditRow>
          {!isConversation && (
            <EditRow label={t("auto.model")}>
              <ModelChip
                endpointId={curEndpointId || undefined}
                model={curModel || undefined}
                onSelect={(ep, m) => onModel(`${ep}::${m}`)}
                placeholder={t("auto.modelDefault")}
              />
            </EditRow>
          )}
        </div>
      </div>

      <div>
        <div className="mb-2 text-xs font-medium text-text-400">{t("auto.runHistory")}</div>
        {history.length === 0 ? (
          <p className="rounded-xl border border-border-300 bg-bg-000 p-4 text-center text-xs text-text-400">{t("auto.noHistory")}</p>
        ) : (
          <div className="flex flex-col divide-y divide-border-300 rounded-xl border border-border-300 bg-bg-000">
            {history.slice(0, 20).map((h) => {
              // 会话存在性：有 sessionId、列表已加载、且 store 里仍有该会话 → 可点；
              // 列表加载完仍找不到 → 判定为已删除（不可点 + 提示）。
              const hasSid = !!h.sessionId;
              const deleted = hasSid && sessionsLoaded && !sessions[h.sessionId!];
              const onOpen = hasSid && !deleted
                ? () => openView("chat", { sessionId: h.sessionId })
                : undefined;
              return <HistoryRow key={h.id} t={t} exec={h} onOpen={onOpen} deleted={deleted} />;
            })}
          </div>
        )}
      </div>
    </aside>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-text-400">{label}</span>
      <span className="text-text-100">{children}</span>
    </div>
  );
}

function EditRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-[36px] items-center justify-between gap-2 rounded-lg px-2 py-1">
      <span className="shrink-0 text-sm text-text-400">{label}</span>
      <span className="flex items-center">{children}</span>
    </div>
  );
}

const STATUS_META: Record<TaskExecution["status"], { tk: string; cls: string }> = {
  success: { tk: "auto.execSuccess", cls: "text-emerald-500" },
  failed: { tk: "auto.execFailed", cls: "text-danger" },
  running: { tk: "auto.execRunning", cls: "text-text-300" },
};

function HistoryRow({ t, exec, onOpen, deleted }: { t: T; exec: TaskExecution; onOpen?: () => void; deleted?: boolean }) {
  const meta = STATUS_META[exec.status];
  const clickable = !!onOpen;
  return (
    <div
      onClick={onOpen}
      title={clickable ? t("auto.openRunSession") : deleted ? t("auto.sessionDeleted") : undefined}
      className={`flex items-center justify-between px-4 py-2.5 text-sm ${
        clickable ? "group/row cursor-pointer transition-colors hover:bg-bg-200" : ""
      }`}
    >
      <span className="text-text-200">{fmtAbsTime(t, exec.startTime)}</span>
      <span className="flex items-center gap-2">
        {deleted ? (
          <span className="text-xs text-text-400">{t("auto.sessionDeleted")}</span>
        ) : (
          <span className="text-xs text-text-400">{fmtRelative(t, exec.startTime)}</span>
        )}
        <span className={meta.cls}>{t(meta.tk)}</span>
        {clickable && (
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 text-text-400 opacity-0 transition-opacity group-hover/row:opacity-100" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        )}
      </span>
    </div>
  );
}
