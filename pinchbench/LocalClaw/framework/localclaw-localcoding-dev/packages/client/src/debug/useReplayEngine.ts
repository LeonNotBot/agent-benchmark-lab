// 回放时序引擎：把 state_snapshot（消息级）与 partial_snapshot（逐字级）合并为
// 一条统一时间轴，支持播放/暂停/跳转/变速。
//
// 每一步（ReplayStep）= 该时刻应渲染的完整画面：
//   - messages：截至该步、最近一次 state_snapshot 的消息数组
//   - partial ：若该步是 partial 帧，则为其逐字文本；消息帧则清空（那条消息已落定）
// 这样单条 assistant 消息内部的逐字增长/回退也能重现。
// 播放时按相邻步的录制时间差（t）除以倍速，用 setTimeout 推进。
import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import type { DebugRecording, StateSnapshot, PartialSnapshot } from "./types";

/** 回放的一步：该时刻 UI 应显示的完整画面。 */
export interface ReplayStep {
  t: number;
  sessionId: string;
  /** 已落定的消息数组（喂给 runtime） */
  messages: any[];
  sessionStatus: StateSnapshot["sessionStatus"];
  /** 逐字流式文本（该步为 partial 帧时非空） */
  partialText: string;
  partialBlockType: "text" | "thinking" | "";
  /** 该步来源帧类型，供 UI 区分展示 */
  kind: "state_snapshot" | "partial_snapshot";
}

export interface ReplayEngine {
  /** 步总数 */
  total: number;
  /** 当前步索引（0-based） */
  index: number;
  /** 当前步 */
  current: ReplayStep | null;
  /** 是否正在播放 */
  playing: boolean;
  /** 播放倍速 */
  speed: number;
  play: () => void;
  pause: () => void;
  /** 跳转到指定步索引 */
  seek: (i: number) => void;
  setSpeed: (s: number) => void;
}

/**
 * 把录制帧合并成回放步序列。顺序扫描：
 *  - 遇 state_snapshot：更新「当前消息数组」，产出一步（partial 清空）
 *  - 遇 partial_snapshot：沿用当前消息数组，产出一步（带逐字文本）
 * 忽略 raw_event（仅逐帧排查视图用）。
 */
function buildSteps(rec: DebugRecording | null): ReplayStep[] {
  if (!rec) return [];
  const steps: ReplayStep[] = [];
  let curMessages: any[] = [];
  let curStatus: StateSnapshot["sessionStatus"] = "idle";
  let curSession = rec.sessionId;

  for (const f of rec.frames) {
    if (f.kind === "state_snapshot") {
      const s = f.data as StateSnapshot;
      curMessages = s.messages ?? [];
      curStatus = s.sessionStatus;
      curSession = s.sessionId;
      steps.push({
        t: f.t, sessionId: curSession, messages: curMessages, sessionStatus: curStatus,
        partialText: "", partialBlockType: "", kind: "state_snapshot",
      });
    } else if (f.kind === "partial_snapshot") {
      const p = f.data as PartialSnapshot;
      steps.push({
        t: f.t, sessionId: p.sessionId || curSession, messages: curMessages, sessionStatus: curStatus,
        partialText: p.text, partialBlockType: p.blockType, kind: "partial_snapshot",
      });
    }
  }
  return steps;
}

export function useReplayEngine(rec: DebugRecording | null): ReplayEngine {
  const snapshots = useMemo(() => buildSteps(rec), [rec]);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 录制变化时重置到首帧
  useEffect(() => {
    setIndex(0);
    setPlaying(false);
  }, [snapshots]);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // 播放推进逻辑在后续 Edit 补充
  const play = useCallback(() => {
    if (snapshots.length === 0) return;
    // 播到末尾再按播放 → 从头开始
    setIndex((i) => (i >= snapshots.length - 1 ? 0 : i));
    setPlaying(true);
  }, [snapshots.length]);

  const pause = useCallback(() => {
    setPlaying(false);
    clearTimer();
  }, [clearTimer]);

  const seek = useCallback((i: number) => {
    setPlaying(false);
    clearTimer();
    setIndex(Math.max(0, Math.min(i, snapshots.length - 1)));
  }, [clearTimer, snapshots.length]);

  // 播放推进：playing 时，根据「下一帧与当前帧的录制时间差 / 倍速」调度下一帧。
  // 每次 index 变化都重新计算下一步延迟，天然贴合真实录制节奏（含长间隔停顿）。
  useEffect(() => {
    if (!playing) return;
    if (index >= snapshots.length - 1) {
      // 已到末尾，停止
      setPlaying(false);
      return;
    }
    const cur = snapshots[index];
    const next = snapshots[index + 1];
    // 时间差下限 16ms（避免 0 间隔连播卡死），上限 2s（超长停顿压缩，免得干等）
    const rawGap = Math.max(0, next.t - cur.t);
    const delay = Math.min(Math.max(rawGap / speed, 16), 2000);
    timerRef.current = setTimeout(() => {
      setIndex((i) => i + 1);
    }, delay);
    return () => clearTimer();
  }, [playing, index, snapshots, speed, clearTimer]);

  return {
    total: snapshots.length,
    index,
    current: snapshots[index] ?? null,
    playing,
    speed,
    play,
    pause,
    seek,
    setSpeed,
  };
}
