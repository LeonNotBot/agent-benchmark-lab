// 开发者工具设置区：流式调试录制开关 + 导出/清除 + 查看器入口。
// 用途：录制流式渲染过程，方便事后回溯排查各类 UI 渲染问题。默认关闭，零性能影响。
import { useState } from "react";
import { useDebugRecorder } from "../debug/useDebugRecorder";
import { DebugViewer } from "../debug/DebugViewer";

function OptBtn({ children, active, onClick }: { children: React.ReactNode; active?: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-lg border px-4 py-2 text-xs font-medium transition-colors ${
        active
          ? "border-accent-brand bg-purple-light2 text-accent-text"
          : "border-border-300 text-text-400 hover:border-accent-brand/30 hover:bg-purple-light2 hover:text-text-200"
      }`}
    >
      {children}
    </button>
  );
}

export function DeveloperSection() {
  const { enabled, frameCount, sessionId, setEnabled, clear, exportRecording } = useDebugRecorder();
  const [viewerOpen, setViewerOpen] = useState(false);

  return (
    <div>
      {viewerOpen && <DebugViewer onClose={() => setViewerOpen(false)} />}
      <h2 className="text-sm font-semibold text-text-100 mb-3">开发者工具</h2>
      <div className="space-y-5">
        {/* 流式调试录制 */}
        <div className="space-y-2">
          <label className="text-xs font-medium text-text-400">流式渲染录制</label>
          <div className="flex gap-2">
            <OptBtn active={enabled} onClick={() => setEnabled(true)}>开启录制</OptBtn>
            <OptBtn active={!enabled} onClick={() => setEnabled(false)}>关闭</OptBtn>
          </div>
          <p className="text-xs text-text-500">
            录制大模型返回的原始事件流与处理后的渲染状态，方便事后回溯排查流式渲染中的各类 UI 问题。
            默认关闭，不影响正常使用性能。开启后最多缓存 3000 帧。
          </p>
        </div>

        {/* 录制状态 + 操作 */}
        <div className="rounded-xl border border-border-300 bg-bg-000 p-4 shadow-soft space-y-3">
          <div className="flex items-center gap-2">
            <span
              className={`inline-block h-2 w-2 rounded-full ${enabled ? "bg-red-500 animate-pulse" : "bg-text-500/40"}`}
            />
            <span className="text-xs font-medium text-text-200">
              {enabled ? "录制中" : "已停止"}
            </span>
            <span className="ml-auto text-xs text-text-500">已录制 {frameCount} 帧</span>
          </div>
          {sessionId && (
            <div className="text-xs text-text-500">会话: {sessionId.slice(0, 16)}…</div>
          )}
          <div className="flex gap-2 pt-1">
            <button
              onClick={exportRecording}
              disabled={frameCount === 0}
              className="rounded-lg border border-border-300 px-4 py-2 text-xs font-medium text-text-200 transition-colors hover:bg-purple-light2 disabled:cursor-not-allowed disabled:opacity-40"
            >
              导出录制文件 (.lcdbg)
            </button>
            <button
              onClick={clear}
              disabled={frameCount === 0}
              className="rounded-lg border border-border-300 px-4 py-2 text-xs font-medium text-text-400 transition-colors hover:bg-purple-light2 disabled:cursor-not-allowed disabled:opacity-40"
            >
              清空
            </button>
          </div>
        </div>

        {/* 查看器：导入 .lcdbg 文件逐帧排查 */}
        <div className="space-y-2">
          <label className="text-xs font-medium text-text-400">调试查看器</label>
          <div>
            <button
              onClick={() => setViewerOpen(true)}
              className="rounded-lg border border-border-300 px-4 py-2 text-xs font-medium text-text-200 transition-colors hover:bg-purple-light2"
            >
              打开查看器（导入 .lcdbg）
            </button>
          </div>
          <p className="text-xs text-text-500">
            导入录制文件，逐帧查看原始事件与渲染状态，回溯排查各类流式渲染 UI 问题。
            渲染数据（消息数量等）出现异常变化的帧会自动标记。
          </p>
        </div>
      </div>
    </div>
  );
}
