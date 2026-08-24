/**
 * useDebugRecorder — 流式调试录制器 React hook
 *
 * 封装 streamDebugRecorder 单例，供 UI 组件订阅状态并调用操作。
 * 录制器内部用 subscribe/listener 模式通知变化，不写 React state，
 * 避免产生多余的渲染依赖。
 */
import { useCallback, useEffect, useState } from "react";
import { streamDebugRecorder } from "./StreamDebugRecorder";

export interface DebugRecorderState {
  /** 是否正在录制 */
  enabled: boolean;
  /** 已录制帧数 */
  frameCount: number;
  /** 会话 ID（首帧绑定） */
  sessionId: string;
}

export function useDebugRecorder() {
  const [state, setState] = useState<DebugRecorderState>(() => {
    const s = streamDebugRecorder.getStats();
    return { enabled: s.enabled, frameCount: s.frameCount, sessionId: s.sessionId };
  });

  // 订阅录制器状态变化（开关/清除时触发）
  useEffect(() => {
    const sync = () => {
      const s = streamDebugRecorder.getStats();
      setState({ enabled: s.enabled, frameCount: s.frameCount, sessionId: s.sessionId });
    };
    const unsub = streamDebugRecorder.subscribe(sync);
    return unsub;
  }, []);

  // 定时器轮询帧数（原始事件高频写入不触发 notify，UI 按1s间隔刷新即可）
  useEffect(() => {
    if (!state.enabled) return;
    const id = setInterval(() => {
      const s = streamDebugRecorder.getStats();
      setState((prev) => {
        if (prev.frameCount === s.frameCount) return prev;
        return { ...prev, frameCount: s.frameCount };
      });
    }, 1000);
    return () => clearInterval(id);
  }, [state.enabled]);

  const setEnabled = useCallback((value: boolean) => {
    streamDebugRecorder.setEnabled(value);
  }, []);

  const clear = useCallback(() => {
    streamDebugRecorder.clear();
  }, []);

  const exportRecording = useCallback(() => {
    streamDebugRecorder.exportRecording();
  }, []);

  return { ...state, setEnabled, clear, exportRecording };
}
