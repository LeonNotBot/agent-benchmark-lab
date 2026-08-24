// 查看器右栏：选中帧详情。
// state_snapshot：展示 messages 列表摘要 + 完整 JSON。
// partial_snapshot：展示逐字流式文本。
// raw_event：展示事件类型 + payload JSON。
import { useState } from "react";
import type { FrameSummary } from "./parseRecording";
import type { StateSnapshot, PartialSnapshot } from "./types";
import { summarizeMessage } from "./summarizeMessage";

interface Props {
  summary: FrameSummary | null;
}

const KIND_LABEL: Record<string, string> = {
  state_snapshot: "状态快照",
  partial_snapshot: "逐字文本",
  raw_event: "原始事件",
};

export function FrameDetail({ summary }: Props) {
  const [showRaw, setShowRaw] = useState(false);

  if (!summary) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-text-400">
        选择左侧一帧查看详情
      </div>
    );
  }

  const { frame } = summary;
  const isSnapshot = frame.kind === "state_snapshot";
  const isPartial = frame.kind === "partial_snapshot";

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* 帧头 */}
      <div className="flex items-center gap-3 border-b border-border-300 px-4 py-2.5">
        <span className="text-xs font-medium text-text-200">
          帧 #{frame.id} · {KIND_LABEL[frame.kind] ?? frame.kind}
        </span>
        <span className="text-xs text-text-500">{(frame.t / 1000).toFixed(3)}s</span>
        {summary.isAnomaly && (
          <span className="rounded bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-500">
            异常帧
          </span>
        )}
        <button
          onClick={() => setShowRaw((v) => !v)}
          className="ml-auto rounded border border-border-300 px-2.5 py-1 text-xs text-text-300 transition-colors hover:bg-bg-200"
        >
          {showRaw ? "摘要视图" : "原始 JSON"}
        </button>
      </div>

      {/* 内容区 */}
      <div className="flex-1 overflow-y-auto p-4">
        {showRaw ? (
          <pre className="whitespace-pre-wrap break-all rounded-lg bg-bg-200 p-3 text-xs text-text-200">
            {JSON.stringify(frame.data, null, 2)}
          </pre>
        ) : isSnapshot ? (
          <SnapshotMessages snap={frame.data as StateSnapshot} />
        ) : isPartial ? (
          <PartialText snap={frame.data as PartialSnapshot} />
        ) : (
          <pre className="whitespace-pre-wrap break-all rounded-lg bg-bg-200 p-3 text-xs text-text-200">
            {JSON.stringify(frame.data, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
}

/** 逐字流式文本展示：原样呈现当前累积的 partial 文本。 */
function PartialText({ snap }: { snap: PartialSnapshot }) {
  return (
    <div className="space-y-2">
      <div className="text-xs text-text-400">
        {snap.blockType === "thinking" ? "思考" : "正文"} · {snap.text.length} 字
      </div>
      <pre className="whitespace-pre-wrap break-words rounded-lg bg-bg-200 p-3 text-xs text-text-200">
        {snap.text || "（空）"}
      </pre>
    </div>
  );
}

/** 快照消息列表摘要：每条消息显示序号 + 类型 + 文本/工具片段。 */
function SnapshotMessages({ snap }: { snap: StateSnapshot }) {
  const messages = snap.messages ?? [];
  return (
    <div className="space-y-1.5">
      <div className="mb-2 text-xs text-text-400">
        共 {messages.length} 条消息 · 状态 {snap.sessionStatus}
      </div>
      {messages.map((m, i) => {
        const info = summarizeMessage(m);
        return (
          <div
            key={i}
            className="flex gap-2 rounded-lg border border-border-200 px-3 py-2 text-xs"
          >
            <span className="w-6 shrink-0 tabular-nums text-text-500">{i}</span>
            <span className="w-20 shrink-0 font-medium text-accent-text">{info.type}</span>
            <span className="flex-1 whitespace-pre-wrap break-words text-text-300">{info.preview}</span>
          </div>
        );
      })}
    </div>
  );
}
