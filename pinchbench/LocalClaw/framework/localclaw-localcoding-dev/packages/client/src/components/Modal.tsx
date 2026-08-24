import { useEffect, useRef, type ReactNode } from "react";

interface ModalProps {
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  /** 底部按钮区，右对齐排列 */
  footer?: ReactNode;
  /** 面板最大宽度：确认框用 sm，表单用 md（默认） */
  size?: "sm" | "md";
  /** 打开时是否自动聚焦面板内首个可聚焦元素，默认 true */
  autoFocus?: boolean;
}

/** 统一的二级弹窗基座：遮罩 + 面板 + 标题 + 底部按钮槽。
 *  统一层级(z-[90])、遮罩点击关闭、Esc 关闭、自动聚焦、深浅色，
 *  各业务弹窗只需填 children 与 footer，不再各自搓遮罩/面板。 */
export function Modal({ onClose, title, children, footer, size = "md", autoFocus = true }: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  // Esc 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // 打开时聚焦面板内首个可聚焦元素（输入框优先）
  useEffect(() => {
    if (!autoFocus) return;
    const el = panelRef.current?.querySelector<HTMLElement>(
      "input, textarea, select, button, [tabindex]"
    );
    el?.focus();
  }, [autoFocus]);

  // 卸载时强制一次合成层重绘：带 backdrop-filter 的全屏遮罩在 Electron/Chromium 下卸载时，
  // GPU 合成层可能残留一层透明“幽灵层”继续拦截指针事件，导致随后渲染的 input 点不动。
  // 下面在弹窗卸载后 nudge 一次 body transform 触发重绘。
  useEffect(() => {
    return () => {
      requestAnimationFrame(() => {
        document.body.style.transform = "translateZ(0)";
        requestAnimationFrame(() => { document.body.style.transform = ""; });
      });
    };
  }, []);

  const maxW = size === "sm" ? "max-w-sm" : "max-w-md";

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-text-000/40 backdrop-blur-sm animate-fade-in"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        className={`relative mx-4 w-full ${maxW} ${modalPanel} p-6`}
        onClick={(e) => e.stopPropagation()}
      >
        <ModalCloseButton onClose={onClose} />
        {title && <h3 className={modalTitle}>{title}</h3>}
        {children}
        {footer && <div className="mt-5 flex justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}

/** 统一的右上角关闭按钮。大弹窗（未直接用 Modal 组件）也复用它，保证关闭交互一致。 */
export function ModalCloseButton({ onClose, label }: { onClose: () => void; label?: string }) {
  return (
    <button
      onClick={onClose}
      aria-label={label ?? "关闭"}
      className="absolute right-4 top-4 flex h-7 w-7 items-center justify-center rounded-lg text-text-400 transition-colors hover:bg-bg-200 hover:text-text-200"
    >
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M6 6l12 12M18 6L6 18" />
      </svg>
    </button>
  );
}

// 统一的弹窗外壳与内元素样式，供各业务弹窗（含无法直接用 Modal 组件的大弹窗）复用，
// 保证面板圆角/边框/阴影、标题、输入框、按钮在全站一致，避免类名各写各的而腐化。
export const modalPanel = "rounded-2xl border border-border-300 bg-bg-000 shadow-xl";
export const modalTitle = "text-base font-semibold text-text-100";
export const modalInput =
  "w-full rounded-lg border border-border-300 bg-bg-000 px-3 py-2 text-sm text-text-100 outline-none placeholder:text-text-400 focus:border-accent-brand disabled:opacity-50 transition-colors";
export const modalCancelBtn =
  "rounded-lg border border-border-300 px-4 py-2 text-sm text-text-200 hover:bg-bg-200 transition-colors";
export const modalPrimaryBtn =
  "rounded-lg bg-accent-brand px-5 py-2 text-sm text-white hover:opacity-90 disabled:opacity-50 transition-opacity";
export const modalDangerBtn =
  "rounded-lg bg-danger px-5 py-2 text-sm text-white hover:opacity-90 transition-opacity";
