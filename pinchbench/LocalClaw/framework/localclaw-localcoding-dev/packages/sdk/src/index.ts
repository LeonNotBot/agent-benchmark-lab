/**
 * @lenovo/agent-sdk — 公共出口。
 *
 * 供 localcoding / teamai / localclaw 等产品共用的 AI Coding Agent 能力。
 *
 * ┌─ 怎么用？两条入口，按场景选 ──────────────────────────────────┐
 * │                                                                  │
 * │  A. NestJS 宿主（如本仓库 server）→ 用 AgentModule             │
 * │       imports: [ AgentModule.forRoot({ db }) ]                   │
 * │     一行拿到全部能力 Service（global 注入），无需逐个 import。    │
 * │                                                                  │
 * │  B. 任意 Node 环境 / 快速试用 → 用 createAgent()                │
 * │       const agent = await createAgent({ dbPath });               │
 * │       for await (const m of agent.run({ prompt })) { ... }       │
 * │     框架无关，async iterator，零 NestJS 概念。                   │
 * │                                                                  │
 * └──────────────────────────────────────────────────────────────┘
 *
 * 其余导出是「装配件 / 单项能力 / 类型」，仅在需要细粒度控制时才用到。
 *
 * ── 稳定性分层 ──
 *   【公共 API】 @public：语义稳定，遵循 semver。第三方请只依赖这一段。
 *   【高级/内部】@internal：实现管线（进程 spawn / 路由打分 / env 构造等），
 *                不保证跨版本稳定，随时可改名收窄，不计入 semver。
 *
 * 导出一律「精确 named export」，公共面显式声明；抽取进度见 docs/architecture/sdk-extraction-plan.md。
 */

// ════════════════════════════════════════════════════════════════
//  【公共 API】 @public — 稳定契约
// ════════════════════════════════════════════════════════════════

// ╔═══ 推荐入口 ═══════════════════════════════════════════════════╗

// ── 入口 A：NestJS 宿主一站式聚合（推荐）──
export { AgentModule } from "./agent.module";

// ── 入口 B：框架无关门面（async iterator，零 NestJS）──
export { createAgent } from "./facade/create-agent";
export type {
  Agent,
  CreateAgentOptions,
  AgentRunInput,
} from "./facade/create-agent";

// ╚════════════════════════════════════════════════════════════════╝

// ── 基座层：数据库（AgentModule 已内含；单独装配时才需要）──
export { DATABASE, DatabaseModule } from "./database/database.module";
export { applyMigrations, runSdkMigrations } from "./database/database.migrations";
export type { Migration } from "./database/database.migrations";

// ── 基座层：配置 ──
export {
  getAgentConfigDir,
  getAgentSettingsPath,
  readAgentSettings,
  writeAgentSettings,
} from "./config/agent-settings";
export type { AgentSettings } from "./config/agent-settings";
export {
  getClaudeConfigJsonPath,
  readClaudeConfigJson,
  writeClaudeConfigJson,
} from "./config/claude-config-json";
export type { ClaudeConfigJson } from "./config/claude-config-json";
export { claudeCodeEnv, loadClaudeSettingsEnv } from "./config/claude-settings";

// ── 基座层：路径解析（唯一真相）──
// 宿主用 configurePaths() 在启动早期注入各产品独立的目录；不调用则走环境变量 / 默认值。
export {
  configurePaths,
  getProductName,
  getAgentHomeDir,
  getClaudeHomeDir,
  getClaudeJsonPath,
  getScheduledTasksPath,
  getScheduledTaskHistoryPath,
  getWorkspaceRoot,
  getSkillsDir,
  getTemplatesDir,
  getProjectsDir,
  getChannelsDir,
  getSecretsPath,
} from "./config/paths";
export type { PathOverrides } from "./config/paths";
// @deprecated 顶层常量别名（import 期固化，不随 configurePaths 变化）。新代码用上面的函数。
export { CLAUDE_HOME_DIR, CLAUDE_JSON_PATH } from "./config/paths";

// ── 核心能力：会话 ──
// 对外推荐：注入令牌 SESSION_SERVICE + 接口 ISessionService（依赖接口，不耦合实现）。
export { SESSION_SERVICE, SessionService } from "./core/session/session.service";
export type { ISessionService } from "./core/session/session.service";
export { SessionModule } from "./core/session/session.module";
export type {
  Session,
  SessionHistory,
  SessionKind,
  SessionRoutingOverride,
  StoredSession,
} from "./core/session/session.service";
/** @internal 会话运行时态（含 Map/AbortController）与待决权限，仅供 SDK 内部 / 高级集成。 */
export type {
  RuntimeSession,
  PendingPermission,
} from "./core/session/session.service";

// ── 核心能力：Git ──
// 对外推荐：注入令牌 GIT_SERVICE + 接口 IGitService。
export { GIT_SERVICE, GitService } from "./core/git/git.service";
export type { IGitService } from "./core/git/git.service";
export { GitModule } from "./core/git/git.module";

// ── 核心能力：Runner（CLI 进程编排）──
export { RunnerService } from "./capability/runner/runner.service";
export { RunnerModule } from "./capability/runner/runner.module";
export { TaskSnapshotWatcherService } from "./capability/runner/task-snapshot-watcher.service";
export type {
  RunnerHandle,
  RunnerInput,
} from "./capability/runner/runner-spawn.service";
/** @internal Runner 内部完整选项（含路由/env 中间态），不计入对外 semver；调用方请用 RunnerInput。 */
export type { RunnerOptions } from "./capability/runner/runner-spawn.service";

// ── 核心能力：路由 ──
// 对外推荐：注入令牌 ROUTING_SERVICE + 接口 IRoutingService。
export { ROUTING_SERVICE, RoutingService } from "./capability/routing/routing.service";
export type { IRoutingService } from "./capability/routing/routing.service";
export { RoutingModule } from "./capability/routing/routing.module";

// ── 核心能力：工作区 ──
// 对外推荐：注入令牌 WORKSPACE_SERVICE + 接口 IWorkspaceService。
export { WORKSPACE_SERVICE, WorkspaceService } from "./capability/workspace/workspace.service";
export type { IWorkspaceService } from "./capability/workspace/workspace.service";
export { WorkspaceModule } from "./capability/workspace/workspace.module";
// 文件系统监听能力（chokidar）：宿主编排 WebSocket 推送时注入。
export { WorkspaceWatcherService } from "./capability/workspace/workspace-watcher.service";
export type {
  WorkspaceFileChange,
  WorkspaceFileChangeType,
  WorkspaceFileChangeListener,
} from "./capability/workspace/workspace-watcher.service";

// ── 核心能力：定时任务 ──
// 对外推荐：注入令牌 SCHEDULED_TASK_SERVICE + 接口 IScheduledTaskService。
export { SCHEDULED_TASK_SERVICE, ScheduledTaskService } from "./capability/scheduled-task/scheduled-task.service";
export type { IScheduledTaskService } from "./capability/scheduled-task/scheduled-task.service";
export { ScheduledTaskRunnerService } from "./capability/scheduled-task/scheduled-task-runner.service";
export { ScheduledTaskModule } from "./capability/scheduled-task/scheduled-task.module";
// 排程构建/校验单一真相源：buildCron / resolveCron / isValidCron + ScheduleSpec 类型。
export { buildCron, resolveCron, isValidCron } from "./capability/scheduled-task/cron-build";
export type { ScheduleSpec } from "./capability/scheduled-task/cron-build";

// ── 核心能力：项目能力扫描（.claude 目录可视化，产品无关）──
// 扫描 <cwd>/.claude/ 的命令/子代理/技能/规则/知识库，供宿主 UI 与斜杠补全。
export { ProjectCapabilityService, ProjectCapabilityModule } from "./capability/project-capability";

// ── 核心能力：Plugin(.claude 场景包) 本地导入（产品无关）──
// 导入整包 .claude 到全局或项目，含预检/冲突检测/合并复制。
export { PluginService, PluginModule } from "./capability/plugin";

// ── 核心能力：Deploy Agent ──
export {
  DeployAgentService,
  type SubmitInput,
  type SubmitResult,
} from "./capability/deploy-agent/deploy-agent.service";
export { DeployAgentModule } from "./capability/deploy-agent/deploy-agent.module";

// ── 工具：附件上下文 ──
export {
  buildPromptWithAttachments,
  isTextFile,
} from "./util/attachment-context";
export type {
  PersistedAttachmentContext,
  PersistedAttachmentFile,
} from "./util/attachment-context";

// ── 工具：日志 ──
// SDK 内部日志默认按 LENOVO_SDK_LOG_LEVEL（默认 "log"，保持历史控制台行为）过滤到 console。
// 消费方可用 setSdkLogger 接管、或 setSdkLogLevel("warn"|"silent") 降噪/静默。
export { logger, setSdkLogger, setSdkLogLevel } from "./util/logger";
export type { SdkLogger, SdkLogLevel } from "./util/logger";

// 跨平台原子写文件（write-then-rename + Windows 文件锁重试），统一各处持久化写入。
export { atomicWriteFile } from "./util/atomic-write";

// ── 网关工具（OpenAI-compatible 规整 / 重试 / token 上限）──
export { fetchWithRetry } from "./capability/gateway/fetch-with-retry";
export { clampMaxTokens, resolveOutputCap } from "./capability/gateway/model-caps";
export { normalizeOpenAIBody } from "./capability/gateway/normalize-body";

// ── 传输层（WebSocket）──
// 注：传输内核绑定了 localclaw 专有的 WS 协议，通用集成不一定需要；
// 第三方若用自有传输（SSE/gRPC/进程内），可忽略这一组、直接用上面的能力 + createAgent()。
export { WebsocketGateway } from "./transport/websocket.gateway";
export { WebsocketModule } from "./transport/websocket.module";
export {
  SESSION_START_CONTRIBUTORS,
  WS_EVENT_HANDLERS,
} from "./transport/contracts";
export type {
  SessionStartPayload,
  SessionStartContributor,
  WsEventHandler,
} from "./transport/contracts";

// ════════════════════════════════════════════════════════════════
//  【高级 / 内部】 @internal — 不稳定，仅供本仓库与高级集成方使用
//  这些是上面公共能力背后的实现管线。直接依赖它们意味着自负升级风险：
//  随时可能改名、收窄签名或移除，不计入 semver。第三方集成请勿使用。
//
//  注：大量纯内部实现类（RunnerSpawnService / SmartHybridService /
//  DeviceCapabilityService / PromptClassifierService / CronMcpRegistrarService /
//  ToolDiffService / buildXxxEnv / MODEL_MATRIX 等）已不再从包根导出——
//  它们只在 SDK 内部经相对路径互相引用，无任何外部消费者。如确有高级需求，
//  请走深路径 import 并自负风险，或提 issue 讨论提升为 @public。
// ════════════════════════════════════════════════════════════════

// ── 内部：数据库迁移底层原语（channel 子包迁移用）──
/** @internal */
export { addColumnIfMissing } from "./database/database.migrations";

// ── 内部：会话文件变更 service（宿主 file-change 适配用）──
/** @internal */
export { FileChangeService } from "./core/session/file-change.service";

// ── 内部：会话工具累计 diff / 整轮撤销 service（宿主 review 面板 + 汇总卡片用）──
/** @internal */
export { ToolDiffService } from "./core/session/tool-diff.service";
/** @internal */
export type { SessionRoundDiff } from "./core/session/tool-diff.service";
/** @internal */
export { SessionRevertService } from "./core/session/session-revert.service";
/** @internal */
export type { RevertResult, ReapplyResult } from "./core/session/session-revert.service";

// ── 内部：路由端点（宿主 routing 适配 + 端点预设用）──
/** @internal */
export {
  EndpointRegistryService,
  modelTier,
  findModelIdConflicts,
  ModelIdConflictError,
  EndpointNotFoundError,
} from "./capability/routing/endpoint-registry.service";
/** @internal */
export type { ModelIdConflict } from "./capability/routing/endpoint-registry.service";
/** @internal */
export { ENDPOINT_PRESETS } from "./capability/routing/endpoint-presets";
/** @internal */
export type { EndpointPreset } from "./capability/routing/endpoint-presets";
// ── 供应商描述符（声明式上游接入知识；Phase 1 纯数据，Phase 2 起被三路径调用）──
/** @internal */
export {
  PROVIDER_DESCRIPTORS,
  genericDescriptor,
  resolveDescriptor,
  resolveUpstream,
  authHeaders,
} from "./capability/provider/provider-descriptor";
/** @internal */
export type {
  ProviderDescriptor,
  ProviderPurpose,
  ProviderAuth,
  ResolvedUpstream,
} from "./capability/provider/provider-descriptor";

// ── 渠道能力已拆分为独立子包 @lenovo/agent-sdk-channel ──
// 它依赖本包（runner / session / config / database），从那里导入 ChannelModule 等。

// ── MCP 连接器能力（@internal）──
/** @internal */
export { MCPServerManager } from "./capability/mcp/server-manager";
/** @internal */
export { MCPToolRegistry } from "./capability/mcp/registry";
/** @internal */
export { MCPToolRouter } from "./capability/mcp/router";
/** @internal */
export type { ConflictStrategy, RouteResult } from "./capability/mcp/router";
/** @internal */
export { StdioTransport } from "./capability/mcp/transport/stdio";
/** @internal */
export { isMcpServerAgentEnabled } from "./capability/mcp/agent-enabled";
/** @internal */
export type {
  MCPServerTransportType,
  MCPServerStatus,
  MCPToolRisk,
  MCPServerConfig,
  MCPServer,
  MCPTool,
  MCPToolResult,
  MCPPermissionRequest,
  MCPToolTemplate,
  StdioTransportOptions,
  SseTransportOptions,
  StreamableHttpTransportOptions,
  TransportOptions,
} from "./capability/mcp/types";
