import { Module } from "@nestjs/common";
import { ChannelModule as SdkChannelModule } from "@lenovo/agent-sdk-channel";
import { ChannelController } from "./channel.controller";
import { ChannelRestController } from "./channel-rest.controller";
import { MessageRecordController } from "./message-record.controller";

/**
 * 宿主 channel 模块：能力来自 SDK，HTTP controller 留宿主（模式 A）。
 * controller 注入的 ChannelService/ChannelGatewayBridge/
 * MessageRecordService/WeChatService 均由 SDK ChannelModule 导出。
 */
@Module({
  imports: [SdkChannelModule],
  controllers: [ChannelController, ChannelRestController, MessageRecordController],
  exports: [SdkChannelModule],
})
export class ChannelModule {}
