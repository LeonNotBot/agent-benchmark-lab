import { useCallback, useState } from "react";
import { useAppStore } from "../store/useAppStore";
import { SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH } from "../sidebar/store/sidebarSlice";

// 拖到最小宽度后，鼠标再向左多移动这么多像素就触发收起动画
const COLLAPSE_OVERSHOOT = 80;

export function useSidebarResize() {
  const sidebarWidth = useAppStore((s) => s.sidebarWidth);
  const setSidebarWidth = useAppStore((s) => s.setSidebarWidth);
  const setSidebarOpen = useAppStore((s) => s.setSidebarOpen);
  const [isDragging, setIsDragging] = useState(false);
  // 拖拽中的临时宽度；null 表示未拖拽
  const [dragWidth, setDragWidth] = useState<number | null>(null);

  const handleDragStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setIsDragging(true);
      const startX = e.clientX;
      const startWidth = sidebarWidth;
      let current = startWidth;

      const cleanup = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        setIsDragging(false);
        setDragWidth(null);
      };

      const onMove = (ev: MouseEvent) => {
        // 鼠标位置对应的理论宽度（可能低于最小宽度）
        const raw = startWidth + (ev.clientX - startX);
        // 越过“最小宽度再往左 OVERSHOOT 像素” → 实时触发收起动画
        if (raw < SIDEBAR_MIN_WIDTH - COLLAPSE_OVERSHOOT) {
          cleanup();
          // 宽度保持上次合法值，供下次展开
          setSidebarWidth(Math.max(SIDEBAR_MIN_WIDTH, startWidth));
          setSidebarOpen(false);
          return;
        }
        // 否则钉在 [MIN, MAX] 区间内，不会继续变窄
        current = Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, raw));
        setDragWidth(current);
      };

      const onUp = () => {
        cleanup();
        setSidebarWidth(current);
      };

      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [sidebarWidth, setSidebarWidth, setSidebarOpen],
  );

  return { isDragging, dragWidth, handleDragStart };
}
