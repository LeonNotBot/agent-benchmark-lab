/**
 * @fileoverview MCP 连接器核心类型定义。
 * @module @lenovo/agent-sdk / capability / mcp / types
 * @internal
 */

/** MCP Server 传输类型 */
export type MCPServerTransportType = "stdio" | "sse" | "streamable_http";

/** MCP Server 运行时状态 */
export type MCPServerStatus =
  | "installed"   // 已安装（配置已保存，进程未启动）
  | "starting"   // 启动中
  | "running"    // 运行中
  | "error"      // 运行异常
  | "stopped";   // 已停止

/** Tool 风险等级 */
export type MCPToolRisk = "read" | "write" | "danger";

/**
 * MCP Server 配置（用户输入 / 存储用）。
 * 创建/更新时使用此结构。
 */
export interface MCPServerConfig {
  id: string;
  name: string;
  description?: string;
  /** 传输类型 */
  type: MCPServerTransportType;
  /** stdio 场景：可执行命令（npx / uvx / 自定义路径） */
  command?: string;
  /** stdio 场景：命令参数列表 */
  args?: string[];
  /** stdio / sse / http 通用：环境变量（敏感值需外部注入，不存明文 token） */
  env?: Record<string, string>;
  /** sse / streamable_http 场景：服务端 URL */
  url?: string;
  /** 启动参数（sse/http 可选，如 headers / auth） */
  headers?: Record<string, string>;
  /** 排序权重 */
  sortOrder?: number;
  createdAt: number;
  updatedAt: number;
}

/**
 * MCP Server 运行时状态（包含动态信息）。
 * 列表查询和事件推送时使用此结构。
 */
export interface MCPServer extends MCPServerConfig {
  status: MCPServerStatus;
  /** 该 Server 注册的所有 Tool */
  tools: MCPTool[];
  /** 最新错误信息（status === "error" 时填充） */
  errorMessage?: string;
}

/**
 * MCP Tool 模型（来自 MCP Server 的 tools/list 响应）。
 */
export interface MCPTool {
  name: string;
  description: string;
  /** JSON Schema（InputSchema） */
  inputSchema: object;
  /** 所属 Server ID */
  serverId: string;
  /** 所属 Server 名称 */
  serverName: string;
  /** 风险等级（需静态分析或用户标注） */
  risk: MCPToolRisk;
}

/** Tool 调用结果 */
export interface MCPToolResult {
  toolUseId: string;
  toolName: string;
  serverId: string;
  /** 执行是否成功 */
  success: boolean;
  /** 成功时为工具返回内容；失败时为错误信息 */
  content: unknown;
  /** 执行耗时（ms） */
  durationMs?: number;
}

/** 权限请求 */
export interface MCPPermissionRequest {
  toolUseId: string;
  toolName: string;
  serverId: string;
  risk: MCPToolRisk;
  /** Tool input 的脱敏展示（不暴露 token 等敏感字段） */
  safePreview: string;
  timestamp: number;
}

/**
 * MCP Server 预设模板（Marketplace 快速添加用）。
 */
export interface MCPToolTemplate {
  id: string;
  name: string;
  description: string;
  /** 推荐命令（用户可自行修改） */
  type: MCPServerTransportType;
  command?: string;
  args?: string[];
  url?: string;
  /** 推荐 env keys（用户需自行填值） */
  requiredEnvKeys?: string[];
  /** 预标注的 Tool risk 映射（toolName → risk） */
  toolRiskHints?: Record<string, MCPToolRisk>;
  website?: string;
  iconUrl?: string;
}

/** stdio transport options */
export interface StdioTransportOptions {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  /** 工作目录，默认继承父进程 */
  cwd?: string;
  /** 超时（ms），默认 120000（覆盖首次 uvx/npx 联网安装依赖的耗时场景） */
  timeout?: number;
}

/** sse transport options */
export interface SseTransportOptions {
  url: string;
  headers?: Record<string, string>;
  /** 心跳间隔（ms），默认 30000 */
  heartbeatIntervalMs?: number;
}

/** streamable_http transport options */
export interface StreamableHttpTransportOptions {
  url: string;
  headers?: Record<string, string>;
  /** 请求级 auth token（可选） */
  authToken?: string;
}

/** Transport 选项联合 */
export type TransportOptions =
  | { type: "stdio"; opts: StdioTransportOptions }
  | { type: "sse"; opts: SseTransportOptions }
  | { type: "streamable_http"; opts: StreamableHttpTransportOptions };
