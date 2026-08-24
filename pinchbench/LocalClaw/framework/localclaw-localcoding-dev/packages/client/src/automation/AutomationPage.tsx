// 自动化主页面(图 11.png)：右上角创建菜单 + 大标题「自动化」+ 任务列表(当前/已暂停 分组)。
// 列表用真实数据（/api/scheduled-tasks）；操作后 refetch 保持同步。
import { useCallback, useEffect, useState } from "react";
import { useAppStore } from "../store/useAppStore";
import { useLocale } from "../i18n";
import { useThreadStore } from "../thread/store";
import {
  apiListAutomations,
  apiSetAutomationStatus,
  apiDeleteAutomation,
  type AutomationTask,
} from "../api/automation";
import { useAutomationRun } from "./useAutomationRun";
import { AutomationItem } from "./AutomationItem";
import { AutomationDetail } from "./AutomationDetail";
import { CreateMenu } from "./CreateMenu";
import { ManualCreateDialog } from "./ManualCreateDialog";
import { confirmDialog } from "../components/ConfirmDialog";

export function AutomationPage() {
  const { t } = useLocale();
  const [tasks, setTasks] = useState<AutomationTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [manualOpen, setManualOpen] = useState(false);
  // 打开手动创建弹窗时是否直接进入模板库视图（右上角/空态「查看模板」入口）。
  const [openWithTemplates, setOpenWithTemplates] = useState(false);
  // 详情/编辑页 id 提升到 store，使顶栏后退按钮(goBack)能先返回列表再退视图。
  const detailId = useAppStore((s) => s.automationDetailId);
  const setDetailId = useAppStore((s) => s.setAutomationDetailId);
  const openView = useAppStore((s) => s.openView);
  const setComposerDraft = useThreadStore((s) => s.setComposerDraft);
  const { runningIds, run, reconcile } = useAutomationRun();

  const refetch = useCallback(async () => {
    const list = await apiListAutomations();
    setTasks(list);
    // 以服务端 lastRunStatus 回灌运行态：cron 自动触发 / 切走再切回时也能看到真实「执行中」。
    reconcile(list);
    setLoading(false);
  }, [reconcile]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  // 从详情/编辑页返回列表时（含顶栏后退按钮，绕过了详情的 onBack）刷新，保证状态/计划等改动同步。
  useEffect(() => {
    if (!detailId) void refetch();
  }, [detailId, refetch]);

  const handleCreateByChat = (prompt?: string) => {
    setComposerDraft(prompt ?? t("auto.chatCreatePrompt"));
    openView("chat", { sessionId: null });
  };
  const handleCreateManually = () => { setOpenWithTemplates(false); setManualOpen(true); };
  const handleViewTemplates = () => { setOpenWithTemplates(true); setManualOpen(true); };

  const handleRun = (task: AutomationTask) => { run(task.id); };
  const handleOpen = (task: AutomationTask) => setDetailId(task.id);
  const handleEdit = (task: AutomationTask) => setDetailId(task.id);
  const handleToggle = async (task: AutomationTask) => {
    await apiSetAutomationStatus(task.id, task.status === "active" ? "paused" : "active");
    await refetch();
  };
  const handleDelete = async (task: AutomationTask) => {
    const ok = await confirmDialog({
      title: t("auto.deleteTitle"),
      message: t("auto.deleteMessage", { name: task.name }),
      confirmText: t("auto.delete"),
      danger: true,
    });
    if (!ok) return;
    await apiDeleteAutomation(task.id);
    await refetch();
  };

  const active = tasks.filter((t) => t.status === "active");
  const paused = tasks.filter((t) => t.status === "paused");

  const renderItem = (task: AutomationTask) => (
    <AutomationItem
      key={task.id}
      task={task}
      running={runningIds.has(task.id)}
      onRun={handleRun}
      onEdit={handleEdit}
      onToggle={handleToggle}
      onDelete={handleDelete}
      onOpen={handleOpen}
    />
  );

  if (detailId) {
    return <AutomationDetail taskId={detailId} onBack={() => setDetailId(null)} />;
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden min-w-0">
      <div className="flex shrink-0 items-center justify-end gap-2 px-6 py-3">
        {/* 仅在空态（无任务）时显示「查看模板」 */}
        {!loading && tasks.length === 0 && (
          <button
            onClick={handleViewTemplates}
            className="rounded-lg border border-border-300 px-3.5 py-1.5 text-xs font-medium text-text-200 transition-colors hover:bg-bg-200"
          >
            {t("auto.viewTemplates")}
          </button>
        )}
        <CreateMenu onCreateByChat={handleCreateByChat} onCreateManually={handleCreateManually} />
      </div>

      <div className="flex-1 overflow-y-auto px-10 pb-10">
        <h1 className="mb-2 mt-2 text-3xl font-semibold text-text-100">{t("auto.title")}</h1>
        <p className="mb-8 max-w-2xl text-sm leading-relaxed text-text-400">{t("auto.intro")}</p>

        {loading ? (
          <p className="py-8 text-center text-sm text-text-400">{t("auto.loading")}</p>
        ) : tasks.length === 0 ? (
          <EmptyGuide onPick={handleCreateByChat} />
        ) : (
          <>
            <Section title={t("auto.sectionCurrent")} empty={t("auto.sectionEmptyActive")}>
              {active.map(renderItem)}
            </Section>
            {paused.length > 0 && (
              <Section title={t("auto.sectionPaused")}>{paused.map(renderItem)}</Section>
            )}
          </>
        )}
      </div>

      {manualOpen && <ManualCreateDialog onClose={() => setManualOpen(false)} onCreated={refetch} initialShowTemplates={openWithTemplates} />}
    </div>
  );
}

function Section({ title, empty, children }: {
  title: string; empty?: string; children: React.ReactNode;
}) {
  const { t } = useLocale();
  const items = Array.isArray(children) ? children : [children];
  const isEmpty = items.flat().filter(Boolean).length === 0;
  return (
    <div className="mb-6">
      <div className="mb-2 text-sm font-medium text-text-200">{title}</div>
      <div className="border-t border-border-300 pt-1">
        {isEmpty
          ? <p className="py-6 text-center text-sm text-text-400">{empty ?? t("auto.sectionEmpty")}</p>
          : children}
      </div>
    </div>
  );
}

// 空态引导(2.png)：中央大插画(云朵终端) + 「创建首个自动化」+ 三个横排按钮。
// 三个按钮点击=通过聊天创建：预填对应提示词并跳转新会话页面。
// 时钟图标(3.png 默认)：圆 + 分针指向 12、时针指向 8（上午 8 点）。
const CLOCK_ICON = (
  <svg viewBox="0 0 96 96" className="h-full w-full" fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="48" cy="48" r="34" />
    <path d="M48 48V24M48 48L31 58" />
  </svg>
);

// localcoding 图标：圆形窗口(本地环境/设备) + 顶部双圆点(应用窗口) + "coding" 文字(编码)。
// 用「在本地跑的编码窗口」表达 localcoding 品牌，与时钟配对即「定时执行编码任务」。
// 双圆点用零长度 path + 圆头 strokeLinecap 渲染成实心点；文字用 fill 跟随 currentColor。
const LOCALCODING_ICON = (
  <svg viewBox="0 0 96 96" className="h-full w-full" fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="48" cy="48" r="34" />
    <path d="M42 33h0" strokeWidth="3.5" />
    <path d="M54 33h0" strokeWidth="3.5" />
    <text x="48" y="58" textAnchor="middle" fontSize="18" fontWeight="800" fontFamily="ui-monospace, monospace" fill="currentColor" stroke="none">coding</text>
  </svg>
);

// 中央大插画：默认时钟，每 2 秒逆时针旋转 180° 切换到 localcoding 图标，循环。
// transform 用负角=逆时针；切到下一张时角度继续累减，保证始终同向转动。
// 注意：页面切后台时必须暂停计时器，否则 setInterval 仍推进 step、而 CSS 过渡被冻结，
// 切回前台时会把累积的多圈一次性补播 → 表现为「先飞快转圈再正常」。
function RotatingIcon() {
  const [step, setStep] = useState(0);
  useEffect(() => {
    let id: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (id == null) id = setInterval(() => setStep((s) => s + 1), 2000);
    };
    const stop = () => {
      if (id != null) { clearInterval(id); id = null; }
    };
    const onVisibility = () => (document.hidden ? stop() : start());
    if (!document.hidden) start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => { stop(); document.removeEventListener("visibilitychange", onVisibility); };
  }, []);
  const showClock = step % 2 === 0;
  return (
    <div className="relative mb-6 h-28 w-28 text-text-100">
      <div
        className="h-full w-full transition-transform duration-700 ease-in-out"
        style={{ transform: `rotate(${-step * 180}deg)` }}
      >
        {/* 两张图叠放，用 opacity 交叉淡入淡出 */}
        <div className="absolute inset-0 transition-opacity duration-700 ease-in-out" style={{ opacity: showClock ? 1 : 0 }}>
          {CLOCK_ICON}
        </div>
        {/* localcoding 图标预旋转 180° 补偿外层奇数次 180° 旋转，使 "coding" 始终正向 */}
        <div className="absolute inset-0 rotate-180 transition-opacity duration-700 ease-in-out" style={{ opacity: showClock ? 0 : 1 }}>
          {LOCALCODING_ICON}
        </div>
      </div>
    </div>
  );
}

const GUIDE_ICONS: Record<string, React.ReactNode> = {
  briefing: <><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" /></>,
  review: <><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M3 10h18M8 2v4M16 2v4" /></>,
  monitor: <><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h6" /><path d="M14 3v5h5" /><circle cx="16.5" cy="16.5" r="3" /><path d="m21 21-1.9-1.9" /></>,
};

function EmptyGuide({ onPick }: { onPick: (prompt: string) => void }) {
  const { t } = useLocale();
  const cards = [
    { key: "briefing", title: t("auto.guideBriefingTitle"), prompt: t("auto.guideBriefingPrompt") },
    { key: "review", title: t("auto.guideReviewTitle"), prompt: t("auto.guideReviewPrompt") },
    { key: "monitor", title: t("auto.guideMonitorTitle"), prompt: t("auto.guideMonitorPrompt") },
  ];
  return (
    <div className="flex flex-col items-center justify-center py-16">
      {/* 大插画图标：时钟 ↔ localcoding 终端，每 2 秒逆时针转动切换 */}
      <RotatingIcon />
      {/* 标题 */}
      <h2 className="mb-6 text-lg font-medium text-text-100">{t("auto.createFirst")}</h2>
      {/* 三个横排按钮：点击=通过聊天创建(预填提示词) */}
      <div className="flex items-center gap-3">
        {cards.map((c) => (
          <button
            key={c.key}
            onClick={() => onPick(c.prompt)}
            className="flex items-center gap-2 rounded-xl border border-border-300 bg-bg-000 px-5 py-3 text-sm font-medium text-text-100 transition-colors hover:border-accent-brand/40 hover:bg-bg-100"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4 text-text-300" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{GUIDE_ICONS[c.key]}</svg>
            {c.title}
          </button>
        ))}
      </div>
    </div>
  );
}
