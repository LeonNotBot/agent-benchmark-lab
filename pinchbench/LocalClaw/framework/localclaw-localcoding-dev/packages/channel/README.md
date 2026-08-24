# @lenovo/agent-sdk-channel

> AI Coding Agent SDK 的渠道(IM)能力子包 ｜ 当前版本 `0.1.0`

为 [`@lenovo/agent-sdk`](../sdk) 提供 IM 渠道接入能力:基于 [golembot](https://www.npmjs.com/package/golembot) 适配飞书(Feishu)/ 企业微信(WeChat)/ 钉钉(DingTalk)/ Slack。把渠道收到的消息接入 Agent 会话,并把 Agent 的回复经渠道发回。

## 安装

```bash
npm install @lenovo/agent-sdk @lenovo/agent-sdk-channel
npm install better-sqlite3   # peerDependency
```

> 本包依赖核心包 `@lenovo/agent-sdk`(runner / session / config / database),需一并安装。私有仓库 `https://registry-smb.lenovo.com`。

## 用法(NestJS 宿主)

```typescript
import { ChannelModule } from "@lenovo/agent-sdk-channel";

@Module({
  imports: [
    AgentModule.forRoot({ db }), // 核心能力
    ChannelModule,               // 渠道能力
  ],
})
export class AppModule {}
```

接入后,把 `ChannelGatewayBridge` / `ChannelDaemonService` 发出的事件接到传输内核的广播(见宿主侧 `TransportWiring`)。

## 主要导出

| 导出 | 说明 |
| --- | --- |
| `ChannelModule` | 渠道能力的 NestJS 模块 |
| `ChannelService` | 渠道增删改查与消息收发 |
| `ChannelDaemonService` | 渠道适配器守护(连接/重连/状态) |
| `ChannelGatewayBridge` | 渠道事件桥接到传输内核 |
| `ChatSessionService` | 渠道会话与 Agent 会话的映射 |
| `GolemChannelManager` | golembot 适配器管理 |
| `runChannelMigrations` | 渠道相关数据表迁移 |

## 文档

完整文档见 [`docs/sdk/`](../../docs/sdk/README.md)。

## 许可

私有包,仅限 Lenovo 内部产品线使用。
