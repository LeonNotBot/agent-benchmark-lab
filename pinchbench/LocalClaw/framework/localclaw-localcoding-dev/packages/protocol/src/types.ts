// Shared types - re-exported from modular types for backward compatibility
// New code should import directly from specific type modules

export type {
  ModelTarget,
  RoutingDecision,
  DeviceCapabilities,
  RoutingPreference,
  ProviderType,
  ModelSlot,
  SelectedModel,
  ActiveCloudModel,
  EscalationHistoryEntry,
  SmartHybridConfig,
  SmartHybridConfigLegacy,
  PromptComplexity,
  ClassificationResult,
  RemoteDeployStatus,
  SshDeployConfig,
  ApiType,
  ModelConfig,
  EndpointConfig,
  EndpointInfo,
  EndpointCreateInput,
  EndpointUpdateInput,
} from "./routing-types";
export type {
  SessionInfo,
  SessionStatus,
  SessionKind,
  PermissionMode,
  Attachment,
  UserPromptMessage,
  StreamMessage,
  UsageSummaryItem,
  UsageSummary,
} from "./session-types";
// 运行时函数（非类型）：CLI 回放噪声判别，需值导出而非 type-only。
export { isCliReplayNoise } from "./session-types";
export type {
  SkillMeta,
  SkillDetail,
  MarketSkill,
  MarketSource,
} from "./skill-types";

export type {
  ProjectCommand,
  ProjectAgent,
  ProjectRule,
  ProjectMemory,
  ProjectCapabilities,
} from "./project-capability-types";

export type {
  PluginManifest,
  PluginCounts,
  PluginScope,
  PluginScript,
  PluginPermissions,
  PluginAudit,
  PluginPreflight,
  PluginImportResult,
  ScaffoldOptions,
  ScaffoldResult,
} from "./plugin-types";

export type {
  ScheduledTask,
  ScheduledTaskSource,
} from "./scheduled-types";

export type {
  ChannelConfig,
  ChannelType,
  ChannelStatus,
  ChannelField,
  ChannelEngine,
} from "./channel-types";

export type {
  FileChangeStatus,
  ChangedFile,
  FileChangesResult,
  DiffLineType,
  DiffLine,
  DiffHunk,
  FileDiff,
  GeneratedFileType,
  GeneratedFile,
  DetectedCommand,
} from "./diff-types";

export type { Template, TemplateSummary, TemplateCategory } from "./template-types";


export type {
  SecretEntry,
  SecretListResponse,
  SecretUpsertRequest,
  SecretCategory,
  SecretDefConfig,
} from "./secret-types";

export type {
  MCPServerTransportType,
  MCPServerStatus,
  MCPToolRisk,
  MCPServerConfig,
  MCPServer,
  MCPTool,
} from "./mcp-types";

export type { ServerEvent, TaskSnapshotItem } from "./event-types/server-events";
export type { ClientEvent } from "./event-types/client-events";

// ── Settings types ──

export type ClaudeSettingsEnv = {
  ANTHROPIC_AUTH_TOKEN: string;
  ANTHROPIC_BASE_URL: string;
  ANTHROPIC_DEFAULT_HAIKU_MODEL: string;
  ANTHROPIC_DEFAULT_OPUS_MODEL: string;
  ANTHROPIC_DEFAULT_SONNET_MODEL: string;
  ANTHROPIC_MODEL: string;
  API_TIMEOUT_MS: string;
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: string;
  CLAUDE_RUNNER_MODE: string;
  CLAUDE_CLI_PATH: string;
  CLAUDE_CLI_EXECUTABLE: string;
};