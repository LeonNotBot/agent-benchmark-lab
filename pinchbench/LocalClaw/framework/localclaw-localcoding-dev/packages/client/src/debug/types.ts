/**
 * 流式渲染调试录制相关类型定义
 *
 * 用途：录制流式渲染过程，方便事后逐帧回溯排查各类 UI 渲染问题。
 * 通过记录原始事件流和状态快照，支持对比相邻帧的数据变化。
 */

import type { ServerEvent, StreamMessage, SessionStatus } from "@lenovo/agent-protocol";

/**
 * 调试录制文件格式（导出为 .lcdbg）
 */
export interface DebugRecording {
  /** 文件格式版本 */
  version: 1;
  /** 会话 ID */
  sessionId: string;
  /** 录制开始时间戳（绝对时间 ms） */
  startTime: number;
  /** 录制结束时间戳（绝对时间 ms） */
  endTime: number;
  /** 事件帧数组 */
  frames: DebugFrame[];
}

/**
 * 单个调试帧（原始事件 / 消息状态快照 / partial 流式文本快照）
 */
export interface DebugFrame {
  /** 帧序号（从 0 递增） */
  id: number;
  /** 相对起始时间（ms） */
  t: number;
  /** 帧类型 */
  kind: "raw_event" | "state_snapshot" | "partial_snapshot";
  /** 帧数据 */
  data: ServerEvent | StateSnapshot | PartialSnapshot;
}

/**
 * 状态快照（处理后的 UI 状态）
 */
export interface StateSnapshot {
  /** 会话 ID */
  sessionId: string;
  /** 当前消息数组（快照时刻的完整 messages） */
  messages: StreamMessage[];
  /** 会话状态 */
  sessionStatus: SessionStatus;
  /** 快照时间戳（绝对时间 ms） */
  timestamp: number;
}

/**
 * partial 流式文本快照（逐字级）
 *
 * 对应 usePartialStream 每次 RAF flush 后的 PartialState —— 即「一条 assistant 消息
 * 正在逐字累积」时，前端实际渲染的中间文本。这是消息级快照（state_snapshot）看不到的
 * 更细粒度：单条消息内部的逐字增长 / 回退都在这里体现。
 */
export interface PartialSnapshot {
  /** 会话 ID */
  sessionId: string;
  /** 当前累积的流式文本 */
  text: string;
  /** 当前 block 类型：正文 text / 思考 thinking / 空 */
  blockType: "text" | "thinking" | "";
  /** 快照时间戳（绝对时间 ms） */
  timestamp: number;
}
