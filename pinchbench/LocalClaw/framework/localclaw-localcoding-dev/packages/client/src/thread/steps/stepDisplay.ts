// 步骤状态行的展示态派生——一个小纯函数，统一所有显隐/文案/动效判断。
// 解决的根因：render、icon、auto-hide 各自散判迟早不一致。让组件只负责渲染，
// 业务态判断全在这里。核心原则：会话状态优先于步骤完成度。
//   running   会话运行中 → 显示当前步骤(无则 fallback)，spinner 转，永不隐藏
//             （即使 todos 全完成、会话仍在收尾，也保持 running，不退成概览/隐藏）
//   interrupted 会话 error → 通用「已中断」，不猜具体步骤（后端无 failedStepId）
//   completed 会话已停 且 全部完成 → 「N 项完成」，5s 后自动隐藏
//   overview  其余 → 概览「N 项 · M 完成」，不自动隐藏
// label 在此层保证永远非空（渲染层无需再兜底折叠行文案）。

import type { TodoItem } from "../../store/slices/types";
import type { SessionStatus } from "@lenovo/agent-protocol";

type TFn = (key: string, params?: Record<string, string>) => string;

export type StepDisplayKind = "running" | "interrupted" | "completed" | "overview";

export interface StepDisplay {
  kind: StepDisplayKind;
  label: string;        // 折叠行主文案，保证非空
  spinning: boolean;    // 左侧图标是否转圈（仅 running）
  autoHideMs: number | null; // 非 null = 该 kind 停留多久后自动隐藏（仅 completed）
}

export function getStepDisplay(
  sessionStatus: SessionStatus | undefined,
  steps: TodoItem[],
  t: TFn,
): StepDisplay {
  const total = steps.length;
  const done = steps.filter((s) => s.status === "completed").length;
  const inProgress = steps.find((s) => s.status === "in_progress");

  // 会话状态优先于步骤完成度。
  if (sessionStatus === "error") {
    return { kind: "interrupted", label: t("thread.stepsInterrupted"), spinning: false, autoHideMs: null };
  }
  if (sessionStatus === "running") {
    // 当前步骤的进行时态；无 active step（全完成仍在收尾 / 尚未建步骤）时 fallback。
    const label = inProgress?.activeForm || inProgress?.content || t("thread.stepsRunning");
    return { kind: "running", label, spinning: true, autoHideMs: null };
  }
  if (total > 0 && done === total) {
    return { kind: "completed", label: t("thread.stepsAllDone", { total: String(total) }), spinning: false, autoHideMs: 5000 };
  }
  return {
    kind: "overview",
    label: t("thread.tasksProgress", { total: String(total), done: String(done) }),
    spinning: false,
    autoHideMs: null,
  };
}
