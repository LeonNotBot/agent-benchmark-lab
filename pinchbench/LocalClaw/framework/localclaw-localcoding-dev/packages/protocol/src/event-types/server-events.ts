import type { StreamMessage, Attachment, SessionStatus, SessionKind, SessionInfo } from "../session-types";
import type { RoutingDecision } from "../routing-types";
import type { DeviceCapabilities, EndpointInfo } from "../routing-types";
import type { SkillMeta, SkillDetail } from "../skill-types";
import type { Template, TemplateSummary } from "../template-types";
import type { ChannelConfig, ChannelStatus, ChannelType } from "../channel-types";
import type { MCPServer, MCPServerStatus } from "../mcp-types";
import type { ScheduledTask } from "../scheduled-types";
import type { FileDiff, GeneratedFile } from "../diff-types";
import type { UsageSummary } from "../session-types";

// ── Stream Events ──

export type StreamServerEvent = {
  type: "stream.message";
  payload: { sessionId: string; message: StreamMessage };
} | {
  type: "stream.user_prompt";
  payload: { sessionId: string; prompt: string; attachments?: Attachment[]; source?: "user" | "automation" };
};

// ── Session Events ──

export type SessionServerEvent = {
  type: "session.status";
  payload: {
    sessionId: string;
    status: SessionStatus;
    title?: string;
    cwd?: string;
    error?: string;
    kind?: SessionKind;
  };
} | {
  type: "session.list";
  payload: { sessions: SessionInfo[] };
} | {
  type: "session.history";
  payload: { sessionId: string; status: SessionStatus; messages: StreamMessage[] };
} | {
  type: "session.deleted";
  payload: { sessionId: string };
} | {
  type: "session.usage";
  payload: { sessionId: string; summary: UsageSummary };
} | {
  type: "session.diff";
  payload: { sessionId: string; diffs: FileDiff[] };
} | {
  type: "session.files";
  payload: { sessionId: string; sessionWorkDir: string; files: GeneratedFile[] };
} | {
  type: "session.retry";
  payload: { sessionId: string; attempt: number; maxRetries: number; delayMs?: number };
};

// ── Routing Events ──

export type RoutingServerEvent = {
  type: "routing.decision";
  payload: { sessionId: string; decision: RoutingDecision };
} | {
  type: "routing.status";
  payload: { status: string; detail?: string; progress?: number };
} | {
  type: "device.capabilities";
  payload: DeviceCapabilities;
} | {
  type: "escalation.status";
  payload: { sessionId: string; active: boolean; model: string; from: string };
} | {
  type: "endpoint.list";
  payload: { endpoints: EndpointInfo[] };
};

// ── Skill Events ──

export type SkillServerEvent = {
  type: "skill.list";
  payload: { skills: SkillMeta[] };
} | {
  type: "skill.detail";
  payload: { skill: SkillDetail };
} | {
  type: "skill.installed";
  payload: { skill: SkillMeta };
} | {
  type: "skill.deleted";
  payload: { name: string };
} | {
  type: "skill.error";
  payload: { message: string };
};

// ── Template Events ──

export type TemplateServerEvent = {
  type: "template.list";
  payload: { templates: TemplateSummary[] };
} | {
  type: "template.detail";
  payload: { template: Template };
} | {
  type: "template.saved";
  payload: { template: TemplateSummary };
} | {
  type: "template.deleted";
  payload: { slug: string };
} | {
  type: "template.error";
  payload: { message: string };
};

// ── Channel Events ──

export type ChannelServerEvent = {
  type: "channel.list";
  payload: { channels: ChannelConfig[] };
} | {
  type: "channel.status";
  payload: { channelId: string; status: ChannelStatus; error?: string };
} | {
  type: "channel.saved";
  payload: { channel: ChannelConfig };
} | {
  type: "channel.deleted";
  payload: { channelId: string };
} | {
  type: "channel.incoming";
  payload: {
    sessionId?: string;
    channelType: ChannelType;
    text: string;
    senderId?: string;
    chatId?: string;
    timestamp: number;
  };
} | {
  type: "channel.qrcode";
  payload: { url: string };
} | {
  type: "channel.qrcode.warning";
  payload: { message: string };
};

// ── MCP Events ──

export type McpServerEvent = {
  type: "mcp.server.list";
  payload: { servers: MCPServer[] };
} | {
  type: "mcp.server.updated";
  payload: { server: MCPServer };
} | {
  type: "mcp.server.status";
  payload: { serverId: string; status: MCPServerStatus; error?: string };
} | {
  type: "mcp.server.deleted";
  payload: { serverId: string };
};

// ── Permission Events ──

export type PermissionServerEvent = {
  type: "permission.request";
  payload: { sessionId: string; toolUseId: string; toolName: string; input: unknown };
};

// ── Error Events ──

export type ErrorServerEvent = {
  type: "runner.error";
  payload: { sessionId?: string; message: string };
};

// ── Scheduled Events ──

export type ScheduledServerEvent = {
  type: "scheduled.execution.failed";
  payload: { taskName: string; error: string; taskId?: string };
} | {
  type: "scheduled.created";
  payload: { task: ScheduledTask };
} | {
  type: "scheduled.updated";
  payload: { task: ScheduledTask };
} | {
  type: "scheduled.deleted";
  payload: { id: string };
};

// ── Speech Events ──

export type SpeechServerEvent = {
  type: "speech.result";
  payload: { text: string };
} | {
  type: "speech.error";
  payload: { message: string };
};

// ── Tasks Events ──

/** 单个任务快照项，对应 CLI 写到磁盘的任务 JSON（~/.localclaw/tasks/<claudeSessionId>/<id>.json） */
export type TaskSnapshotItem = {
  id: string;
  subject: string;
  description?: string;
  status: "pending" | "in_progress" | "completed";
  activeForm?: string;
  owner?: string;
  blockedBy?: string[];
  critical?: boolean;
};

export type TasksServerEvent = {
  type: "tasks.snapshot";
  payload: { sessionId: string; tasks: TaskSnapshotItem[] };
};

// ── Workspace Events ──

export type WorkspaceServerEvent = {
  type: "workspace.file.added";
  payload: { path: string; isDir: boolean };
} | {
  type: "workspace.file.deleted";
  payload: { path: string; isDir: boolean };
} | {
  type: "workspace.file.changed";
  payload: { path: string };
};

// ── Union Type ──

export type ServerEvent =
  | StreamServerEvent
  | SessionServerEvent
  | RoutingServerEvent
  | SkillServerEvent
  | TemplateServerEvent
  | ChannelServerEvent
  | McpServerEvent
  | PermissionServerEvent
  | ErrorServerEvent
  | ScheduledServerEvent
  | SpeechServerEvent
  | TasksServerEvent
  | WorkspaceServerEvent;