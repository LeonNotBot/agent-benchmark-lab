// 展开态步骤清单（轻量，不像 dashboard）。由 StepStatusLine 点击展开。
// 渲染每个步骤：StepStatusIcon + 文案（completed 划线变灰，in_progress 加粗）。
// 仅渲染条目列表，外层浮层容器/表头由 StepStatusLine 负责。

import type { TodoItem } from "../../store/slices/types";
import { StepStatusIcon } from "./StepStatusIcon";

interface Props {
  steps: TodoItem[];
  // 会话仍在运行时 in_progress 才转圈；中断/完成后停转。
  spinning: boolean;
}

export function StepList({ steps, spinning }: Props) {
  return (
    <ul className="space-y-0.5">
      {steps.map((s, i) => {
        // 兜底：activeForm/content 皆空时（CLI 写了无 subject 的任务）用占位，避免空行。
        const label = (s.status === "in_progress" ? (s.activeForm || s.content) : s.content) || `#${s.id}`;
        return (
          <li
            key={s.id || i}
            className={`flex items-start gap-2 rounded-md px-2 py-1.5 text-[13px] ${
              s.status === "in_progress" ? "bg-bg-200" : ""
            }`}
          >
            <StepStatusIcon status={s.status} spinning={spinning} className="mt-0.5" />
            <span
              className={`flex-1 leading-snug ${
                s.status === "completed"
                  ? "text-text-400 line-through"
                  : s.status === "in_progress"
                    ? "font-medium text-text-100"
                    : "text-text-200"
              }`}
            >
              {label}
              {s.critical && (
                <span
                  className={`ml-1.5 inline-block h-2 w-2 shrink-0 rounded-full align-middle
                    bg-accent-pro-000 ring-2 ring-accent-pro-000/20
                    ${s.status === "in_progress" ? "animate-pulse" : "opacity-75"}`}
                  title="关键步骤（已用更强模型处理）"
                />
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
