// 查看器左栏：帧列表。异常帧（渲染数据非预期变化）标记，快照/原始事件用颜色区分。
import type { FrameSummary } from "./parseRecording";

interface Props {
  summaries: FrameSummary[];
  selectedId: number | null;
  onSelect: (id: number) => void;
}

/** 相对时间格式化：ms → "1.23s" */
function fmtTime(ms: number): string {
  return (ms / 1000).toFixed(2) + "s";
}

export function FrameList({ summaries, selectedId, onSelect }: Props) {
  return (
    <div className="w-80 shrink-0 overflow-y-auto border-r border-border-300 [scrollbar-gutter:stable]">
      {summaries.map((s) => {
        const kind = s.frame.kind;
        const isSnapshot = kind === "state_snapshot";
        const isPartial = kind === "partial_snapshot";
        const active = s.frame.id === selectedId;
        // 帧类型标记点颜色：快照蓝 / 逐字青 / 原始事件灰；异常帧一律琥珀
        const dotColor = s.isAnomaly
          ? "bg-amber-500"
          : isSnapshot ? "bg-blue-400" : isPartial ? "bg-cyan-400" : "bg-text-500/40";
        // 文字颜色：有内容的帧（快照/逐字）深一些，原始事件浅一些
        const textColor = s.isAnomaly
          ? "font-medium text-amber-500"
          : isSnapshot ? "text-text-200" : isPartial ? "text-text-300" : "text-text-400";
        return (
          <button
            key={s.frame.id}
            onClick={() => onSelect(s.frame.id)}
            className={`flex w-full items-center gap-2 border-b border-border-200 px-3 py-2 text-left text-xs transition-colors ${
              active ? "bg-purple-light2" : "hover:bg-bg-200"
            } ${s.isAnomaly ? "border-l-2 border-l-amber-500" : ""}`}
          >
            <span className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${dotColor}`} />
            <span className="w-12 shrink-0 tabular-nums text-text-500">{fmtTime(s.frame.t)}</span>
            <span className={`flex-1 truncate ${textColor}`}>{s.label}</span>
          </button>
        );
      })}
    </div>
  );
}
