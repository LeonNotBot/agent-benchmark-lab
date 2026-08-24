import { Module } from "@nestjs/common";
import { ChannelService } from "./channel.service";
import { ChannelGatewayBridge } from "./channel.bridge";
import { ChatSessionService } from "./chat-session.service";
import { GolemChannelManager } from "./golem-channel-manager";
import { MessageRecordService } from "./message-record.service";
import { WeChatService } from "./wechat.service";
import { NetworkMonitorService } from "./network-monitor.service";
import { FeishuNetworkNotifier } from "./feishu-network-notifier";
import { createAdapterFromChannel } from "./adapter-factory";
import { runChannelMigrations } from "./channel-migrations";
import { RunnerModule, RoutingModule } from "@lenovo/agent-sdk";
import { SessionModule } from "@lenovo/agent-sdk";
import { DATABASE } from "@lenovo/agent-sdk";

const adapterFactoryProvider = {
  provide: "ADAPTER_FACTORY",
  useValue: createAdapterFromChannel,
};

// ChatSessionService 直接注入全局单例 DATABASE，不再自建连接。
// 在构造前先跑 channel 表迁移。
const chatSessionServiceProvider = {
  provide: ChatSessionService,
  useFactory: (db: any) => {
    runChannelMigrations(db);
    return new ChatSessionService(db);
  },
  inject: [DATABASE],
};

/** 渠道能力模块（SDK）。无 HTTP controller —— REST 路由由宿主编排（模式 A）。 */
@Module({
  imports: [RunnerModule, SessionModule, RoutingModule],
  providers: [
    ChannelService,
    ChannelGatewayBridge,
    chatSessionServiceProvider,
    GolemChannelManager,
    WeChatService,
    NetworkMonitorService,
    FeishuNetworkNotifier,
    adapterFactoryProvider,
    MessageRecordService,
  ],
  exports: [
    ChannelService,
    ChannelGatewayBridge,
    ChatSessionService,
    GolemChannelManager,
    WeChatService,
    NetworkMonitorService,
    FeishuNetworkNotifier,
    MessageRecordService,
  ],
})
export class ChannelModule {}
