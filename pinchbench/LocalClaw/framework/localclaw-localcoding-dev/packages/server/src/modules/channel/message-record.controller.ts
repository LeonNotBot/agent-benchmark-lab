import { Controller, Get, Patch, Delete, Query, Body, Inject } from "@nestjs/common";
import { MessageRecordService } from "./message-record.service";
import type { MessageQueryFilter, MarkReadFilter } from "@lenovo/agent-sdk-channel";

@Controller("api")
export class MessageRecordController {
  constructor(
    @Inject(MessageRecordService) private readonly service: MessageRecordService,
  ) {}

  /** 查询消息（支持按 channelId/chatId/senderId/时间范围/方向/状态过滤，分页） */
  @Get("channel-messages")
  queryMessages(
    @Query("channelId") channelId?: string,
    @Query("chatId") chatId?: string,
    @Query("senderId") senderId?: string,
    @Query("channelType") channelType?: string,
    @Query("direction") direction?: "incoming" | "outgoing",
    @Query("status") status?: "unread" | "read",
    @Query("startTime") startTime?: string,
    @Query("endTime") endTime?: string,
    @Query("limit") limit?: string,
    @Query("offset") offset?: string,
  ) {
    const filter: MessageQueryFilter = {
      channelId, chatId, senderId, channelType, direction, status,
      startTime: startTime ? Number(startTime) : undefined,
      endTime: endTime ? Number(endTime) : undefined,
      limit: limit ? Math.min(Number(limit), 200) : 50,
      offset: offset ? Number(offset) : 0,
    };
    return this.service.queryMessages(filter);
  }

  /** 未读计数 */
  @Get("channel-messages/unread-count")
  getUnreadCount(
    @Query("channelId") channelId?: string,
    @Query("chatId") chatId?: string,
  ) {
    return { count: this.service.getUnreadCount(channelId, chatId) };
  }

  /** 标记已读 */
  @Patch("channel-messages/read")
  markAsRead(@Body() body: MarkReadFilter) {
    const count = this.service.markAsRead(body);
    return { ok: true, count };
  }

  /** 删除超过保留期的旧消息 */
  @Delete("channel-messages")
  deleteOldMessages(@Query("retentionDays") retentionDays?: string) {
    const days = retentionDays ? Number(retentionDays) : 30;
    const count = this.service.deleteOldMessages(days);
    return { ok: true, deleted: count };
  }
}
