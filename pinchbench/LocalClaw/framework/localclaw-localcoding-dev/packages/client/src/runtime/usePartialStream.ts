// 监听 ServerEvent，为每个 session 独立累积流式 delta 文本，确保多会话切换时内容不丢。
//
// 实现要点
// - 每个 session 独享一个 internal buffer（text/blockType/retry），事件按 sessionId 路由，
//   不再像老版本那样只处理 activeSession 的事件。
// - RAF 仍只用于当前激活 session，减少重渲染；后台 session 默默更新 ref，不触发 React 重渲染。
// - activeSessionId 变化时，从 ref 中恢复对应 session 的 state，做到“切回即见”。

import { useRef, useState, useCallback, useEffect } from "react";
import type { ServerEvent } from "@lenovo/agent-protocol";
import { splitThink, type ThinkSegment } from "./parseThink";
import { streamDebugRecorder } from "../debug/StreamDebugRecorder";

export interface PartialState {
  text: string;
  blockType: "text" | "thinking" | "";
  segments: ThinkSegment[];
  retry: { attempt: number; maxRetries: number } | null;
}

function emptyState(): PartialState {
  return { text: "", blockType: "", segments: [], retry: null };
}

interface SessionBuffer {
  text: string;
  blockType: "text" | "thinking" | "";
  retry: { attempt: number; maxRetries: number } | null;
}

function computeSegments(buffer: SessionBuffer): ThinkSegment[] {
  const t = buffer.text;
  if (!t) return [];
  if (buffer.blockType === "thinking") return [{ type: "reasoning", text: t }];
  return splitThink(t, { streaming: true });
}

function toPartialState(buffer: SessionBuffer | undefined): PartialState {
  if (!buffer) return emptyState();
  return {
    text: buffer.text,
    blockType: buffer.blockType,
    segments: computeSegments(buffer),
    retry: buffer.retry,
  };
}

export function usePartialStream(activeSessionId: string | null) {
  const [state, setState] = useState<PartialState>(emptyState);

  // 每个 session 的独立 buffer（ref 中保存，不触发重渲染）
  const buffersRef = useRef<Map<string, SessionBuffer>>(new Map());
  const activeSessionIdRef = useRef<string | null>(activeSessionId);
  activeSessionIdRef.current = activeSessionId;

  const rafRef = useRef<number | null>(null);

  const flush = useCallback(() => {
    rafRef.current = null;
    const sid = activeSessionIdRef.current;
    if (!sid) return;
    const buf = buffersRef.current.get(sid);
    setState(toPartialState(buf));
    // 探针 3：录制 partial 逐字文本快照（enabled=false 时仅一次布尔判断，零开销）
    if (streamDebugRecorder.enabled && buf) {
      streamDebugRecorder.recordPartialSnapshot({
        sessionId: sid,
        text: buf.text,
        blockType: buf.blockType,
        timestamp: Date.now(),
      });
    }
  }, []);

  const resetSession = useCallback((sessionId: string | null) => {
    if (!sessionId) return;
    const buf = buffersRef.current.get(sessionId);
    if (buf) {
      buf.text = "";
      buf.blockType = "";
      // retry 不重置，让重连信息保留到下次开始输出
    }
  }, []);

  // 激活会话切换时，立即恢复该会话的 partial state（有则显示，无则清空）
  useEffect(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    setState(toPartialState(activeSessionId ? buffersRef.current.get(activeSessionId) : undefined));
  }, [activeSessionId]);

  const onEvent = useCallback((ev: ServerEvent) => {
    const evSessionId = (ev as any).payload?.sessionId as string | undefined;
    const currentActive = activeSessionIdRef.current;

    if (ev.type === "session.status") {
      const s = (ev as any).payload?.status as string | undefined;
      if (s === "completed" || s === "error" || s === "idle") {
        if (evSessionId) {
          buffersRef.current.delete(evSessionId);
          if (evSessionId === currentActive) setState(emptyState());
        }
      }
      return;
    }

    if (ev.type === "session.retry") {
      if (evSessionId) {
        let buf = buffersRef.current.get(evSessionId);
        if (!buf) {
          buf = { text: "", blockType: "", retry: null };
          buffersRef.current.set(evSessionId, buf);
        }
        buf.retry = { attempt: ev.payload.attempt, maxRetries: ev.payload.maxRetries };
        if (evSessionId === currentActive) {
          setState((prev) => ({ ...prev, retry: buf!.retry }));
        }
      }
      return;
    }

    if (ev.type === "session.history") {
      if (evSessionId) {
        buffersRef.current.delete(evSessionId);
        if (evSessionId === currentActive) setState(emptyState());
      }
      return;
    }

    if (ev.type !== "stream.message") return;
    if (!evSessionId) return;

    const m = (ev as any).payload?.message;
    if (m?.type === "assistant") {
      buffersRef.current.delete(evSessionId);
      if (evSessionId === currentActive) setState(emptyState());
      return;
    }
    if (m?.type !== "stream_event") return;

    const evt = m.event;
    if (evt?.type === "content_block_start") {
      const newBuf: SessionBuffer = {
        text: "",
        blockType: evt.content_block?.type === "text" || evt.content_block?.type === "thinking" ? evt.content_block.type : "",
        retry: null,
      };
      buffersRef.current.set(evSessionId, newBuf);
      if (evSessionId === currentActive && rafRef.current == null) {
        rafRef.current = requestAnimationFrame(flush);
      }
      return;
    }

    if (evt?.type === "content_block_delta") {
      const buf = buffersRef.current.get(evSessionId);
      if (!buf) return;
      if (!buf.blockType) return;
      const d = evt.delta ?? {};
      const v = typeof d.text === "string" ? d.text : typeof d.thinking === "string" ? d.thinking : "";
      if (!v) return;
      buf.text += v;
      if (evSessionId === currentActive && rafRef.current == null) {
        rafRef.current = requestAnimationFrame(flush);
      }
      return;
    }

    if (evt?.type === "content_block_stop") {
      buffersRef.current.delete(evSessionId);
      if (evSessionId === currentActive) {
        if (rafRef.current != null) {
          cancelAnimationFrame(rafRef.current);
          rafRef.current = null;
        }
        setState(emptyState());
      }
      return;
    }
  }, [flush]);

  return { partial: state, onEvent };
}
