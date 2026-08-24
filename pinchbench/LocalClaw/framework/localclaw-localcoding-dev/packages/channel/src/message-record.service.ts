import { Injectable, Inject, Logger } from "@nestjs/common";
import type Database from "better-sqlite3";
import { DATABASE } from "@lenovo/agent-sdk";

// ── Types ──

export type MessageDirection = "incoming" | "outgoing";
export type MessageType = "text" | "image" | "file" | "mixed";
export type MessageStatus = "unread" | "read";
export type MessageEngine = "golembot" | "legacy";

export type MessageRecord = {
  id: string;
  channelId: string;
  channelType: string;
  chatId: string;
  senderId: string;
  direction: MessageDirection;
  messageType: MessageType;
  content: string;
  hasAttachment: boolean;
  attachmentInfo: string | null;
  status: MessageStatus;
  engine: MessageEngine;
  createdAt: number;
};

export type IncomingRecordInput = {
  channelId: string;
  channelType: string;
  chatId: string;
  senderId: string;
  content: string;
  engine: MessageEngine;
  // 兼容两种来源：微信 daemon 的 {base64,name} 与 golembot ChannelMessage 的 {data:Buffer,fileName}。
  images?: { mimeType: string; base64?: string; data?: unknown; name?: string; fileName?: string }[];
  files?: { fileName: string }[];
};

export type OutgoingRecordInput = {
  channelId: string;
  channelType: string;
  chatId: string;
  senderId: string;
  content: string;
  engine: MessageEngine;
};

export type MessageQueryFilter = {
  channelId?: string;
  chatId?: string;
  senderId?: string;
  channelType?: string;
  direction?: MessageDirection;
  status?: MessageStatus;
  startTime?: number;
  endTime?: number;
  limit?: number;
  offset?: number;
};

export type MarkReadFilter = {
  messageIds?: string[];
  channelId?: string;
  chatId?: string;
};

// ── Service ──

@Injectable()
export class MessageRecordService {
  private readonly logger = new Logger(MessageRecordService.name);
  private readonly db: Database.Database;

  constructor(@Inject(DATABASE) db: Database.Database) {
    this.db = db;
  }

  /** 根据文本与附件推断 message_type 并构建 attachment_info JSON */
  private classifyAttachments(
    text: string,
    images?: { mimeType: string; base64?: string; data?: unknown; name?: string; fileName?: string }[],
    files?: { fileName: string }[],
  ): { messageType: MessageType; attachmentInfo: string | null } {
    const hasText = !!text?.trim();
    const imgCount = images?.length ?? 0;
    const fileCount = files?.length ?? 0;
    const hasAttach = imgCount > 0 || fileCount > 0;

    let messageType: MessageType = "text";
    if (hasText && hasAttach) messageType = "mixed";
    else if (imgCount > 0 && fileCount === 0) messageType = "image";
    else if (fileCount > 0 && imgCount === 0) messageType = "file";
    else if (hasText) messageType = "text";

    let attachmentInfo: string | null = null;
    if (hasAttach) {
      attachmentInfo = JSON.stringify({
        images: imgCount,
        files: fileCount,
        fileNames: [
          ...(images ?? []).map((i) => i.name || i.fileName || "image"),
          ...(files ?? []).map((f) => f.fileName),
        ],
      });
    }

    return { messageType, attachmentInfo };
  }

  /** 记录一条 incoming（用户→机器人）消息 */
  recordIncoming(input: IncomingRecordInput): MessageRecord {
    const { messageType, attachmentInfo } = this.classifyAttachments(
      input.content, input.images, input.files,
    );
    const row = this.toRow(input, "incoming", messageType, attachmentInfo, "unread");
    this.insertRow(row);
    return this.rowToRecord(row);
  }

  /** 记录一条 outgoing（机器人→用户）消息 */
  recordOutgoing(input: OutgoingRecordInput): MessageRecord {
    const row = this.toRow(input, "outgoing", "text", null, "unread");
    this.insertRow(row);
    return this.rowToRecord(row);
  }

  /** 查询消息（带过滤/分页） */
  queryMessages(filter: MessageQueryFilter): { messages: MessageRecord[]; total: number } {
    const { where, params } = this.buildWhere(filter);
    const limit = Math.min(filter.limit ?? 50, 200);
    const offset = filter.offset ?? 0;

    const countSql = `select count(*) as c from channel_messages${where}`;
    const total = (this.db.prepare(countSql).get(...params) as { c: number }).c;

    const dataSql = `select * from channel_messages${where} order by created_at desc limit ? offset ?`;
    const rows = this.db.prepare(dataSql).all(...params, limit, offset) as Row[];

    return { messages: rows.map((r) => this.rowToRecord(r)), total };
  }

  /** 标记消息为已读 */
  markAsRead(filter: MarkReadFilter): number {
    const { messageIds, channelId, chatId } = filter;
    if (messageIds?.length) {
      const stmt = this.db.prepare(
        `update channel_messages set status='read' where id in (${messageIds.map(() => "?").join(",")})`,
      );
      const result = stmt.run(...messageIds);
      return result.changes;
    }
    if (channelId || chatId) {
      const clauses: string[] = [];
      const params: unknown[] = [];
      if (channelId) { clauses.push("channel_id=?"); params.push(channelId); }
      if (chatId) { clauses.push("chat_id=?"); params.push(chatId); }
      const result = this.db.prepare(
        `update channel_messages set status='read' where ${clauses.join(" and ")}`,
      ).run(...params);
      return result.changes;
    }
    return 0;
  }

  /** 未读计数 */
  getUnreadCount(channelId?: string, chatId?: string): number {
    const clauses: string[] = ["status='unread'"];
    const params: unknown[] = [];
    if (channelId) { clauses.push("channel_id=?"); params.push(channelId); }
    if (chatId) { clauses.push("chat_id=?"); params.push(chatId); }
    const row = this.db.prepare(
      `select count(*) as c from channel_messages where ${clauses.join(" and ")}`,
    ).get(...params) as { c: number };
    return row.c;
  }

  /** 删除超过保留期的旧消息 */
  deleteOldMessages(retentionDays: number): number {
    const cutoff = Date.now() - retentionDays * 86400000;
    const result = this.db.prepare(
      "delete from channel_messages where created_at < ?",
    ).run(cutoff);
    return result.changes;
  }

  // ── private helpers ──

  private toRow(
    input: IncomingRecordInput | OutgoingRecordInput,
    direction: MessageDirection,
    messageType: MessageType,
    attachmentInfo: string | null,
    status: MessageStatus,
  ): Row {
    return {
      id: crypto.randomUUID(),
      channel_id: input.channelId,
      channel_type: input.channelType,
      chat_id: input.chatId,
      sender_id: input.senderId,
      direction,
      message_type: messageType,
      content: input.content,
      has_attachment: attachmentInfo ? 1 : 0,
      attachment_info: attachmentInfo,
      status,
      engine: input.engine,
      created_at: Date.now(),
    };
  }

  private insertRow(row: Row): void {
    this.db.prepare(
      `insert into channel_messages (id,channel_id,channel_type,chat_id,sender_id,
       direction,message_type,content,has_attachment,attachment_info,status,engine,created_at)
       values (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      row.id, row.channel_id, row.channel_type, row.chat_id, row.sender_id,
      row.direction, row.message_type, row.content, row.has_attachment,
      row.attachment_info, row.status, row.engine, row.created_at,
    );
  }

  private buildWhere(filter: MessageQueryFilter): { where: string; params: unknown[] } {
    const clauses: string[] = [];
    const params: unknown[] = [];
    const add = (col: string, val: unknown) => { clauses.push(`${col}=?`); params.push(val); };
    if (filter.channelId) add("channel_id", filter.channelId);
    if (filter.chatId) add("chat_id", filter.chatId);
    if (filter.senderId) add("sender_id", filter.senderId);
    if (filter.channelType) add("channel_type", filter.channelType);
    if (filter.direction) add("direction", filter.direction);
    if (filter.status) add("status", filter.status);
    if (filter.startTime) { clauses.push("created_at >= ?"); params.push(filter.startTime); }
    if (filter.endTime) { clauses.push("created_at <= ?"); params.push(filter.endTime); }
    const where = clauses.length ? ` where ${clauses.join(" and ")}` : "";
    return { where, params };
  }

  private rowToRecord(r: Row): MessageRecord {
    return {
      id: r.id,
      channelId: r.channel_id,
      channelType: r.channel_type,
      chatId: r.chat_id,
      senderId: r.sender_id,
      direction: r.direction as MessageDirection,
      messageType: r.message_type as MessageType,
      content: r.content,
      hasAttachment: r.has_attachment === 1,
      attachmentInfo: r.attachment_info,
      status: r.status as MessageStatus,
      engine: r.engine as MessageEngine,
      createdAt: r.created_at,
    };
  }
}

type Row = {
  id: string;
  channel_id: string;
  channel_type: string;
  chat_id: string;
  sender_id: string;
  direction: string;
  message_type: string;
  content: string;
  has_attachment: number;
  attachment_info: string | null;
  status: string;
  engine: string;
  created_at: number;
};
