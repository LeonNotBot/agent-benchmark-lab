// 右面板"收起/展开"浮动按钮：绝对定位在内容区右上角，全局可见。
// 不放在面板内部，避免面板收起(width:0)后被裁切而消失。
// 与 tabbar 的全屏按钮是两个独立功能：本按钮只切 420px 侧开 ↔ 收起。
import { useWorkbenchStore } from "./store";
import { useLocale } from "../i18n";

export function RightPanelToggle() {
  const rightPanelOpen = useWorkbenchStore((s) => s.rightPanelOpen);
  const setRightPanelOpen = useWorkbenchStore((s) => s.setRightPanelOpen);
  const setFullscreen = useWorkbenchStore((s) => s.setWorkbenchFullscreen);
  const { t } = useLocale();

  const toggle = () => {
    if (rightPanelOpen) setRightPanelOpen(false);
    else setRightPanelOpen(true);
    setFullscreen(false);
  };

  return (
    <button
      onClick={toggle}
      aria-label={rightPanelOpen ? t("workbench.collapsePanel") : t("workbench.expandPanel")}
      title={rightPanelOpen ? t("workbench.collapsePanel") : t("workbench.expandPanel")}
      className={`absolute right-2 top-2 z-30 flex h-7 w-7 items-center justify-center rounded-md transition-colors ${
        rightPanelOpen
          ? "text-text-200 hover:bg-bg-200 hover:text-text-100"
          : "text-text-400 hover:bg-bg-200 hover:text-text-200"
      }`}
    >
      <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <path d="M15 3v18" />
      </svg>
    </button>
  );
}
