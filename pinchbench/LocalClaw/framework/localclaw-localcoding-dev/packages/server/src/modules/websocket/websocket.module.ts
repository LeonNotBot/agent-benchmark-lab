import { Module } from "@nestjs/common";
import { WebsocketModule as SdkWebsocketModule } from "@lenovo/agent-sdk";
import { TemplateModule } from "../template/template.module";
import { SpeechModule } from "../speech/speech.module";
import { ChannelModule } from "../channel/channel.module";
import { McpModule } from "../mcp/mcp.module";
import { ScheduledTaskModule } from "../scheduled-task/scheduled-task.module";
import { WorkspaceModule } from "../workspace/workspace.module";
import { TemplateContributor } from "./template.contributor";
import { SpeechHandler } from "./speech.handler";
import { TransportWiring } from "./transport-wiring";
import { WorkspaceWatchHandler } from "../workspace/workspace-watch.handler";
import { WorkspaceUnwatchHandler } from "../workspace/workspace-unwatch.handler";

/**
 * 宿主 WebSocket 模块（薄壳，模式 A）。
 *
 * 传输内核与标准事件来自 SDK 的 WebsocketModule.forRoot；宿主只负责：
 * - 把模板接入 session.start（TemplateContributor）。
 * - 把语音接入未知事件派发（SpeechHandler）。
 * - 把工作区文件监听接入未知事件派发（WorkspaceWatch/UnwatchHandler）。
 * - 把渠道/定时任务的事件接到内核广播（TransportWiring）。
 *
 * forRoot 的 imports 透传宿主模块，供 contributor/handler 解析各自依赖
 * （TemplateService / SpeechService / WorkspaceWatcherService）。
 */
@Module({
  imports: [
    SdkWebsocketModule.forRoot({
      imports: [TemplateModule, SpeechModule, ScheduledTaskModule, WorkspaceModule],
      contributors: [TemplateContributor],
      eventHandlers: [SpeechHandler, WorkspaceWatchHandler, WorkspaceUnwatchHandler],
    }),
    ChannelModule,
    McpModule,
    ScheduledTaskModule,
  ],
  providers: [TransportWiring],
})
export class WebsocketModule {}
