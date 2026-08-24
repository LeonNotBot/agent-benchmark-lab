// 步骤状态图标（三态）。数据层（CLI 任务 JSON）只有 pending/in_progress/completed，
// 不照搬 claude-code 终端的方块字符，用 web 地道的 SVG/CSS：
//  - pending     灰色空心圆
//  - in_progress CSS spinner 圆环（运行中转圈；会话非 running 时停转，表示挂起）
//  - completed   绿色 check-circle
// 「失败/取消/暂停」无任务级数据来源，故不做 step 级图标（会话级 error 由 StepStatusLine 行级处理）。

import type { TodoItem } from "../../store/slices/types";

interface Props {
  status: TodoItem["status"];
  // 会话仍在运行时 in_progress 才转圈；中断/完成后停转，避免“假活跃”。
  spinning: boolean;
  className?: string;
}

export function StepStatusIcon({ status, spinning, className = "" }: Props) {
  const box = `inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center ${className}`;

  if (status === "completed") {
    return (
      <span className={`${box} text-emerald-500`}>
        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.6">
          <circle cx="8" cy="8" r="6.5" />
          <path d="M5 8.2l2 2 4-4.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    );
  }

  if (status === "in_progress") {
    // 缺口=转、完整=停：spinning 时用顶部透明的缺口环 + 旋转（标准 spinner）；
    // 停转（中断/挂起）时切成完整淡色环，避免"缺口环静止"被误读成卡死。
    return (
      <span className={box}>
        {spinning ? (
          <span className="h-3 w-3 rounded-full border-2 border-accent-brand border-t-transparent animate-spin" />
        ) : (
          <span className="h-3 w-3 rounded-full border-2 border-accent-brand/60" />
        )}
      </span>
    );
  }

  // pending：灰色空心圆
  return (
    <span className={`${box} text-text-400`}>
      <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.6">
        <circle cx="8" cy="8" r="6.5" />
      </svg>
    </span>
  );
}
