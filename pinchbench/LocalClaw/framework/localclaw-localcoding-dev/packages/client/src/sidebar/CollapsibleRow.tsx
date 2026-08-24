// 行退场折叠容器：用 grid-template-rows 1fr→0fr 做"高度无关"的平滑塌缩 + 渐隐。
// 删除时本行就地塌陷、下方行自然上移，动画结束才真正执行删除（onRemoved）。
// 届时该行已是 0 高度，store 移除时不会产生任何视觉跳动 / 整列表重排闪烁。
import { useRef, type ReactNode } from "react";

interface Props {
  removing: boolean;       // 置 true 触发退场动画
  onRemoved: () => void;   // 塌缩动画结束后回调（此时再发删除事件）
  children: ReactNode;
}

export function CollapsibleRow({ removing, onRemoved, children }: Props) {
  const firedRef = useRef(false);

  return (
    <div
      style={{
        display: "grid",
        gridTemplateRows: removing ? "0fr" : "1fr",
        opacity: removing ? 0 : 1,
        // grid-template-rows 动画与高度无关，无需测量 DOM；下方行随之平滑上移
        transition: "grid-template-rows 220ms ease, opacity 150ms ease",
        pointerEvents: removing ? "none" : undefined,
      }}
      onTransitionEnd={(e) => {
        // 只在塌缩到底（grid-template-rows 过渡结束）时触发一次，避免 opacity 提前触发
        if (removing && e.propertyName === "grid-template-rows" && !firedRef.current) {
          firedRef.current = true;
          onRemoved();
        }
      }}
    >
      {/* min-height:0 + overflow:hidden 让 grid 行可塌缩到 0 并裁切内容 */}
      <div style={{ overflow: "hidden", minHeight: 0 }}>{children}</div>
    </div>
  );
}
