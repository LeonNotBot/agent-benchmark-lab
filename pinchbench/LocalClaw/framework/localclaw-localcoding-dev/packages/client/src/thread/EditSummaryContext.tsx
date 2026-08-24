// 汇总卡片上下文：把「每轮最后一条 assistant 消息 id → 该轮 diff」映射透传给 AssistantMessage。
// AssistantMessage 命中自己是某轮最后一条 assistant 时，在消息末尾渲染 EditSummaryCard。
// 数据源：GET /sessions/:id/round-diffs（后端按 user_prompt 切轮次重建）。
import { createContext, useContext } from "react";
import type { SessionRoundDiff } from "../api/session";

export interface RoundSummary {
  roundKey: string;
  diffs: SessionRoundDiff["diffs"];
}

export interface EditSummaryCtx {
  // key = 该轮最后一条 assistant 消息 uuid；value = 该轮 diff 汇总
  byLastAssistantId: Map<string, RoundSummary>;
}

const Ctx = createContext<EditSummaryCtx | null>(null);

export const EditSummaryProvider = Ctx.Provider;

export function useEditSummaryFor(messageId: string | undefined): RoundSummary | null {
  const ctx = useContext(Ctx);
  if (!ctx || !messageId) return null;
  return ctx.byLastAssistantId.get(messageId) ?? null;
}
