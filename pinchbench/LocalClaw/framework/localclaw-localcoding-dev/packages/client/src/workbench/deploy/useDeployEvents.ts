import { useCallback, useEffect, useRef, useState } from "react";
import {
  type DeployPayload, type DeployEventName, TERMINAL_EVENTS,
} from "./autoDeployTypes";

const EVENT_NAMES: DeployEventName[] = [
  "deployment.progress", "deployment.heartbeat", "deployment.completed",
  "deployment.failed", "deployment.stopped", "deployment.deleted",
];

interface State {
  connected: boolean;
  payload: DeployPayload | null;
  terminal: boolean;
  error: string | null;
}

const initial: State = { connected: false, payload: null, terminal: false, error: null };

// 订阅本地 server 代理转发的第三方 SSE 事件流
export function useDeployEvents() {
  const [state, setState] = useState<State>(initial);
  const esRef = useRef<EventSource | null>(null);

  const stop = useCallback(() => {
    esRef.current?.close();
    esRef.current = null;
    setState((s) => ({ ...s, connected: false }));
  }, []);

  const subscribe = useCallback((deployId: string) => {
    esRef.current?.close();
    setState({ ...initial });

    const es = new EventSource(`/api/deploy-agent/events/${encodeURIComponent(deployId)}`);
    esRef.current = es;

    es.onopen = () => setState((s) => ({ ...s, connected: true }));
    es.onerror = () => {
      // 终态后上游关闭连接属正常；非终态时标记一次错误但保留 EventSource 自动重连
      setState((s) => s.terminal ? s : { ...s, connected: false });
    };

    const handle = (name: DeployEventName) => (ev: MessageEvent) => {
      let data: DeployPayload | null = null;
      try { data = JSON.parse(ev.data); } catch { /* 心跳等可能非完整 payload */ }
      const isTerminal = TERMINAL_EVENTS.includes(name);
      setState((s) => ({
        ...s,
        connected: true,
        payload: data ? { ...s.payload, ...data } : s.payload,
        terminal: isTerminal || s.terminal,
        error: name === "deployment.failed" ? (data?.diagnostics?.error ?? "部署失败") : s.error,
      }));
      if (isTerminal) { es.close(); esRef.current = null; }
    };

    for (const name of EVENT_NAMES) es.addEventListener(name, handle(name) as EventListener);
  }, []);

  useEffect(() => () => { esRef.current?.close(); }, []);

  return { ...state, subscribe, stop };
}
