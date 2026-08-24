import { useEffect, useRef } from "react";
import { apiGetSessionHistory, apiGetSessionDiff } from "../api";
import { useAppStore } from "../store/useAppStore";

export function useSessionHistory(connected: boolean, sendEvent: (event: any) => void) {
  const { activeSessionId, sessions, historyRequested, markHistoryRequested } = useAppStore();
  const handleServerEvent = useAppStore((s) => s.handleServerEvent);
  const setSessionLoadingHistory = useAppStore((s) => s.setSessionLoadingHistory);
  const setSessionDiffs = useAppStore((s) => s.setSessionDiffs);
  const activeSessionIdRef = useRef(activeSessionId);
  activeSessionIdRef.current = activeSessionId;

  useEffect(() => {
    if (!connected || !activeSessionId) return;
    const session = sessions[activeSessionId];
    if (session?.hydrated) return;
    if (historyRequested.has(activeSessionId)) return;

    markHistoryRequested(activeSessionId);
    setSessionLoadingHistory(activeSessionId, true);
    apiGetSessionHistory(activeSessionId)
      .then((data) => {
        if (!data) return;
        handleServerEvent({
          type: "session.history",
          payload: {
            sessionId: data.sessionId,
            status: data.status,
            messages: data.messages,
            diffs: data.diffs ?? [],
            tasks: (data as any).tasks ?? [],
          },
        } as any);
        // diff 已从 history 拆出，单独 REST 短链接异步拉取（git diff 可能慢，不阻塞会话打开）。
        // 拿到结果后直接写 store，不走 handleServerEvent 伪造事件。
        apiGetSessionDiff(data.sessionId)
          .then((diffs) => { if (diffs.length) setSessionDiffs(data.sessionId, diffs); })
          .catch(() => {});
      })
      .catch(() => {})
      .finally(() => {
        const id = activeSessionIdRef.current;
        if (id) setSessionLoadingHistory(id, false);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, activeSessionId]);
}
