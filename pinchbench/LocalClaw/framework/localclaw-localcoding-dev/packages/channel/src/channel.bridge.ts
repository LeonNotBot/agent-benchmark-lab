import { Injectable } from "@nestjs/common";
import { EventEmitter } from "events";
import type { ChannelConfig } from "@lenovo/agent-protocol";
import type { MessageRecord } from "./message-record.service";

@Injectable()
export class ChannelGatewayBridge extends EventEmitter {
  emitQrReady(dataUrl?: string): void {
    this.emit("wechat-qr-ready", dataUrl);
  }
  emitQrWarning(message: string): void {
    this.emit("wechat-qr-warning", message);
  }
  emitQrDismiss(): void {
    this.emit("wechat-qr-dismiss");
  }
  emitChannelStatus(channelId: string, status: string, error?: string): void {
    this.emit("channel-status", { channelId, status, error });
  }
  /** 渠道保存（含 credentials 更新）事件 → 前端 channels 数组同步更新 */
  emitChannelSaved(channel: ChannelConfig): void {
    this.emit("channel-saved", { channel });
  }
  /** 新消息记录事件（供前端实时更新会话列表） */
  emitNewMessage(msg: MessageRecord): void {
    this.emit("channel-message-new", msg);
  }
  /** 消息已读事件（供前端同步已读状态） */
  emitMessagesRead(payload: { messageIds?: string[]; channelId?: string; chatId?: string; count: number }): void {
    this.emit("channel-messages-read", payload);
  }
  /** 渠道会话创建/更新事件 → 前端实时显示。仅 id 必填，其余字段缺失时前端保留原值。
   *  channelId 让前端把会话实时归入对应渠道分组，无需等待重启后重拉 channelSessions。 */
  emitSessionUpdate(session: { id: string; title?: string; status?: string; cwd?: string; kind?: string; channelId?: string }): void {
    this.emit("channel-session-update", session);
  }
  /** CLI 流式消息推送 → 前端实时渲染（绕过 history 加载） */
  emitStreamMessage(sessionId: string, message: unknown): void {
    this.emit("channel-stream-message", { sessionId, message });
  }
}
