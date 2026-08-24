/**
 * 流式渲染录制器（单例）
 *
 * 挂在 handleServerEvent 分发点：处理前录原始事件、处理后录状态快照。
 * 录制数据可导出为 .lcdbg 文件，配合查看器逐帧回溯排查各类流式渲染 UI 问题。
 *
 * 性能约束（关键）：默认关闭。关闭时 enabled=false，探针端只需一次布尔判断即可
 * 短路返回，对正常用户零开销。仅需排查问题时手动开启。
 */

import { SK } from "../store/storageKeys";
import type { ServerEvent } from "@lenovo/agent-protocol";
import type { DebugFrame, DebugRecording, StateSnapshot, PartialSnapshot } from "./types";

/** Ring Buffer 上限：超出后丢弃最旧帧，避免长时间录制内存爆炸。 */
const MAX_FRAMES = 3000;

class StreamDebugRecorder {
  /** 是否正在录制。探针端读此标志决定是否短路——默认 false，零开销。 */
  enabled = false;

  private frames: DebugFrame[] = [];
  private frameId = 0;
  private startTime = 0;
  private endTime = 0;
  /** 录制的目标会话（首个事件的 sessionId），仅录该会话，避免多会话混杂。 */
  private sessionId = "";
  /** 订阅者（UI），用于录制状态变化时刷新（帧数、开关）。 */
  private listeners = new Set<() => void>();

  constructor() {
    // 初始化时从 localStorage 读取开关（页面刷新后保持）。
    try {
      this.enabled = localStorage.getItem(SK.DEBUG_RECORDING_ENABLED) === "1";
    } catch {
      this.enabled = false;
    }
    if (this.enabled) this.resetBuffer();
  }

  // ── 以下方法在后续 Edit 中补充 ──
  private resetBuffer(): void {
    this.frames = [];
    this.frameId = 0;
    this.startTime = Date.now();
    this.endTime = 0;
    this.sessionId = "";
  }

  private notify(): void {
    for (const fn of this.listeners) fn();
  }

  // ── 公共 API ──────────────────────────────────────────────────────────────

  /** 订阅状态变化（帧数/开关）。返回取消订阅函数。 */
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /**
   * 切换录制开关，并持久化到 localStorage。
   * 开启时清空旧帧重新开始，关闭时记录结束时间。
   */
  setEnabled(value: boolean): void {
    this.enabled = value;
    try {
      localStorage.setItem(SK.DEBUG_RECORDING_ENABLED, value ? "1" : "0");
    } catch { /* 忽略 */ }
    if (value) {
      this.resetBuffer();
    } else {
      this.endTime = Date.now();
    }
    this.notify();
  }

  /** 清空录制缓冲区（保持开关状态不变）。 */
  clear(): void {
    this.resetBuffer();
    this.notify();
  }

  /** 获取当前帧统计（供 UI 展示）。 */
  getStats(): { frameCount: number; sessionId: string; startTime: number; enabled: boolean } {
    return {
      frameCount: this.frames.length,
      sessionId: this.sessionId,
      startTime: this.startTime,
      enabled: this.enabled,
    };
  }

  /**
   * 探针 1：录制原始 ServerEvent（handleServerEvent 处理之前调用）。
   * enabled=false 时调用者已短路，此处无需再判断。
   */
  recordRawEvent(event: ServerEvent): void {
    // 从事件 payload 中提取 sessionId，用于首帧绑定会话
    const sid = (event as any).payload?.sessionId as string | undefined;
    if (sid && !this.sessionId) this.sessionId = sid;

    const frame: DebugFrame = {
      id: this.frameId++,
      t: Date.now() - this.startTime,
      kind: "raw_event",
      data: event,
    };
    this.frames.push(frame);
    if (this.frames.length > MAX_FRAMES) this.frames.shift();
    // 原始事件高频（每帧都来），不触发 notify，避免 UI 刷新风暴。
    // UI 通过定时器轮询 getStats().frameCount 即可。
  }

  /**
   * 探针 2：录制处理后的状态快照（handleServerEvent 处理之后调用）。
   * 只对 stream.message / session.history 等会改变 messages 的事件调用。
   * enabled=false 时调用者已短路，此处无需再判断。
   */
  recordStateSnapshot(snapshot: StateSnapshot): void {
    if (!this.sessionId) this.sessionId = snapshot.sessionId;

    const frame: DebugFrame = {
      id: this.frameId++,
      t: Date.now() - this.startTime,
      kind: "state_snapshot",
      data: snapshot,
    };
    this.frames.push(frame);
    if (this.frames.length > MAX_FRAMES) this.frames.shift();
  }

  /**
   * 探针 3：录制 partial 流式文本快照（usePartialStream 每次 flush 后调用）。
   * 逐字级——单条 assistant 消息内部的文本累积过程。
   * enabled=false 时调用者已短路，此处无需再判断。
   */
  recordPartialSnapshot(snapshot: PartialSnapshot): void {
    if (!this.sessionId) this.sessionId = snapshot.sessionId;

    const frame: DebugFrame = {
      id: this.frameId++,
      t: Date.now() - this.startTime,
      kind: "partial_snapshot",
      data: snapshot,
    };
    this.frames.push(frame);
    if (this.frames.length > MAX_FRAMES) this.frames.shift();
  }

  /** 获取所有帧的只读拷贝（供回放/导出使用）。 */
  getFrames(): readonly DebugFrame[] {
    return this.frames;
  }

  /**
   * 导出录制文件（.lcdbg JSON 格式）。
   * 构建 DebugRecording 对象，序列化后触发浏览器下载。
   */
  exportRecording(): void {
    if (this.frames.length === 0) {
      console.warn("[StreamDebugRecorder] 无录制数据可导出");
      return;
    }

    const recording: DebugRecording = {
      version: 1,
      sessionId: this.sessionId || "unknown",
      startTime: this.startTime,
      endTime: this.endTime || Date.now(),
      frames: this.frames,
    };

    const json = JSON.stringify(recording, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    // 文件名：session前8字符 + 时间戳
    const shortId = this.sessionId ? this.sessionId.slice(0, 8) : "unknown";
    const ts = new Date(this.startTime).toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const filename = `debug-${shortId}-${ts}.lcdbg`;

    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);

    console.log(`[StreamDebugRecorder] 已导出 ${this.frames.length} 帧到 ${filename}`);
  }
}

/** 模块级单例，探针与 UI 共用同一实例。 */
export const streamDebugRecorder = new StreamDebugRecorder();
