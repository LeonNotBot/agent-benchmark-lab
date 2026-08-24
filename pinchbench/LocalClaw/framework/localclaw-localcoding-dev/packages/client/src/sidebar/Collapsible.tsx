// 折叠/展开容器：用 grid-template-rows 1fr→0fr 做"高度无关"的平滑塌缩 + 渐隐。
// 与 CollapsibleRow 同源，但由 open 受控、可反复开合（无删除回调语义）。
import type { ReactNode } from "react";

interface Props {
  open: boolean;          // true 展开，false 收起
  children: ReactNode;
}

export function Collapsible({ open, children }: Props) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateRows: open ? "1fr" : "0fr",
        opacity: open ? 1 : 0,
        // grid-template-rows 动画与高度无关，无需测量 DOM
        transition: "grid-template-rows 220ms ease, opacity 150ms ease",
      }}
    >
      {/* min-height:0 + overflow:hidden 让 grid 行可塌缩到 0 并裁切内容 */}
      <div style={{ overflow: "hidden", minHeight: 0 }}>{children}</div>
    </div>
  );
}
