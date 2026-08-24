// 中间面板顶部标题栏：仅展示当前会话标题。
// 任务/右面板入口已迁出（任务→Workbench tasks 标签；右面板开关→AppShell 浮动按钮）。
import { useAppStore } from "../store/useAppStore";
import { useLocale } from "../i18n";

export function ThreadHeader() {
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const sessions = useAppStore((s) => s.sessions);
  const { t } = useLocale();
  const activeSession = activeSessionId ? sessions[activeSessionId] : undefined;
  const title = activeSession?.title || t("thread.untitled");

  return (
    <div className="flex h-11 shrink-0 items-center border-b border-border-200 px-4 min-w-0">
      <span className="min-w-0 flex-1 truncate text-[14px] font-bold text-text-100">
        {title}
      </span>
    </div>
  );
}
