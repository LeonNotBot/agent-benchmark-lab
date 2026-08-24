// 覆盖类面板（设置 / 搜索 / 插件 / 自动化）的统一外壳：
// 复用首页中间面板的圆角 + 左侧描边 + 阴影，保证视觉一致。
// 内容组件只需 flex-1 填充即可，不再各自维护圆角/定位。
import type { ReactNode } from "react";

export function PanelSurface({ children }: { children: ReactNode }) {
  return (
    <main className="relative flex flex-1 flex-col min-w-0 overflow-hidden rounded-l-lg border-l border-y border-border-200 bg-bg-000 shadow-[-4px_0_16px_rgba(0,0,0,0.04)]">
      {children}
    </main>
  );
}
