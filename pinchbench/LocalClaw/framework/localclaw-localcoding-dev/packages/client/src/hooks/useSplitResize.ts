import { useCallback, useState } from "react";
import { SK } from "../store/storageKeys";

// 左右分栏（左预览 / 右文件列表）中，右侧列表面板的拖拽调宽 + 阈值收起。
// 手柄在两栏之间：向右拖 → 列表变窄；向左拖 → 列表变宽。
// 列表窄于 MIN_WIDTH 后再向右多拖 COLLAPSE_OVERSHOOT 像素 → 触发收起动画。
const MIN_WIDTH = 120;
const MAX_WIDTH = 480;
const DEFAULT_WIDTH = 260;
const COLLAPSE_OVERSHOOT = 60;

function readInitialWidth(): number {
  const saved = localStorage.getItem(SK.SPLIT_FILE_LIST_WIDTH);
  if (saved) {
    const n = parseInt(saved, 10);
    if (!Number.isNaN(n)) return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, n));
  }
  return DEFAULT_WIDTH;
}

export function useSplitResize(onCollapse?: () => void) {
  const [listWidth, setListWidth] = useState(readInitialWidth);
  const [isDragging, setIsDragging] = useState(false);

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    const startX = e.clientX;
    const startWidth = listWidth;
    let currentWidth = startWidth;

    const cleanup = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      setIsDragging(false);
    };

    const onMove = (ev: MouseEvent) => {
      // 手柄在列表左缘：向右拖(delta>0)使列表变窄
      const delta = ev.clientX - startX;
      const raw = startWidth - delta;
      // 越过「最小宽度再向右 OVERSHOOT」→ 触发收起
      if (raw < MIN_WIDTH - COLLAPSE_OVERSHOOT) {
        cleanup();
        // 保留上次合法宽度供再次展开
        localStorage.setItem(SK.SPLIT_FILE_LIST_WIDTH, String(Math.max(MIN_WIDTH, currentWidth)));
        onCollapse?.();
        return;
      }
      currentWidth = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, raw));
      setListWidth(currentWidth);
    };

    const onUp = () => {
      cleanup();
      localStorage.setItem(SK.SPLIT_FILE_LIST_WIDTH, String(currentWidth));
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [listWidth, onCollapse]);

  return { listWidth, setListWidth, isDragging, handleDragStart };
}
