// composer 上方居中漂浮的「执行过程」状态胶囊（完整步骤藏在展开浮层里）。
// 形态：按内容变宽的居中 chip（非与 composer 等宽的横条），浅 hairline 边框，~28px 圆角胶囊。
// 折叠态主文案固定为「执行过程 · x项 · y完成」概览（出错时「已中断」）；不显示当前步骤名。
//
// 展示态（kind/spinning/autoHideMs）由 getStepDisplay 纯函数派生（stepDisplay.ts），组件只渲染。
// 核心原则：会话状态优先于步骤完成度（running 永不隐藏，error 通用「已中断」，completed 才 5s 隐藏）。
//
// 展开交互（hover 主 + click 固定）：
//  - hover chip 或浮层 → 临时展开；leave 后延迟 150ms 关（进入对方区域取消，故穿越无间隙不消失）
//  - click → pin 固定展开，此后 leave 不关；再 click / Esc / click-outside → 取消 pin
//  - chip 是 <button>，focus 后 Enter/Space 等价 click（键盘可访问）
//  - chip 与浮层同处一个 hover 容器（浮层是 chip 的 absolute 子节点、紧贴无 margin 间隙），
//    鼠标在容器内移动不触发 leave；150ms 延迟关是冗余兜底（覆盖偶发抖动）
//
// 生命周期：组件由 ThreadPane 以 key={activeSessionId} 挂载，切会话即 remount，
// 故所有局部 state（hovering/pinned/hidden）天然按会话隔离，不会跨会话泄漏。

import { useState, useEffect, useRef } from "react";
import { useAppStore } from "../../store/useAppStore";
import { useLocale } from "../../i18n";
import { useClickOutside } from "../../hooks/useClickOutside";
import type { TodoItem } from "../../store/slices/types";
import { StepStatusIcon } from "./StepStatusIcon";
import { StepList } from "./StepList";
import { getStepDisplay } from "./stepDisplay";

// hover 离开后延迟关闭，给鼠标穿越 chip↔浮层的时间（避免间隙导致瞬关）。
const HOVER_CLOSE_DELAY_MS = 150;

export function StepStatusLine() {
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const sessions = useAppStore((s) => s.sessions);
  const activeSession = activeSessionId ? sessions[activeSessionId] : undefined;
  const steps: TodoItem[] = activeSession?.tasks ?? [];
  const sessionStatus = activeSession?.status;
  const { t } = useLocale();

  // 展开 = hover 临时展开 ∪ click 固定展开。两态分离才能：pin 后 leave 不关、hover 走延迟关。
  const [hovering, setHovering] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [hidden, setHidden] = useState(false);
  const open = hovering || pinned;
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // pin 时由 click-outside 关闭（hover 展开不需要，leave 会自然关）。
  const panelRef = useClickOutside<HTMLDivElement>(pinned, () => { setPinned(false); setHovering(false); });

  const total = steps.length;
  const done = steps.filter((s) => s.status === "completed").length;
  // 单一展示态：会话状态 × 步骤完成度 派生。render/icon/auto-hide 都读它。
  const display = getStepDisplay(sessionStatus, steps, t);

  // hover 进入：取消待关 timer，标记 hovering。
  const onEnter = () => {
    if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; }
    setHovering(true);
  };
  // hover 离开：延迟关（pin 时不影响 open，因 open=hovering||pinned）。
  const onLeave = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setHovering(false), HOVER_CLOSE_DELAY_MS);
  };
  // 卸载清 timer。
  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current); }, []);

  // 自动隐藏只读 display.autoHideMs：非 null（仅 completed）才挂 timer；其余态恢复显示。
  // 关键：用户正展开查看（open）时不计时——用户主动交互优先于系统自动隐藏，避免吞掉正在看的清单。
  useEffect(() => {
    if (display.autoHideMs === null || open) {
      if (display.autoHideMs === null) setHidden(false);
      return;
    }
    const timer = setTimeout(() => setHidden(true), display.autoHideMs);
    return () => clearTimeout(timer);
  }, [display.kind, display.autoHideMs, open]);

  // 隐藏时收起展开（含取消 pin），避免下次出现残留展开态。
  useEffect(() => {
    if (hidden) { setPinned(false); setHovering(false); }
  }, [hidden]);

  // 键盘关闭（a11y）：展开时按 Esc 收起（取消 pin + hover）。
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setPinned(false); setHovering(false); } };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  if (total === 0 || hidden) return null;

  const progressText = t("thread.tasksProgress", { total: String(total), done: String(done) });
  const isError = display.kind === "interrupted";
  // 胶囊折叠态主文案：固定「执行过程 · x项 · y完成」概览（不再显示当前步骤名）；出错时显示「已中断」。
  // 概览已含计数，故右侧不再单独重复 x/y。
  const chipLabel = isError ? t("thread.stepsInterrupted") : t("thread.stepsOverview", { total: String(total), done: String(done) });
  // 左侧图标随 kind：interrupted 单独红色警示；其余映射到三态图标（running→spinner 转）。
  const leadStatus: TodoItem["status"] =
    display.kind === "running" ? "in_progress"
    : display.kind === "completed" ? "completed"
    : "pending";

  return (
    // 外层：居中容器（不占满 composer 宽度）。hover 进出 + click-outside 锚点都挂这里。
    <div className="mb-1.5 flex w-full justify-center">
      <div
        ref={panelRef}
        className="relative"
        onMouseEnter={onEnter}
        onMouseLeave={onLeave}
      >
        {/* 展开浮层：相对 chip 居中向上弹出，紧贴 chip（无 margin 间隙，作为同容器 DOM 子节点
            鼠标穿越不触发容器 leave）。max-w 防极窄 pane 溢出；居中基准随居中的 chip。 */}
        {open && (
          <div className="absolute bottom-full left-1/2 mb-px w-[360px] max-w-[92vw] -translate-x-1/2 overflow-hidden rounded-xl border border-border-300 bg-bg-000 shadow-lg">
            <div className="flex items-center justify-between border-b border-border-200 px-3 py-2">
              <span className="text-[11px] font-medium text-text-400">{t("thread.stepsTitle")}</span>
              <span className="text-[11px] tabular-nums text-text-400">{progressText}</span>
            </div>
            <div className="max-h-[40vh] overflow-y-auto px-2 py-2 [scrollbar-gutter:stable]">
              <StepList steps={steps} spinning={display.spinning} />
            </div>
          </div>
        )}

        {/* 折叠态：居中漂浮胶囊（按内容变宽，浅 hairline 边框，~28px 圆角） */}
        <button
          type="button"
          onClick={() => {
            // click 切换可见性，且收起时一并清 hovering——否则 hover 仍撑着 open，点击像「失灵」。
            if (open) { setPinned(false); setHovering(false); }
            else setPinned(true);
          }}
          aria-expanded={open}
          aria-label={chipLabel}
          className={`flex h-7 max-w-[60vw] items-center gap-2 rounded-full border px-3 text-xs shadow-sm transition-colors ${
            isError
              ? "border-red-500/30 bg-red-500/5"
              : "border-border-200/60 bg-bg-000 hover:bg-bg-100"
          }`}
        >
          {isError ? (
            <span className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center text-red-500">
              <svg viewBox="0 0 16 16" aria-hidden="true" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.6">
                <circle cx="8" cy="8" r="6.5" /><path d="M8 4.5v4M8 11h.01" strokeLinecap="round" />
              </svg>
            </span>
          ) : (
            <StepStatusIcon status={leadStatus} spinning={display.spinning} />
          )}
          <span className={`min-w-0 truncate ${isError ? "text-red-500" : "text-text-300"}`}>{chipLabel}</span>
          {/* caret：默认弱，hover 时清楚 */}
          <svg
            viewBox="0 0 24 24"
            aria-hidden="true"
            className={`h-3 w-3 shrink-0 text-text-400/50 transition-all ${open ? "" : "rotate-180"}`}
            fill="none" stroke="currentColor" strokeWidth="2"
          >
            <path d="M6 15l6-6 6 6" />
          </svg>
        </button>
      </div>
    </div>
  );
}
