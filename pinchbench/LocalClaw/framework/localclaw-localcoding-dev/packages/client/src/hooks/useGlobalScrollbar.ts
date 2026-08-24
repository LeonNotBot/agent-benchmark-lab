// 全局滚动条显隐：默认隐藏滚动条，任意容器滚动时临时显示，停止 1.5s 后隐藏。
// scroll 事件不冒泡，故在 document 捕获阶段监听，可覆盖所有滚动容器。
//
// 注意：不能用 class 标记滚动元素。assistant-ui 的 Viewport 用 MutationObserver
// 监听子树属性变化触发自动滚动，且只豁免 style 属性（不豁免 class）。若给滚动元素
// 加/删 class，会被误判为内容变化 → 触发 scrollToBottom，导致向上滚动被反复拽回。
// 因此改用内联 style 设置 CSS 变量（style 变化被 MutationObserver 豁免），
// 由 ::-webkit-scrollbar-thumb 读取该变量决定颜色。
import { useEffect } from "react";

const IDLE_MS = 1500;
const VAR = "--sb-thumb";
const SHOW = "#d6d6d6";

export function useGlobalScrollbar() {
  useEffect(() => {
    // 每个滚动元素维护独立的隐藏定时器
    const timers = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>();

    const onScroll = (e: Event) => {
      const el = e.target as Node | null;
      // document 滚动时 target 是 document，落到根元素上
      const node = (el instanceof HTMLElement
        ? el
        : (document.scrollingElement as HTMLElement | null));
      if (!node) return;

      node.style.setProperty(VAR, SHOW);
      const prev = timers.get(node);
      if (prev) clearTimeout(prev);
      timers.set(
        node,
        setTimeout(() => {
          node.style.removeProperty(VAR);
          timers.delete(node);
        }, IDLE_MS),
      );
    };

    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    return () => {
      document.removeEventListener("scroll", onScroll, { capture: true } as any);
    };
  }, []);
}
