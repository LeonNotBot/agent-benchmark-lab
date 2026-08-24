import { useEffect } from "react";
import { apiGetCwdStatus } from "../api/session";
import { useAppStore } from "../store/useAppStore";

// 切到某会话且其 cwd 仍声明存在时，探测工作目录是否还在磁盘上。
// 失效则写入 cwdMissing，驱动 composer 顶部「工作目录缺失」横幅（前置发现，发消息前即可重选）。
export function useCwdProbe(connected: boolean) {
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const cwd = useAppStore((s) => (activeSessionId ? s.sessions[activeSessionId]?.cwd : undefined));

  useEffect(() => {
    if (!connected || !activeSessionId || !cwd) return;
    let cancelled = false;
    apiGetCwdStatus(activeSessionId)
      .then((d) => {
        if (cancelled || !d || d.exists) return;
        useAppStore.setState((state: any) => {
          const s = state.sessions[activeSessionId];
          if (!s) return state;
          return { sessions: { ...state.sessions, [activeSessionId]: { ...s, cwdMissing: s.cwd } } };
        });
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [connected, activeSessionId, cwd]);
}
