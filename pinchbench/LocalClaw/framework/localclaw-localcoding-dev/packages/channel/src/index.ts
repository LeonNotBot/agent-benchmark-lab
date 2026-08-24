/**
 * @lenovo/agent-sdk-channel — 渠道（IM）能力公共出口。
 *
 * 依赖核心 @lenovo/agent-sdk（runner / session / config / database）。
 * 提供 Feishu / WeChat / DingTalk / WeCom 等渠道接入（基于 golembot）。
 */
export { ChannelService } from "./channel.service";
export { ChannelGatewayBridge } from "./channel.bridge";
export { ChatSessionService } from "./chat-session.service";
export type { ChatSession } from "./chat-session.service";
export { GolemChannelManager } from "./golem-channel-manager";
export type { AdapterFactory } from "./golem-channel-manager";
export { WeChatService } from "./wechat.service";
export { ChannelModule } from "./channel.module";
export { runChannelMigrations } from "./channel-migrations";
export { migrateChannels } from "./migration";
export { MessageRecordService } from "./message-record.service";
export type {
  MessageRecord,
  MessageDirection,
  MessageType,
  MessageStatus,
  MessageEngine,
  IncomingRecordInput,
  OutgoingRecordInput,
  MessageQueryFilter,
  MarkReadFilter,
} from "./message-record.service";
