import type { Locale } from "../../i18n/locales";
export type { Locale };

export type AppView =
  | "chat"
  | "agents"
  | "skills"
  | "search"
  | "knowledge"
  | "memory"
  | "automation"
  | "connectors"
  | "channels"
  | "endpoints"
  | "secrets"
  | "model-routing"
  | "settings"
  | "history";

export type QuickPhrase = { id: string; title: string; content: string };

export interface TodoItem {
  id: string;
  content: string;
  status: "pending" | "in_progress" | "completed";
  priority: "high" | "medium" | "low";
  critical?: boolean;
  /** 进行时态文案（如 "Fixing auth bug"），来自 Task 工具的 activeForm，仅用于 UI 显示 */
  activeForm?: string;
}

export interface PermissionRequest {
  toolUseId: string;
  toolName: string;
  input: unknown;
}

// ── SessionView sub-interfaces (split to reduce merge conflicts) ──

export interface SessionMeta {
  id: string;
  title: string;
  status: any;
  cwd?: string;
  type?: "normal";
  kind?: any;
  createdAt?: number;
  updatedAt?: number;
  hydrated: boolean;
  loadingHistory?: boolean;
  lastPrompt?: string;
  // 工作目录已不存在时，记录缺失路径，驱动 composer 顶部「工作目录缺失」横幅。
  cwdMissing?: string;
  // 本会话是否已自动弹过预览（completed 时只自动打开一次内置浏览器）。
  previewOpened?: boolean;
  // 会话级运行配置（per-session）：模型 + 权限模式。随会话创建/删除而生灭。
  model?: string;
  endpointId?: string;
  // 会话级智能升级配置：有值 = 该会话走 SH（与 model/endpointId 互斥，写入点保证）。
  smartHybrid?: import("@lenovo/agent-protocol").SmartHybridConfig;
  permissionMode?: import("@lenovo/agent-protocol").PermissionMode;
}

export interface SessionMessages {
  messages: any[];
  permissionRequests: PermissionRequest[];
  routingDecision?: any;
  realtimeToolCounts?: Record<string, number>;
}

export interface SessionDiffState {
  diffs?: any[];
  diffStatus?: "pending" | "applied" | "discarded";
  changedFiles?: any[];
  changedFilesLoaded?: boolean;
  selectedPreviewFile?: string | null;
  generatedFiles?: any[];
  generatedFilesDir?: string;
}

export interface SessionTaskState {
  usageSummary?: any;
  /** 任务清单：由 server 的 tasks.snapshot 事件驱动（监听 CLI 任务目录的全量结构化快照） */
  tasks?: TodoItem[];
  /**
   * Smart Hybrid 关键任务升级中的模型名。有值 = 该会话正处于升级态（跑升级模型），
   * 无值 = 用默认模型。会话级事实（每会话独立），由 escalation.status 事件写入、
   * 会话到达终态（completed/error/aborted）时清理。不是全局状态——避免跨会话串台与卡死。
   */
  escalationModel?: string;
}

export type SessionView = SessionMeta & SessionMessages & SessionDiffState & SessionTaskState;

export type {
  RoutingDecision,
  DeviceCapabilities,
  SkillMeta,
  MarketSkill,
  ChannelConfig,
  ChannelStatus,
  Template,
  TemplateSummary,
  UsageSummary,
  ChangedFile,
  FileDiff,
  GeneratedFile,
  Attachment,
  SmartHybridConfig,
  EscalationHistoryEntry,
  SelectedModel,
  RoutingPreference,
} from "@lenovo/agent-protocol";
