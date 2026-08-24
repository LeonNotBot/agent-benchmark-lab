// ── Channel types ──

export type ChannelType = "feishu" | "wechat" | "dingtalk" | "wecom";

export type ChannelStatus = "disconnected" | "connecting" | "connected" | "error";

export type ChannelEngine = "golembot" | "legacy";

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
  engine?: ChannelEngine;
  workspaceDir?: string;
};

export type ChannelField = {
  key: string;
  label: string;
  placeholder: string;
  secret: boolean;
  required: boolean;
};

/** 渠道消息记录（会话记录功能） */
export type MessageRecord = {
  id: string;
  channelId: string;
  channelType: ChannelType;
  chatId: string;
  senderId: string;
  direction: "incoming" | "outgoing";
  messageType: "text" | "image" | "file" | "mixed";
  content: string;
  hasAttachment: boolean;
  attachmentInfo: string | null;
  status: "unread" | "read";
  engine: ChannelEngine;
  createdAt: number;
};
