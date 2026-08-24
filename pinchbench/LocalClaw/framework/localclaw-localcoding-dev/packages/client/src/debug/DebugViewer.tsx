// 流式渲染调试查看器：导入 .lcdbg 文件，逐帧静态排查各类 UI 渲染问题。
// 左栏帧列表（异常帧标记），右栏选中帧详情。对比相邻帧的渲染数据变化定位问题。
import { useState, useMemo, useCallback, useRef } from "react";
import { parseRecording, computeSummaries, type FrameSummary } from "./parseRecording";
import type { DebugRecording } from "./types";
import { FrameList } from "./FrameList";
import { FrameDetail } from "./FrameDetail";
import { ReplayPanel } from "./ReplayPanel";
import { ReplayErrorBoundary } from "./ReplayErrorBoundary";

interface Props {
  onClose: () => void;
}

type ViewMode = "inspect" | "replay";

export function DebugViewer({ onClose }: Props) {
  const [recording, setRecording] = useState<DebugRecording | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [mode, setMode] = useState<ViewMode>("inspect");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const summaries = useMemo<FrameSummary[]>(
    () => (recording ? computeSummaries(recording) : []),
    [recording],
  );

  const selected = useMemo(
    () => summaries.find((s) => s.frame.id === selectedId) ?? null,
    [summaries, selectedId],
  );

  const handleFile = useCallback(async (file: File) => {
    setError(null);
    try {
      const text = await file.text();
      const rec = parseRecording(text);
      setRecording(rec);
      setSelectedId(rec.frames[0]?.id ?? null);
    } catch (e: any) {
      setError(e?.message ?? "解析失败");
      setRecording(null);
    }
  }, []);

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    // 重置 value：否则再次选同一文件不触发 change
    e.target.value = "";
  };

  const anomalyCount = summaries.filter((s) => s.isAnomaly).length;

  return (
    <div
      className="fixed inset-0 z-[95] flex flex-col bg-bg-000 animate-fade-in"
      style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
    >  {/* 顶栏 */}
      <div className="flex items-center gap-3 border-b border-border-300 px-5 py-3">
        <h3 className="text-sm font-semibold text-text-100">流式渲染调试查看器</h3>
        {recording && (
          <span className="text-xs text-text-400">
            {recording.frames.length} 帧
            {anomalyCount > 0 && (
              <span className="ml-2 text-amber-500">· {anomalyCount} 个异常帧</span>
            )}
          </span>
        )}
        {recording && (
          <div className="ml-4 flex gap-1 rounded-lg bg-bg-200 p-0.5">
            <TabBtn active={mode === "inspect"} onClick={() => setMode("inspect")}>逐帧排查</TabBtn>
            <TabBtn active={mode === "replay"} onClick={() => setMode("replay")}>回放</TabBtn>
          </div>
        )}
        <button
          onClick={() => fileInputRef.current?.click()}
          className="ml-auto cursor-pointer rounded-lg border border-border-300 px-3 py-1.5 text-xs font-medium text-text-200 transition-colors hover:bg-purple-light2"
        >
          导入 .lcdbg
        </button>
        <button
          onClick={onClose}
          className="flex items-center gap-1.5 rounded-lg border border-border-300 px-3 py-1.5 text-xs font-medium text-text-200 transition-colors hover:bg-bg-200"
        >
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
          关闭
        </button>
      </div>
      {/* 文件选择 input 放在顶栏外，避免影响 flex 布局和按钮点击区域 */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".lcdbg,.json"
        className="hidden"
        onChange={onInputChange}
      />

      {/* 主体 */}
      {error && (
        <div className="m-4 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-xs text-red-600 dark:bg-red-950/30">
          {error}
        </div>
      )}
      {!recording && !error && (
        <div className="flex flex-1 items-center justify-center text-sm text-text-400">
          点击右上角「导入 .lcdbg」加载录制文件
        </div>
      )}
      {recording && mode === "inspect" && (
        <div className="flex flex-1 overflow-hidden">
          <FrameList
            summaries={summaries}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
          <FrameDetail summary={selected} />
        </div>
      )}
      {recording && mode === "replay" && (
        <div className="flex-1 overflow-hidden">
          <ReplayErrorBoundary>
            <ReplayPanel recording={recording} />
          </ReplayErrorBoundary>
        </div>
      )}
    </div>
  );
}

// 顶栏视图切换 Tab
function TabBtn({ children, active, onClick }: {
  children: React.ReactNode; active: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
        active ? "bg-bg-000 text-text-100 shadow-sm" : "text-text-400 hover:text-text-200"
      }`}
    >
      {children}
    </button>
  );
}
