// 自动化列表项：默认显示 名称 + 项目 + 计划(右侧)；
// hover 时右侧出现 立即运行 / 编辑 / 更多选项 三个按钮(图 44.png)，各带 tooltip；
// 点击「更多选项」展开 暂停 / 删除 菜单(图 55.png)。
import { useEffect, useRef, useState } from "react";
import { useLocale } from "../i18n";
import { projectFromCwd, type AutomationTask } from "../api/automation";
import { cronToLabel } from "../api/cronLabel";

interface Props {
  task: AutomationTask;
  running?: boolean;
  onRun: (task: AutomationTask) => void;
  onEdit: (task: AutomationTask) => void;
  onToggle: (task: AutomationTask) => void;
  onDelete: (task: AutomationTask) => void;
  onOpen: (task: AutomationTask) => void;
}

export function AutomationItem({ task, running = false, onRun, onEdit, onToggle, onDelete, onOpen }: Props) {
  const { t } = useLocale();
  const [menuOpen, setMenuOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setMenuOpen(false);
    };
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [menuOpen]);

  const paused = task.status === "paused";

  return (
    <div
      ref={ref}
      onClick={() => onOpen(task)}
      className="group relative flex cursor-pointer items-center gap-3 rounded-lg px-4 py-3 transition-colors hover:bg-bg-200"
    >
      <span className={`h-2 w-2 shrink-0 rounded-full ${paused ? "bg-text-400" : "bg-text-300"}`} />
      <span className="text-sm text-text-100">{task.name}</span>
      <span className="text-xs text-text-400">{projectFromCwd(t, task.cwd)}</span>

      <div className="ml-auto flex items-center">
        {/* 默认显示执行计划，hover 或运行中时淡出让位给操作按钮 */}
        <span className={`text-xs text-text-400 transition-opacity ${running ? "opacity-0" : "group-hover:opacity-0"}`}>
          {cronToLabel(t, task.cron)}
        </span>

        {/* 操作区：hover 显示；运行中常驻可见(否则看不到转圈) */}
        <div className={`absolute right-4 flex items-center gap-1 transition-opacity ${running ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}>
          <IconBtn label={running ? t("auto.running") : t("auto.run")} onClick={() => onRun(task)} busy={running} disabled={running}>
            <polygon points="6 4 18 12 6 20 6 4" fill="currentColor" stroke="none" />
          </IconBtn>
          <IconBtn label={t("auto.edit")} onClick={() => onEdit(task)}>
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
            <path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z" />
          </IconBtn>
          <IconBtn label={t("auto.more")} onClick={() => setMenuOpen((v) => !v)}>
            <circle cx="5" cy="12" r="1.6" fill="currentColor" stroke="none" />
            <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
            <circle cx="19" cy="12" r="1.6" fill="currentColor" stroke="none" />
          </IconBtn>
        </div>
      </div>

      {menuOpen && (
        <div className="absolute right-4 top-full z-20 mt-1 w-32 overflow-hidden rounded-xl border border-border-300 bg-bg-000 py-1.5 shadow-elevated">
          <MenuRow label={paused ? t("auto.resume") : t("auto.pause")} onClick={() => { setMenuOpen(false); onToggle(task); }}>
            {paused ? (
              <polygon points="6 4 18 12 6 20 6 4" fill="currentColor" stroke="none" />
            ) : (
              <><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></>
            )}
          </MenuRow>
          <MenuRow label={t("auto.delete")} danger onClick={() => { setMenuOpen(false); onDelete(task); }}>
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          </MenuRow>
        </div>
      )}
    </div>
  );
}

function IconBtn({ label, onClick, busy, disabled, children }: {
  label: string; onClick: () => void; busy?: boolean; disabled?: boolean; children: React.ReactNode;
}) {
  return (
    <div className="group/btn relative">
      <button
        onClick={(e) => { e.stopPropagation(); if (!disabled) onClick(); }}
        disabled={disabled}
        aria-label={label}
        className="flex h-7 w-7 items-center justify-center rounded-md text-text-400 transition-colors hover:bg-bg-300 hover:text-text-100 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-text-400"
      >
        {busy ? (
          <svg viewBox="0 0 24 24" className="h-4 w-4 animate-spin" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 12a9 9 0 1 1-6.219-8.56" strokeLinecap="round" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            {children}
          </svg>
        )}
      </button>
      {/* tooltip */}
      <span className="pointer-events-none absolute -top-7 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md bg-text-000 px-2 py-1 text-[11px] text-bg-000 opacity-0 transition-opacity group-hover/btn:opacity-100">
        {label}
      </span>
    </div>
  );
}

function MenuRow({ label, danger, onClick, children }: {
  label: string; danger?: boolean; onClick: () => void; children: React.ReactNode;
}) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className={`flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-[13px] transition-colors hover:bg-bg-200 ${danger ? "text-danger" : "text-text-100"}`}
    >
      <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        {children}
      </svg>
      {label}
    </button>
  );
}
