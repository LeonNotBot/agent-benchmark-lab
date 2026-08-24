// 手动创建自动化弹窗(图 11.png)：标题 + 提示词 + 底栏 + 取消/创建。
// 底栏随运行环境切换：本地(图 21) 显示 项目+计划+模型；对话(图 31) 显示 已置顶会话+计划。
// 使用模板(图 2/3/4/5)：点击切到模板库视图(动画展开)，选模板回填标题+提示词。
// 创建：本地环境写入后端 /api/scheduled-tasks（cwd=项目绝对路径），成功后回调刷新列表。
import { useMemo, useState } from "react";
import { useAppStore } from "../store/useAppStore";
import { useLocale } from "../i18n";
import { useSidebarStore } from "../sidebar/store";
import { RunEnvDropdown, ProjectDropdown, HelpTip, type RunEnv } from "./ManualCreateFooter";
import { PinnedConvoDropdown } from "./ManualCreateControls";
import { ModelChip } from "../thread/ModelChip";
import { ScheduleDropdown, DEFAULT_SCHEDULE, type ScheduleState } from "./ScheduleControl";
import { TemplateGallery } from "./TemplateGallery";
import { apiCreateAutomation, type CreateScheduleSpec } from "../api/automation";
import type { AutomationTemplate } from "./templates";

type T = (key: string, params?: Record<string, string | number>) => string;

function fmtDate(t: T, ts?: number): string {
  if (!ts) return "";
  const d = new Date(ts);
  return t("auto.dateYMD", { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate() });
}

/** ScheduleState（UI）→ CreateScheduleSpec（提交），cron 由后端权威生成。 */
function toScheduleSpec(s: ScheduleState): CreateScheduleSpec {
  return {
    kind: s.kind,
    intervalMin: s.intervalMin,
    time: s.time,
    weekday: s.weekday,
    cron: s.cron,
  };
}

export function ManualCreateDialog({ onClose, onCreated, initialShowTemplates }: { onClose: () => void; onCreated?: () => void; initialShowTemplates?: boolean }) {
  const { t, locale } = useLocale();
  const isZh = locale !== "en";
  // 选择项目数据源：创建会话时登记的项目列表
  const projects = useAppStore((s) => s.registeredProjects) as string[];
  const sessions = useAppStore((s) => s.sessions);
  const sessionPins = useSidebarStore((s) => s.sessionPins);

  // 已置顶会话
  const pinnedConvos = useMemo(() => {
    return sessionPins
      .map((id) => sessions[id])
      .filter(Boolean)
      .map((s: any) => ({ id: s.id, title: s.title || t("thread.untitled"), date: fmtDate(t, s.updatedAt ?? s.createdAt) }));
  }, [sessions, sessionPins, t]);

  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [runEnv, setRunEnv] = useState<RunEnv>("local");
  const [project, setProject] = useState("");
  const [convo, setConvo] = useState("");
  // 模型选择改用与聊天输入框一致的 ModelChip（供应商→模型二级菜单）：分别存 endpointId / modelId。
  const [endpointId, setEndpointId] = useState("");
  const [modelId, setModelId] = useState("");
  const [schedule, setSchedule] = useState<ScheduleState>(DEFAULT_SCHEDULE);
  const [showTemplates, setShowTemplates] = useState(!!initialShowTemplates);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const switchRunEnv = (env: RunEnv) => {
    setRunEnv(env);
    setSchedule((s) => {
      if (env === "chat" && s.kind === "hourly") return { ...s, kind: "interval" };
      if (env === "local" && s.kind === "interval") return { ...s, kind: "hourly" };
      return s;
    });
  };

  const handlePickTemplate = (tpl: AutomationTemplate) => {
    setTitle(isZh ? tpl.title.zh : tpl.title.en);
    setPrompt(isZh ? tpl.prompt.zh : tpl.prompt.en);
    setShowTemplates(false);
  };

  const handleClear = () => { setTitle(""); setPrompt(""); };

  const handleCreate = async () => {
    if (!canCreate || creating) return;
    setCreating(true);
    setError(null);
    // 本地环境=project：cwd=选中项目；对话环境=conversation：绑定所选已置顶会话。
    const created = await apiCreateAutomation({
      name: title.trim(),
      prompt: prompt.trim(),
      schedule: toScheduleSpec(schedule),
      cwd: runEnv === "local" ? project : undefined,
      model: modelId || undefined,
      endpointId: endpointId || undefined,
      taskType: runEnv === "local" ? "project" : "conversation",
      boundSessionId: runEnv === "chat" ? convo : undefined,
    });
    setCreating(false);
    if (!created) {
      setError(t("auto.createFailed"));
      return;
    }
    onCreated?.();
    onClose();
  };

  const hasContent = !!(title.trim() || prompt.trim());

  // 创建条件
  const targetLabel = runEnv === "local" ? t("auto.selectProject") : t("auto.selectConvo");
  const targetOk = runEnv === "local" ? !!project : !!convo;
  const canCreate = !!title.trim() && !!prompt.trim() && targetOk;
  // 提示文案动态变化：仅列出尚未满足的条件（按 标题→提示词→目标 顺序）
  const missing: string[] = [];
  if (!title.trim()) missing.push(t("auto.missingTitle"));
  if (!prompt.trim()) missing.push(t("auto.missingPrompt"));
  if (!targetOk) missing.push(targetLabel);
  const disabledHint = t("auto.disabledHint", { fields: missing.join(t("auto.fieldSep")) });

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center">
      <div className="absolute inset-0 bg-text-000/40 backdrop-blur-sm" />
      {/* 对话框：showTemplates 时动画变高。
          模板视图需 overflow-hidden(内部滚动+圆角裁剪)；表单视图需 overflow-visible，
          否则底栏的计划/时间等下拉会被容器裁断。 */}
      <div
        className={`relative w-[92vw] max-w-[841px] rounded-2xl border border-border-300 bg-bg-000 p-4 shadow-elevated transition-all duration-300 ease-in-out ${showTemplates ? "overflow-hidden" : "overflow-visible"}`}
        style={{ maxHeight: showTemplates ? "80vh" : "70vh" }}
      >
        {/* ═══ 模板库视图(动画展开) ═══ */}
        {showTemplates ? (
          <div className="flex h-[65vh] flex-col motion-safe:animate-view-in">
            <TemplateGallery onPick={handlePickTemplate} onBack={() => setShowTemplates(false)} onClose={onClose} />
          </div>
        ) : (
          <div className="motion-safe:animate-view-in">
            {/* ═══ 表单视图 ═══ */}
            {/* 顶部：标题输入 + 清除 + ⓘ 帮助 + 使用模板按钮 + 关闭 */}
            <div className="flex items-center gap-2">
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t("auto.titlePlaceholder")}
                className="no-focus-ring flex-1 bg-transparent text-[15px] font-medium text-text-100 outline-none placeholder:text-text-400"
                autoFocus
              />
              {hasContent && (
                <button onClick={handleClear} className="text-xs text-text-400 transition-colors hover:text-text-200">
                  {t("auto.clear")}
                </button>
              )}
              <HelpTip />
              <button
                onClick={() => setShowTemplates(true)}
                className="rounded-full border border-border-300 px-3 py-1 text-xs font-medium text-text-200 transition-colors hover:bg-bg-200"
              >
                {t("auto.useTemplate")}
              </button>
              <button onClick={onClose} aria-label={t("auto.close")} className="flex h-7 w-7 items-center justify-center rounded-lg text-text-400 transition-colors hover:bg-bg-200 hover:text-text-200">
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
              </button>
            </div>

            {/* 提示词输入 */}
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={t("auto.promptPlaceholderExample")}
              rows={11}
              className="no-focus-ring mt-3 w-full resize-none rounded-xl bg-transparent px-1 py-2 text-sm leading-relaxed text-text-100 outline-none placeholder:text-text-400"
            />

            {/* 底栏 */}
            <div className="mt-2 flex items-center gap-1">
              <RunEnvDropdown value={runEnv} onChange={switchRunEnv} />

              {runEnv === "local" ? (
                <>
                  <ProjectDropdown projects={projects} value={project} onChange={setProject} />
                  <ScheduleDropdown value={schedule} onChange={setSchedule} />
                  <ModelChip
                    endpointId={endpointId || undefined}
                    model={modelId || undefined}
                    onSelect={(ep, m) => { setEndpointId(ep); setModelId(m); }}
                    placeholder={t("auto.selectModel")}
                  />
                </>
              ) : (
                <>
                  <PinnedConvoDropdown convos={pinnedConvos} value={convo} onChange={setConvo} />
                  <ScheduleDropdown value={schedule} onChange={setSchedule} allowInterval />
                </>
              )}

              <div className="ml-auto flex items-center gap-2">
                {error && <span className="text-[11px] text-danger">{error}</span>}
                <button onClick={onClose} className="rounded-lg px-3.5 py-1.5 text-xs text-text-300 transition-colors hover:bg-bg-200">{t("auto.cancel")}</button>
                <div className={`group/create relative ${!canCreate ? "cursor-not-allowed" : ""}`}>
                  <button
                    onClick={handleCreate}
                    disabled={!canCreate || creating}
                    className="rounded-lg bg-accent-brand px-3.5 py-1.5 text-xs font-medium text-white shadow-soft transition-colors hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {creating ? t("auto.creating") : t("auto.create")}
                  </button>
                  {!canCreate && (
                    <div className="pointer-events-none absolute bottom-full right-0 mb-2 w-max max-w-[260px] rounded-lg bg-text-000 px-3 py-1.5 text-[11px] leading-relaxed text-bg-000 opacity-0 transition-opacity group-hover/create:opacity-100 z-40">
                      {disabledHint}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
