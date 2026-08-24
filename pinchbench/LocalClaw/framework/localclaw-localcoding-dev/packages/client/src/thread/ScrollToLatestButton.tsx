// 「↓ 最新」按钮：自管显隐 + 滚动到底，完全绕开 assistant-ui 的 isAtBottom。
//
// 历史教训：assistant-ui 的 ThreadPrimitive.ScrollToBottom 依赖其内部 isAtBottom，
// 而该状态在本布局（flex 容器 / scrollbar-gutter / 高 DPI）下判定不可靠，反复修正
// 无效。改为直接用 viewport 几何自行判断：diff <= TOLERANCE 即视为到底，隐藏按钮。
//
// 触发源覆盖三类不产生/产生 scroll 事件的场景：
//   - scroll 事件（滚动中）+ 停止后防抖终判（吃掉惯性停驻间隙）
//   - ResizeObserver（内容增减 / 不可滚动时无 scroll 事件）
import { useEffect, useRef, useState } from "react";
import { useThreadViewportStore } from "@assistant-ui/react";
import { useLocale } from "../i18n";

const TOLERANCE_PX = 10;
const SETTLE_MS = 120;
const SCROLL_MS = 280; // 自定义滚动时长，比浏览器 smooth 更快
const FADE_MS = 180; // 渐隐渐显时长

/** requestAnimationFrame 实现的快速 ease-out 滚动到底。
 *  每帧重新读取底部目标：内容在动画期间增长（流式 / 图片加载）时目标实时跟进，
 *  避免朝「开始时的旧底部」滚导致到底后又被拉回的跳动。 */
function fastScrollToBottom(el: HTMLElement) {
  const start = el.scrollTop;
  const t0 = performance.now();
  const step = (now: number) => {
    const p = Math.min(1, (now - t0) / SCROLL_MS);
    const eased = 1 - Math.pow(1 - p, 3); // easeOutCubic
    const target = el.scrollHeight - el.clientHeight; // 每帧重算，跟进内容增长
    el.scrollTop = start + (target - start) * eased;
    if (p < 1) {
      requestAnimationFrame(step);
    } else {
      el.scrollTop = el.scrollHeight - el.clientHeight; // 收尾对齐真正底部
    }
  };
  requestAnimationFrame(step);
}

export function ScrollToLatestButton() {
  const store = useThreadViewportStore();
  const { t } = useLocale();
  const [show, setShow] = useState(false);
  const [mounted, setMounted] = useState(false); // 退场动画期间保留 DOM
  const [visible, setVisible] = useState(false); // 实际 opacity，挂载后下一帧才置 1
  const elRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    let el: HTMLElement | null = null;
    let settleTimer: ReturnType<typeof setTimeout> | null = null;

    const compute = () => {
      if (!el) return;
      const diff = el.scrollHeight - el.scrollTop - el.clientHeight;
      const canScroll = el.scrollHeight > el.clientHeight + TOLERANCE_PX;
      setShow(canScroll && diff > TOLERANCE_PX);
    };

    const ro = new ResizeObserver(compute);

    const onScroll = () => {
      compute();
      if (settleTimer) clearTimeout(settleTimer);
      settleTimer = setTimeout(compute, SETTLE_MS);
    };

    const bind = () => {
      const next = store.getState().element?.viewport ?? null;
      if (next === el) return;
      if (el) {
        el.removeEventListener("scroll", onScroll);
        ro.disconnect();
      }
      el = next;
      elRef.current = el;
      if (el) {
        el.addEventListener("scroll", onScroll, { passive: true });
        ro.observe(el);
        if (el.firstElementChild) ro.observe(el.firstElementChild);
        compute();
      }
    };

    bind();
    const unsub = store.subscribe(bind);
    return () => {
      unsub();
      ro.disconnect();
      if (settleTimer) clearTimeout(settleTimer);
      if (el) el.removeEventListener("scroll", onScroll);
    };
  }, [store]);

  // show 切换时驱动挂载/卸载与 opacity，分别播放淡入 / 淡出
  useEffect(() => {
    if (show) {
      setMounted(true);
      // 挂载后下一帧再置 visible，保证 opacity 从 0→1 触发淡入过渡
      const r = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(r);
    }
    setVisible(false);
    const t = setTimeout(() => setMounted(false), FADE_MS);
    return () => clearTimeout(t);
  }, [show]);

  if (!mounted) return null;

  return (
    <button
      aria-label={t("thread.scrollToBottom")}
      onClick={() => {
        const el = elRef.current;
        if (el) fastScrollToBottom(el);
      }}
      style={{ transition: `opacity ${FADE_MS}ms ease`, opacity: visible ? 1 : 0 }}
      className="pointer-events-auto absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full border border-border-300 bg-bg-000 px-3 py-1.5 text-xs text-text-300 shadow-md hover:bg-bg-100"
    >
      {t("thread.latest")}
    </button>
  );
}
