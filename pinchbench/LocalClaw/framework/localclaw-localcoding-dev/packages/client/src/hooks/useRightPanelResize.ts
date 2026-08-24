import { useCallback, useState } from "react";
import { SK } from "../store/storageKeys";

const LEGACY_RIGHT_PANEL_WIDTH = "localclaw:rightPanelWidth";
const RIGHT_PANEL_MIN_WIDTH = 280;
// 拖到最小宽度后，鼠标再向右多移动这么多像素就触发收起动画
const COLLAPSE_OVERSHOOT = 80;

function readInitialWidth(): number {
  const saved = localStorage.getItem(SK.RIGHT_PANEL_WIDTH);
  if (saved) return parseInt(saved, 10);
  const legacy = localStorage.getItem(LEGACY_RIGHT_PANEL_WIDTH);
  if (legacy) {
    localStorage.setItem(SK.RIGHT_PANEL_WIDTH, legacy);
    localStorage.removeItem(LEGACY_RIGHT_PANEL_WIDTH);
    return parseInt(legacy, 10);
  }
  return 420;
}

export function useRightPanelResize(onCollapse?: () => void) {
  const [rightPanelWidth, setRightPanelWidth] = useState(readInitialWidth);
  const [isDragging, setIsDragging] = useState(false);

  const handlePanelDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    const startX = e.clientX;
    const startWidth = rightPanelWidth;
    let currentWidth = startWidth;

    const cleanup = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      setIsDragging(false);
    };

    const onMove = (ev: MouseEvent) => {
      // 手柄在面板左缘：向左拖(delta>0)变宽，向右拖(delta<0)变窄
      const delta = startX - ev.clientX;
      const raw = startWidth + delta;
      // 越过“最小宽度再向右 OVERSHOOT 像素” → 实时触发收起动画
      if (raw < RIGHT_PANEL_MIN_WIDTH - COLLAPSE_OVERSHOOT) {
        cleanup();
        // 宽度保持上次合法值，供下次展开
        localStorage.setItem(SK.RIGHT_PANEL_WIDTH, String(Math.max(RIGHT_PANEL_MIN_WIDTH, currentWidth)));
        onCollapse?.();
        return;
      }
      const maxW = Math.min(900, Math.max(RIGHT_PANEL_MIN_WIDTH, window.innerWidth - 280 - 240));
      currentWidth = Math.max(RIGHT_PANEL_MIN_WIDTH, Math.min(maxW, raw));
      setRightPanelWidth(currentWidth);
    };

    const onUp = () => {
      cleanup();
      localStorage.setItem(SK.RIGHT_PANEL_WIDTH, String(currentWidth));
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [rightPanelWidth, onCollapse]);

  return { rightPanelWidth, setRightPanelWidth, isDragging, handlePanelDragStart };
}
