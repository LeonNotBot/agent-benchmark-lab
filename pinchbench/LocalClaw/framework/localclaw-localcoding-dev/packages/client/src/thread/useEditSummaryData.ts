// 计算「每轮最后一条 assistant 消息 uuid → 该轮 diff」映射，供 EditSummaryProvider 下发。
// 前端按 rawMessages 自行切轮次（user_prompt 为边界），取每轮末条 assistant uuid 作为卡片挂载点；
// 各轮 diff 数据来自后端 round-diffs（roundKey=该轮首条 assistant uuid，与前端切分口径一致）。
import { useEffect, useMemo, useState } from "react";
import { useAppStore } from "../store/useAppStore";
import { apiGetRoundDiffs, type SessionRoundDiff } from "../api/session";
import type { EditSummaryCtx, RoundSummary } from "./EditSummaryContext";

export function useEditSummaryData(): EditSummaryCtx {
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const activeSession = useAppStore((s) => (s.activeSessionId ? s.sessions[s.activeSessionId] : undefined));
  const rawMessages = activeSession?.messages ?? [];
  const status = activeSession?.status;
  const [rounds, setRounds] = useState<SessionRoundDiff[]>([]);

  // 会话切换 / 一轮结束（status 从 running→idle）时刷新 round-diffs。
  useEffect(() => {
    if (!activeSessionId) { setRounds([]); return; }
    if (status === "running") return; // 运行中不拉，结束后再拉，避免中间态
    let alive = true;
    apiGetRoundDiffs(activeSessionId).then((r) => { if (alive) setRounds(r); }).catch(() => {});
    return () => { alive = false; };
  }, [activeSessionId, status]);

  return useMemo(() => {
    const map = new Map<string, RoundSummary>();
    // roundKey（后端=该轮首条 assistant uuid）→ 该轮末条 assistant uuid，卡片挂在末条后。
    // round-diffs 已剔除无编辑的轮次，这里只对能定位到末条 assistant 的轮次建映射。
    const roundKeyToLastId = mapRoundKeyToLastId(rawMessages);
    for (const r of rounds) {
      const lastId = roundKeyToLastId.get(r.roundKey);
      if (lastId) map.set(lastId, { roundKey: r.roundKey, diffs: r.diffs });
    }
    return { byLastAssistantId: map };
  }, [rawMessages, rounds]);
}

// roundKey（该轮首条 assistant uuid）→ 该轮末条 assistant uuid。
function mapRoundKeyToLastId(messages: any[]): Map<string, string> {
  const out = new Map<string, string>();
  let firstId: string | null = null;
  let lastId: string | null = null;
  let started = false;
  const flush = () => { if (started && firstId && lastId) out.set(firstId, lastId); };
  for (const m of messages) {
    if (m?.type === "user_prompt") {
      flush();
      firstId = null; lastId = null; started = true;
      continue;
    }
    if (m?.type === "assistant" && (m.uuid || m.id)) {
      const id = m.uuid ?? m.id;
      if (!firstId) firstId = id;
      lastId = id;
    }
  }
  flush();
  return out;
}
