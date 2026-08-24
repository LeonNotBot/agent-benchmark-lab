// 监听应用窗口的前台/后台状态，把结果写到 documentElement 的
// data-app-focused 属性上，供 CSS（.chrome-surface）切换顶栏/侧边栏背景色。
// 同时兼容 Electron（window focus/blur）与纯浏览器（visibilitychange）。
import { useEffect } from "react";

export function useAppFocus() {
  useEffect(() => {
    const root = document.documentElement;

    const apply = (focused: boolean) => {
      root.setAttribute("data-app-focused", focused ? "true" : "false");
    };

    const onFocus = () => apply(true);
    const onBlur = () => apply(false);
    const onVisibility = () => apply(document.visibilityState === "visible" && document.hasFocus());

    // 初始态：当前是否聚焦
    apply(document.hasFocus());

    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", onBlur);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);
}
