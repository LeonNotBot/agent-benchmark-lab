import { useEffect, useRef } from "react";

/**
 * 当 active 为 true 时，监听 document pointerdown：点到 ref 容器外部即调用 onOutside
 * （典型用途：下拉/弹出菜单的「点外部关闭」）。active 为 false 时不挂监听。
 *
 * 返回挂到容器元素上的 ref。监听随 active / onOutside 变化重挂，组件卸载时清理。
 */
export function useClickOutside<T extends HTMLElement = HTMLDivElement>(
  active: boolean,
  onOutside: () => void,
): React.RefObject<T | null> {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (!active) return;
    const onPointerDown = (ev: PointerEvent) => {
      if (ref.current && !ref.current.contains(ev.target as Node)) {
        onOutside();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [active, onOutside]);
  return ref;
}
