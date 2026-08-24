import { useCallback, useEffect, useRef, useState } from "react";
import type { ServerEvent, ClientEvent } from "@lenovo/agent-protocol";

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30000;
const MAX_QUEUE = 50;
/**
 * 心跳超时：如果 45s 内未收到服务端任何数据（包括 ping 帧），
 * 主动关闭连接触发重连。比服务端 30s 心跳间隔宽裕 15s。
 */
const HEARTBEAT_TIMEOUT_MS = 45_000;

function getReconnectDelay(attempt: number): number {
  return Math.min(RECONNECT_BASE_MS * 2 ** attempt, RECONNECT_MAX_MS);
}

export function useWebSocket(
  onEvent: (event: ServerEvent) => void,
  onMessageDropped?: (event: ClientEvent) => void,
) {
  const [connected, setConnected] = useState(false);
  const socketRef = useRef<WebSocket | null>(null);
  const onEventRef = useRef(onEvent);
  const onMessageDroppedRef = useRef(onMessageDropped);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const destroyedRef = useRef(false);
  // Messages queued while socket is not yet OPEN
  const sendQueueRef = useRef<ClientEvent[]>([]);
  // 心跳超时检测：45s 内无数据则主动断开
  const heartbeatTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep callback refs current without triggering reconnect
  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  useEffect(() => {
    onMessageDroppedRef.current = onMessageDropped;
  }, [onMessageDropped]);

  const clearHeartbeat = useCallback(() => {
    if (heartbeatTimerRef.current) {
      clearTimeout(heartbeatTimerRef.current);
      heartbeatTimerRef.current = null;
    }
  }, []);

  const resetHeartbeat = useCallback((socket: WebSocket) => {
    clearHeartbeat();
    heartbeatTimerRef.current = setTimeout(() => {
      console.warn("[useWebSocket] heartbeat timeout, closing socket");
      socket.close(4000, "heartbeat timeout");
    }, HEARTBEAT_TIMEOUT_MS);
  }, [clearHeartbeat]);

  const flushQueue = useCallback((socket: WebSocket) => {
    while (sendQueueRef.current.length > 0) {
      const evt = sendQueueRef.current.shift()!;
      try {
        socket.send(JSON.stringify(evt));
      } catch (e) {
        console.warn("[useWebSocket] flush send failed:", e);
      }
    }
  }, []);

  const connect = useCallback(() => {
    if (destroyedRef.current) return;

    // VSCode 原生 webview 里 window.location.host 是 vscode-webview://,无法直连;
    // 由 main.tsx 注入 __LOCALCODING_WS__(宿主提供的 ws://127.0.0.1:PORT/ws)。
    const injectedWs = (window as unknown as { __LOCALCODING_WS__?: string }).__LOCALCODING_WS__;
    const url = injectedWs || "ws://" + window.location.host + "/ws";
    console.log(
      `[useWebSocket] connecting (attempt ${reconnectAttemptRef.current + 1}) → ${url}`,
    );

    const socket = new WebSocket(url);
    socketRef.current = socket;

    socket.addEventListener("open", () => {
      if (destroyedRef.current) {
        socket.close();
        return;
      }
      console.log("[useWebSocket] connected");
      reconnectAttemptRef.current = 0;
      setConnected(true);
      resetHeartbeat(socket);
      flushQueue(socket);
    });

    socket.addEventListener("close", (ev) => {
      console.warn(
        `[useWebSocket] closed code=${ev.code} reason=${ev.reason || "(none)"} wasClean=${ev.wasClean}`,
      );
      clearHeartbeat();
      setConnected(false);
      if (destroyedRef.current) return;
      scheduleReconnect();
    });

    socket.addEventListener("error", (ev) => {
      // error is always followed by close, so just log here
      console.error("[useWebSocket] error event", ev);
    });

    socket.addEventListener("message", (ev) => {
      // 任何消息到达都说明服务端存活，重置心跳超时
      resetHeartbeat(socket);
      try {
        const data = JSON.parse(ev.data as string) as ServerEvent;
        // 应用层心跳，仅用于保活，不向上派发
        if ((data as { type?: string }).type === "ping") return;
        onEventRef.current(data);
      } catch (e) {
        console.warn("[useWebSocket] failed to parse message:", e);
      }
    });
  }, [flushQueue, resetHeartbeat, clearHeartbeat]); // stable — no external deps that change

  const scheduleReconnect = useCallback(() => {
    if (destroyedRef.current) return;
    if (reconnectTimerRef.current) return; // already scheduled

    const attempt = reconnectAttemptRef.current;
    const delay = getReconnectDelay(attempt);
    console.log(
      `[useWebSocket] reconnecting in ${delay}ms (attempt ${attempt + 1})`,
    );

    reconnectTimerRef.current = setTimeout(() => {
      reconnectTimerRef.current = null;
      reconnectAttemptRef.current += 1;
      connect();
    }, delay);
  }, [connect]);

  useEffect(() => {
    destroyedRef.current = false;
    connect();

    return () => {
      destroyedRef.current = true;
      clearHeartbeat();
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps — intentionally run once

  const sendEvent = useCallback((event: ClientEvent) => {
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) {
      try {
        socket.send(JSON.stringify(event));
      } catch (e) {
        console.error("[useWebSocket] send failed:", e);
      }
      return;
    }

    // Socket not ready — queue the message (drop oldest if queue is full)
    if (sendQueueRef.current.length >= MAX_QUEUE) {
      const dropped = sendQueueRef.current.shift()!;
      console.warn("[useWebSocket] send queue full, dropping oldest message");
      onMessageDroppedRef.current?.(dropped);
    }
    console.warn(
      `[useWebSocket] socket not ready (state=${socket?.readyState}), queuing event type=${event.type}`,
    );
    sendQueueRef.current.push(event);
  }, []);

  return { connected, sendEvent };
}
