// 手动创建弹窗底栏(图 11/22/33/00.png)：运行环境下拉 + 选择项目下拉 + 计划 chip + 帮助 tooltip。
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useLocale } from "../i18n";

export type RunEnv = "local" | "chat";
const RUN_ENV_KEY: Record<RunEnv, string> = { local: "auto.local", chat: "auto.chat" };

function dirName(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || p;
}

// 通用下拉触发器（chip 样式 + 下拉面板）。disabled 时灰显且不可展开（图 36.png）。
// panelClass 控制面板定位，默认向上+左对齐（底栏场景）；侧栏可传向下+右对齐避免被右边框遮挡。
// header：可选的面板顶部标题文案（如「运行环境」，见图 2.png）。
export function Dropdown({ label, disabled, panelClass, header, children }: {
  label: ReactNode; disabled?: boolean; panelClass?: string; header?: string; children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    window.addEventListener("mousedown", h);
    return () => window.removeEventListener("mousedown", h);
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => !disabled && setOpen((v) => !v)}
        disabled={disabled}
        className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors ${disabled ? "text-text-400/50 cursor-not-allowed" : "text-text-300 hover:bg-bg-200"}`}>
        {label}
        <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
      </button>
      {open && !disabled && (
        <div className={`absolute min-w-[150px] rounded-xl border border-border-300 bg-bg-000 py-1.5 shadow-elevated z-30 ${panelClass ?? "bottom-full left-0 mb-1.5"}`}>
          {header && <div className="px-3.5 pb-1 pt-1 text-xs text-text-400">{header}</div>}
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

function Row({ label, active, onClick }: { label: string; active?: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className={`flex w-full items-center gap-2 px-3.5 py-2 text-left text-[13px] transition-colors hover:bg-bg-200 ${active ? "text-accent-text font-medium" : "text-text-100"}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${active ? "bg-accent-brand" : "bg-transparent"}`} />
      {label}
    </button>
  );
}

// 运行环境：本地 / 对话（按需求去掉「工作树」）
export function RunEnvDropdown({ value, onChange }: { value: RunEnv; onChange: (v: RunEnv) => void }) {
  const { t } = useLocale();
  return (
    <Dropdown label={t(RUN_ENV_KEY[value])} header={t("auto.runEnvHeader")}>
      {(close) => (["local", "chat"] as RunEnv[]).map((env) => (
        <Row key={env} label={t(RUN_ENV_KEY[env])} active={value === env} onClick={() => { onChange(env); close(); }} />
      ))}
    </Dropdown>
  );
}

// 选择项目：数据源 = 创建会话时的项目列表(registeredProjects)，不含「聊天」选项
export function ProjectDropdown({ projects, value, onChange, panelClass }: { projects: string[]; value: string; onChange: (p: string) => void; panelClass?: string }) {
  const { t } = useLocale();
  const label = value ? dirName(value) : t("auto.selectProject");
  return (
    <Dropdown panelClass={panelClass} label={<span className="max-w-[140px] truncate">{label}</span>}>
      {(close) => (
        projects.length === 0
          ? <div className="px-3.5 py-2 text-xs text-text-400">{t("auto.noProjects")}</div>
          : projects.map((p) => (
              <Row key={p} label={dirName(p)} active={value === p} onClick={() => { onChange(p); close(); }} />
            ))
      )}
    </Dropdown>
  );
}

// 帮助 tooltip（图 22.png）：悬浮在右上角「使用模板」左侧的 ⓘ 按钮上时展示沙盒说明。
export function HelpTip() {
  const { t } = useLocale();
  return (
    <div className="group/help relative flex items-center">
      <svg viewBox="0 0 24 24" className="h-4 w-4 text-text-400" fill="none" stroke="currentColor" strokeWidth="1.8">
        <circle cx="12" cy="12" r="9" /><path d="M12 11v5" strokeLinecap="round" /><circle cx="12" cy="8" r=".7" fill="currentColor" stroke="none" />
      </svg>
      <div className="pointer-events-none absolute top-full right-0 mt-2 w-72 rounded-xl bg-bg-000 px-3.5 py-2.5 text-[12px] leading-relaxed text-text-200 opacity-0 shadow-elevated border border-border-300 transition-opacity group-hover/help:opacity-100 z-40">
        {t("auto.helpSandboxPrefix")}<span className="text-accent-brand">{t("auto.helpRules")}</span>{t("auto.helpSandboxSuffix")}
      </div>
    </div>
  );
}
