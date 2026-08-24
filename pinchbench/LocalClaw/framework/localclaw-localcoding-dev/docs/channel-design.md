# Channel 功能设计文档

## 一、功能概述

Channel（渠道）允许用户将外部消息平台（飞书、微信、Telegram、Discord 等）接入当前运行中的 Claude Code 会话，
使 Claude 能在用户不在桌面端时通过这些渠道接收指令和推送响应。

用户在侧边栏选择一个 channel 类型，填入对应平台的凭据（如 App ID + Secret），即可启用。

## 二、支持的 Channel 类型

| Channel | 需要的凭据 | 说明 |
|---------|-----------|------|
| **飞书 (Feishu)** | App ID + App Secret | 飞书开放平台创建应用获取 |
| **Telegram** | Bot Token | 通过 @BotFather 创建获取 |
| **Discord** | Bot Token | Discord Developer Portal 创建获取 |
| **微信 (WeChat)** | 无需凭据，扫码登录 | 内置支持，启动后扫码 |
| **钉钉 (DingTalk)** | App Key + App Secret | 钉钉开放平台获取 |

## 三、数据模型

### 3.1 核心类型

```typescript
export type ChannelType = "feishu" | "telegram" | "discord" | "wechat" | "dingtalk";
export type ChannelStatus = "disconnected" | "connecting" | "connected" | "error";

export type ChannelConfig = {
  id: string;
  type: ChannelType;
  name: string;
  enabled: boolean;
  credentials: Record<string, string>;
  status: ChannelStatus;
  createdAt: number;
  updatedAt: number;
  errorMessage?: string;
};
```

### 3.2 Channel 类型元数据

```typescript
export type ChannelField = {
  key: string;
  label: string;
  placeholder: string;
  secret: boolean;
  required: boolean;
};
```

## 四、前后端事件协议

### Server -> Client
- `channel.list` — 返回所有 channel 配置
- `channel.status` — channel 连接状态变更
- `channel.saved` — channel 保存成功
- `channel.deleted` — channel 删除成功
- `channel.message` — 收到外部平台消息

### Client -> Server
- `channel.list` — 请求 channel 列表
- `channel.save` — 保存/更新 channel
- `channel.delete` — 删除 channel
- `channel.toggle` — 启用/禁用 channel
- `channel.test` — 测试连接

## 五、UI 设计

### 5.1 侧边栏入口

在 Skills 按钮下方新增 Channels 按钮，风格一致。

### 5.2 Channel 管理面板 (ChannelManager.tsx)

全屏覆盖面板（与 SkillManager 同模式），包含：
- 顶部标题 + 返回按钮
- 添加 Channel 按钮
- Channel 卡片列表（显示类型、名称、状态、操作按钮）

### 5.3 添加/编辑弹窗 (ChannelEditor.tsx)

两步流程：
1. 选择 Channel 类型（卡片网格）
2. 填写凭据表单（根据类型动态渲染字段）

## 六、后端架构

### 6.1 模块结构

```
packages/server/src/modules/channel/
├── channel.module.ts
├── channel.service.ts       # CRUD + 持久化
├── channel.gateway.ts       # WebSocket 事件处理
└── adapters/
    ├── base.adapter.ts
    ├── feishu.adapter.ts
    ├── telegram.adapter.ts
    ├── discord.adapter.ts
    ├── wechat.adapter.ts
    └── dingtalk.adapter.ts
```

### 6.2 数据库

SQLite `channels` 表：
```sql
CREATE TABLE IF NOT EXISTS channels (
  id          TEXT PRIMARY KEY,
  type        TEXT NOT NULL,
  name        TEXT NOT NULL,
  enabled     INTEGER DEFAULT 1,
  credentials TEXT NOT NULL,
  status      TEXT DEFAULT 'disconnected',
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
```

### 6.3 消息流

```
外部消息 → ChannelAdapter.onMessage()
         → ChannelService 查找活跃 session
         → WebSocket session.continue 事件
         → RunnerService → Claude CLI stdin
         → Claude 响应 → ChannelAdapter.sendMessage()
```

## 七、实施阶段

1. **Phase 1**: 数据模型 + 数据库表 + 后端模块骨架
2. **Phase 2**: 前端 UI（侧边栏按钮 + 管理面板 + 编辑弹窗）
3. **Phase 3**: 飞书适配器
4. **Phase 4**: Telegram / Discord 适配器
5. **Phase 5**: 微信 / 钉钉
