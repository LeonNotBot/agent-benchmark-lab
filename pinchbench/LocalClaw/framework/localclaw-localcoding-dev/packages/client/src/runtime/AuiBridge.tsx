// 把 sendEvent 暴露给 makeAssistantToolUI 渲染出的工具卡片。
// 这些卡片由 assistant-ui 内部渲染，拿不到 AppAui 的 props，
// 故用 context 桥接，供 AskUserQuestion 卡片提交 permission.response。

import { createContext, useContext } from "react";
import type { ClientEvent } from "@lenovo/agent-protocol";

export interface AuiBridge {
  sendEvent: (event: ClientEvent) => void;
  activeSessionId: string | null;
}

const AuiBridgeContext = createContext<AuiBridge | null>(null);

export const AuiBridgeProvider = AuiBridgeContext.Provider;

export function useAuiBridge(): AuiBridge {
  const ctx = useContext(AuiBridgeContext);
  if (!ctx) throw new Error("useAuiBridge must be used inside AuiBridgeProvider");
  return ctx;
}
