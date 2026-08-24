// ThreadList adapter：把 zustand sessions 映射成 assistant-ui 需要的形态
// - 永远存在 __draft__ 占位 thread，对应 store 里 activeSessionId === null 的状态
// - 真实 sessions 按 updatedAt 倒序排列
// - onSwitchToThread(__draft__) → setActiveSessionId(null)
// - onSwitchToNewThread → 同上
// - onDelete → sendEvent session.delete
// - onRename：暂未实现（后端没有 rename API），返回空 promise

import { useMemo } from "react";
import type { ExternalStoreThreadListAdapter } from "@assistant-ui/react";
import type { ClientEvent } from "@lenovo/agent-protocol";
import { useAppStore } from "../store/useAppStore";

export const DRAFT_THREAD_ID = "__draft__";

export function useThreadListAdapter(
  sendEvent: (event: ClientEvent) => void,
): ExternalStoreThreadListAdapter {
  const sessions = useAppStore((s) => s.sessions);
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const setActiveSessionId = useAppStore((s) => s.setActiveSessionId);

  const threads = useMemo(() => {
    const real = Object.values(sessions)
      .filter((s: any) => !s.kind || s.kind === "chat")
      .sort((a: any, b: any) => (b.updatedAt ?? b.createdAt ?? 0) - (a.updatedAt ?? a.createdAt ?? 0))
      .map((s: any) => ({
        status: "regular" as const,
        id: s.id,
        title: s.title || "(untitled)",
      }));

    // 若当前激活的 session 不在列表里(例如断连重连时服务端未返回临时会话),
    // 也把它作为占位项加进来,避免 assistant-ui 认为当前 thread 消失而触发切换
    if (activeSessionId && !real.some((t) => t.id === activeSessionId)) {
      const placeholder = {
        status: "regular" as const,
        id: activeSessionId,
        title: sessions[activeSessionId]?.title || "(reconnecting...)",
      };
      real.unshift(placeholder);
    }

    const draft = { status: "regular" as const, id: DRAFT_THREAD_ID, title: "New session" };
    return [draft, ...real];
  }, [sessions, activeSessionId]);

  return {
    threadId: activeSessionId ?? DRAFT_THREAD_ID,
    threads,
    onSwitchToThread: async (id: string) => {
      if (id === DRAFT_THREAD_ID) {
        setActiveSessionId(null);
        return;
      }
      setActiveSessionId(id);
    },
    onSwitchToNewThread: async () => {
      setActiveSessionId(null);
    },
    onDelete: async (id: string) => {
      if (id === DRAFT_THREAD_ID) return;
      sendEvent({ type: "session.delete", payload: { sessionId: id } } as any);
    },
  };
}