// 右上角创建分裂按钮(图 22.png)：主按钮默认「通过聊天创建」，右侧箭头展开菜单。
// 每次进入页面主按钮固定显示「通过聊天创建」；当前页面内可临时切到「手动创建」，
// 但不再跨会话记忆——离开后重新进入仍回到 chat。
import { useEffect, useRef, useState } from "react";
import { useLocale } from "../i18n";

type CreateMode = "chat" | "manual";

interface Props {
  onCreateByChat: () => void;
  onCreateManually: () => void;
}

const CHAT_ICON = <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />;
const MANUAL_ICON = (
  <>
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
    <path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z" />
  </>
);
const MODE_KEY: Record<CreateMode, string> = { chat: "auto.createByChat", manual: "auto.createManual" };

export function CreateMenu({ onCreateByChat, onCreateManually }: Props) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  // 每次挂载固定从 chat 起步，不读取历史选择。
  const [mode, setMode] = useState<CreateMode>("chat");
  const ref = useRef<HTMLDivElement>(null);

  // 点击外部关闭菜单
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [open]);

  const run = (m: CreateMode) => (m === "chat" ? onCreateByChat() : onCreateManually());

  // 选择某方式：当前页面内临时切换(不持久化) → 执行
  const select = (m: CreateMode) => {
    setMode(m);
    setOpen(false);
    run(m);
  };

  return (
    <div ref={ref} className="relative">
      <div className="flex items-center rounded-lg bg-accent-brand text-white shadow-soft overflow-hidden">
        <button
          onClick={() => run(mode)}
          className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium hover:bg-accent-hover transition-colors"
        >
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            {mode === "chat" ? CHAT_ICON : MANUAL_ICON}
          </svg>
          {t(MODE_KEY[mode])}
        </button>
        <span className="h-4 w-px bg-white/25" />
        <button
          onClick={() => setOpen((v) => !v)}
          aria-label={t("auto.moreCreateWays")}
          className="flex items-center justify-center px-2 py-1.5 hover:bg-accent-hover transition-colors"
        >
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
      </div>

      {open && (
        <div className="absolute right-0 top-full mt-1.5 w-44 rounded-xl border border-border-300 bg-bg-000 py-1.5 shadow-elevated z-20">
          <MenuItem label={t(MODE_KEY.chat)} active={mode === "chat"} onClick={() => select("chat")}>
            {CHAT_ICON}
          </MenuItem>
          <MenuItem label={t(MODE_KEY.manual)} active={mode === "manual"} onClick={() => select("manual")}>
            {MANUAL_ICON}
          </MenuItem>
        </div>
      )}
    </div>
  );
}

function MenuItem({ label, active, onClick, children }: {
  label: string; active?: boolean; onClick: () => void; children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-[13px] hover:bg-bg-200 transition-colors ${active ? "text-accent-text font-medium" : "text-text-100"}`}
    >
      <svg viewBox="0 0 24 24" className={`h-4 w-4 shrink-0 ${active ? "text-accent-brand" : "text-text-300"}`} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        {children}
      </svg>
      {label}
    </button>
  );
}
