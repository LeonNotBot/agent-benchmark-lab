/**
 * .lcdbg 录制文件解析 + 帧概要计算
 *
 * 检测「异常帧」——渲染数据出现非预期变化的帧，用于快速定位各类流式渲染 UI 问题。
 * 当前规则：state_snapshot 的 messages 数量比上一个快照减少（内容回退，常见于渲染
 * 中途丢失、覆盖等问题）。查看器据此标记，供逐帧对比排查。
 */
import type { DebugRecording, DebugFrame, StateSnapshot, PartialSnapshot } from "./types";

export interface FrameSummary {
  frame: DebugFrame;
  /** 列表展示的概要文本 */
  label: string;
  /** 仅 state_snapshot：该快照的 messages 数量 */
  messageCount?: number;
  /** 异常标记：渲染数据出现非预期变化（如 messages 数量下降） */
  isAnomaly: boolean;
}

/** 解析并校验 .lcdbg 文件文本，失败抛出可读错误。 */
export function parseRecording(text: string): DebugRecording {
  let obj: any;
  try {
    obj = JSON.parse(text);
  } catch {
    throw new Error("文件不是合法 JSON");
  }
  if (obj?.version !== 1 || !Array.isArray(obj.frames)) {
    throw new Error("不是有效的 .lcdbg 录制文件（缺少 version/frames）");
  }
  return obj as DebugRecording;
}

/** 取事件类型（raw_event）用于概要显示。 */
function rawEventType(data: any): string {
  return (data?.type as string) ?? "unknown";
}

/**
 * 计算每帧概要，并标记渲染数据异常变化的帧。检测规则：
 *  - state_snapshot：messages 数量比上一个快照减少（消息级回退）
 *  - partial_snapshot：逐字文本比上一个 partial 帧变短（逐字级回退，同一 block 内）
 * 两者都是「内容出现又消失」的典型信号。
 */
export function computeSummaries(rec: DebugRecording): FrameSummary[] {
  const out: FrameSummary[] = [];
  let lastCount = -1;
  let lastPartialLen = -1;

  for (const frame of rec.frames) {
    if (frame.kind === "state_snapshot") {
      const snap = frame.data as StateSnapshot;
      const count = snap.messages?.length ?? 0;
      const isAnomaly = lastCount >= 0 && count < lastCount;
      out.push({
        frame,
        label: `快照 · ${count} 条消息${isAnomaly ? ` ↓ (原 ${lastCount})` : ""}`,
        messageCount: count,
        isAnomaly,
      });
      lastCount = count;
      lastPartialLen = -1; // 消息落定，partial 计数归零重新开始
    } else if (frame.kind === "partial_snapshot") {
      const p = frame.data as PartialSnapshot;
      const len = p.text?.length ?? 0;
      // 逐字文本变短 = 同一条消息渲染中途回退（首帧 lastPartialLen=-1 不算）
      const isAnomaly = lastPartialLen >= 0 && len < lastPartialLen;
      const kind = p.blockType === "thinking" ? "思考" : "正文";
      out.push({
        frame,
        label: `逐字(${kind}) · ${len} 字${isAnomaly ? ` ↓ (原 ${lastPartialLen})` : ""}`,
        isAnomaly,
      });
      lastPartialLen = len;
    } else {
      out.push({
        frame,
        label: rawEventType(frame.data),
        isAnomaly: false,
      });
    }
  }
  return out;
}
