// 自动化任务编辑页(docs/images/1.png)：顶部面包屑 + 右上角 暂停/删除/立即运行；
// 左侧可编辑 标题 + 提示词；右侧 状态/下次/上次(只读) + 详细信息(运行环境只读「本地」/项目/计划/模型 可编辑) + 运行历史。
// 编辑即存：标题/提示词失焦保存，下拉选择即保存（PUT /api/scheduled-tasks/:id）。
import { useEffect, useState } from "react";
import { useLocale } from "../i18n";
import {
  apiGetRawAutomation, apiListAutomationHistory,
  apiUpdateAutomation, apiDeleteAutomation, apiSetAutomationStatus,
  type RawScheduledTask, type TaskExecution,
} from "../api/automation";
import { useAutomationRun } from "./useAutomationRun";
import { nextRunMs } from "../api/cronNext";
import { fmtAbsTime } from "./detailFormat";
import { buildCron, cronToSchedule, type ScheduleState } from "./ScheduleControl";
import { confirmDialog } from "../components/ConfirmDialog";
import { EditSidebar } from "./EditSidebar";
import { DetailTopBar } from "./DetailTopBar";

export function AutomationDetail({ taskId, onBack }: { taskId: string; onBack: () => void }) {
  const { t } = useLocale();
  const [task, setTask] = useState<RawScheduledTask | null>(null);
  const [history, setHistory] = useState<TaskExecution[]>([]);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const { runningIds, run, reconcile } = useAutomationRun();

  useEffect(() => {
    let alive = true;
    setLoading(true);
    void Promise.all([apiGetRawAutomation(taskId), apiListAutomationHistory(taskId)]).then(([t, h]) => {
      if (!alive) return;
      setTask(t); setHistory(h);
      setTitle(t?.name ?? ""); setPrompt(t?.prompt ?? "");
      // 以服务端 lastRunStatus 回灌运行态：进入详情时若任务正在跑（cron / 列表触发），按钮显示「执行中」。
      if (t) reconcile([t]);
      setLoading(false);
    });
    return () => { alive = false; };
  }, [taskId, reconcile]);

  // 局部更新：PUT 后用返回记录回填本地 task。
  const patch = async (p: Parameters<typeof apiUpdateAutomation>[1]) => {
    if (!task) return;
    const updated = await apiUpdateAutomation(task.id, p);
    if (updated) setTask(updated);
  };

  const saveName = () => { const v = title.trim(); if (task && v && v !== task.name) void patch({ name: v }); };
  const savePrompt = () => { const v = prompt.trim(); if (task && v && v !== task.prompt) void patch({ prompt: v }); };
  const onSchedule = (s: ScheduleState) => { void patch({ cron: buildCron(s) }); };
  const onProject = (cwd: string) => { void patch({ cwd }); };
  const onModel = (m: string) => {
    const [endpointId, model] = m ? m.split("::") : ["", ""];
    void patch({ model: model || "", endpointId: endpointId || "" });
  };

  const handleToggle = async () => {
    if (!task) return;
    await apiSetAutomationStatus(task.id, task.status === "active" ? "paused" : "active");
    const fresh = await apiGetRawAutomation(task.id);
    if (fresh) setTask(fresh);
  };
  const handleDelete = async () => {
    if (!task) return;
    const ok = await confirmDialog({ title: t("auto.deleteTitle"), message: t("auto.deleteMessage", { name: task.name }), confirmText: t("auto.delete"), danger: true });
    if (!ok) return;
    await apiDeleteAutomation(task.id);
    onBack();
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden min-w-0">
      <DetailTopBar
        title={task?.name}
        paused={task?.status === "paused"}
        onBack={onBack}
        onToggle={handleToggle}
        onDelete={handleDelete}
        onRun={() => { if (task) run(task.id); }}
        running={!!task && runningIds.has(task.id)}
        disabled={!task}
      />
      {loading ? (
        <p className="px-10 py-8 text-sm text-text-400">{t("auto.loading")}</p>
      ) : !task ? (
        <p className="px-10 py-8 text-sm text-text-400">{t("auto.notFound")}</p>
      ) : (
        <div className="flex flex-1 gap-8 overflow-hidden px-10 pb-10">
          <div className="flex flex-1 flex-col overflow-y-auto pt-2">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={saveName}
              placeholder={t("auto.titlePlaceholder")}
              className="no-focus-ring mb-4 bg-transparent text-2xl font-semibold text-text-100 outline-none placeholder:text-text-400"
            />
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onBlur={savePrompt}
              placeholder={t("auto.promptPlaceholder")}
              className="no-focus-ring flex-1 resize-none bg-transparent text-sm leading-relaxed text-text-200 outline-none placeholder:text-text-400"
            />
          </div>
          <EditSidebar
            paused={task.status === "paused"}
            nextLabel={task.status === "paused" ? t("auto.paused") : fmtAbsTime(t, nextRunMs(task.cron))}
            lastLabel={fmtAbsTime(t, task.lastRunAt)}
            cwd={task.cwd ?? ""}
            schedule={cronToSchedule(task.cron)}
            modelValue={task.endpointId && task.model ? `${task.endpointId}::${task.model}` : ""}
            history={history}
            taskType={task.taskType}
            boundSessionId={task.boundSessionId}
            onSchedule={onSchedule}
            onProject={onProject}
            onModel={onModel}
            onBoundSession={(sessionId) => void patch({ boundSessionId: sessionId })}
          />
        </div>
      )}
    </div>
  );
}
