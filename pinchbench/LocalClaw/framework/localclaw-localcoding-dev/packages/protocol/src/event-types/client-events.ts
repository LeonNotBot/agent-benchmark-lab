import type { Attachment, PermissionMode } from "../session-types";
import type { RoutingPreference, SmartHybridConfig } from "../routing-types";
import type { ChannelConfig, ChannelType } from "../channel-types";
import type { PermissionResult } from "@anthropic-ai/claude-agent-sdk";
import type { Template } from "../template-types";

// ── Session Events ──

export type SessionClientEvent = {
  type: "session.start";
  payload: {
    title: string;
    prompt: string;
    cwd?: string;
    templateSlug?: string;
    allowedTools?: string;
    attachments?: Attachment[];
    knowledgeDatasetIds?: string[];
    designMode?: boolean;
    designPromptEnhance?: boolean;
    // 会话级运行配置（per-session）。缺省时后端回退默认模型 / default 权限模式。
    model?: string;
    endpointId?: string;
    permissionMode?: PermissionMode;
    // 会话级 Smart Hybrid 配置：有值 = 该会话走智能升级（base+upgrade 两模型），
    // 与 model/endpointId 互斥。缺省 = 走单一 model。
    smartHybrid?: SmartHybridConfig;
  };
} | {
  type: "session.continue";
  payload: {
    sessionId: string;
    prompt: string;
    attachments?: Attachment[];
    knowledgeDatasetIds?: string[];
    model?: string;
    endpointId?: string;
    permissionMode?: PermissionMode;
    smartHybrid?: SmartHybridConfig;
  };
} | {
  type: "session.stop";
  payload: { sessionId: string };
} | {
  type: "session.delete";
  payload: { sessionId: string };
} | {
  // 预热：用户聚焦/切到某个已存在会话 tab 时发送，提示后端提前 spawn CLI 进程到就绪态，
  // 把冷启动成本藏到用户发消息之前。尽力而为，后端失败静默（退化为发消息时冷启动）。
  type: "session.prewarm";
  payload: { sessionId: string; model?: string; endpointId?: string; smartHybrid?: SmartHybridConfig; permissionMode?: PermissionMode };
} | {
  type: "session.list";
} | {
  type: "session.history";
  payload: { sessionId: string };
};

// ── Permission Events ──

export type PermissionClientEvent = {
  type: "permission.response";
  payload: {
    sessionId: string;
    toolUseId: string;
    result: PermissionResult;
    /** 用户选择「本次会话不再询问」：服务端据此把该工具加入会话级放行集合。 */
    dontAskAgain?: boolean;
  };
};

// ── Routing Events ──

export type RoutingClientEvent = {
  type: "routing.preference";
  payload: { preference: RoutingPreference; modelOverride?: string; endpointId?: string; smartHybridConfig?: SmartHybridConfig };
};

// ── Skill Events ──

export type SkillClientEvent = {
  type: "skill.list";
} | {
  type: "skill.install";
  payload: { source: string; name: string };
};

// ── Template Events ──

export type TemplateClientEvent = {
  type: "template.list";
} | {
  type: "template.detail";
  payload: { slug: string };
} | {
  type: "template.save";
  payload: { template: Omit<Template, "builtin"> };
} | {
  type: "template.delete";
  payload: { slug: string };
};

// ── Speech Events ──

export type SpeechClientEvent = {
  type: "speech.recognize";
  payload: { audio: string; locale?: string };
};

// ── Channel Events ──

export type ChannelClientEvent = {
  type: "channel.list";
} | {
  type: "channel.save";
  payload: { channel: Partial<ChannelConfig> & { type: ChannelType } };
} | {
  type: "channel.delete";
  payload: { channelId: string };
} | {
  type: "channel.toggle";
  payload: { channelId: string; enabled: boolean };
} | {
  type: "channel.test";
  payload: { channelId: string };
};

// ── Workspace Events ──

export type WorkspaceClientEvent = {
  // 前端打开文件面板时订阅某个目录的文件系统变更（fs.watch 推送）。
  type: "workspace.watch";
  payload: { path: string };
} | {
  // 关闭面板 / 切换目录时取消订阅，释放后端 watcher。
  type: "workspace.unwatch";
  payload: { path: string };
};

// ── Union Type ──

export type ClientEvent =
  | SessionClientEvent
  | PermissionClientEvent
  | RoutingClientEvent
  | SkillClientEvent
  | TemplateClientEvent
  | SpeechClientEvent
  | ChannelClientEvent
  | WorkspaceClientEvent;