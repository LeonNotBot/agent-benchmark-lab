// 回放控制条：播放/暂停、逐帧、进度滑块、变速、当前步信息。
import type { ReplayEngine, ReplayStep } from "./useReplayEngine";

const SPEEDS = [0.5, 1, 2, 5];

interface Props {
  engine: ReplayEngine;
  step: ReplayStep | null;
}

export function ReplayControls({ engine, step }: Props) {
  const { total, index, playing, speed, play, pause, seek, setSpeed } = engine;
  const atStart = index <= 0;
  const atEnd = index >= total - 1;
  const msgCount = step?.messages?.length ?? 0;
  const isPartial = step?.kind === "partial_snapshot";

  return (
    <div className="border-t border-border-300 bg-bg-000 px-5 py-3">
      {/* 进度滑块 */}
      <input
        type="range"
        min={0}
        max={Math.max(0, total - 1)}
        value={index}
        onChange={(e) => seek(Number(e.target.value))}
        className="w-full accent-accent-brand"
      />
      <div className="mt-2 flex items-center gap-3">
        {/* 上一帧 */}
        <IconBtn disabled={atStart} onClick={() => seek(index - 1)} title="上一帧">
          <path d="M19 20L9 12l10-8v16zM5 19V5" />
        </IconBtn>
        {/* 播放/暂停 */}
        <button
          onClick={playing ? pause : play}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-accent-brand text-white transition-opacity hover:opacity-90"
          title={playing ? "暂停" : "播放"}
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
            {playing ? <path d="M6 4h4v16H6zM14 4h4v16h-4z" /> : <path d="M8 5v14l11-7z" />}
          </svg>
        </button>
        {/* 下一帧 */}
        <IconBtn disabled={atEnd} onClick={() => seek(index + 1)} title="下一帧">
          <path d="M5 4l10 8-10 8V4zM19 5v14" />
        </IconBtn>

        {/* 步信息：消息帧显示消息数；逐字帧显示流式文本长度并标记 */}
        <div className="ml-1 flex items-center gap-2 text-xs text-text-400">
          <span>步 {total === 0 ? 0 : index + 1}/{total}</span>
          {isPartial ? (
            <span className="rounded bg-blue-500/10 px-1.5 py-0.5 text-blue-500">
              逐字 · {step?.partialText.length ?? 0} 字
            </span>
          ) : (
            <span className="text-text-500">· {msgCount} 条消息</span>
          )}
          {step && <span className="text-text-500">· {(step.t / 1000).toFixed(2)}s</span>}
        </div>

        {/* 变速 */}
        <div className="ml-auto flex gap-1">
          {SPEEDS.map((s) => (
            <button
              key={s}
              onClick={() => setSpeed(s)}
              className={`rounded px-2 py-1 text-xs font-medium transition-colors ${
                speed === s
                  ? "bg-accent-brand text-white"
                  : "text-text-400 hover:bg-purple-light2 hover:text-text-200"
              }`}
            >
              {s}x
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// 逐帧按钮（复用 svg 外壳）
function IconBtn({ children, disabled, onClick, title }: {
  children: React.ReactNode; disabled?: boolean; onClick: () => void; title: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="flex h-8 w-8 items-center justify-center rounded-lg text-text-300 transition-colors hover:bg-purple-light2 hover:text-text-100 disabled:cursor-not-allowed disabled:opacity-30"
    >
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
        {children}
      </svg>
    </button>
  );
}
