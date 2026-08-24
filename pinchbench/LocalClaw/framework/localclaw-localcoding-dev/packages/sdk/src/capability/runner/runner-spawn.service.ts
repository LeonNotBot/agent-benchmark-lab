import { logger } from "../../util/logger";
import { isElectronExecutable } from "../../util/electron-exec";
import { Injectable, Inject, type OnModuleInit } from "@nestjs/common";
import { spawn, execSync, spawnSync, type ChildProcess } from "child_process";
import { createHash } from "crypto";
import { createInterface } from "readline";
import { join, resolve } from "path";
import {
  existsSync,
  writeFileSync,
  readFileSync,
  unlinkSync,
  mkdirSync,
  statSync,
} from "fs";
import { homedir } from "os";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { ServerEvent, Attachment, SmartHybridConfig } from "@lenovo/agent-protocol";
import { isCliReplayNoise } from "@lenovo/agent-protocol";
import type { Session, RuntimeSession } from "../../core/session/session.service";
import type { PersistedAttachmentContext } from "../../util/attachment-context";
import { buildPromptWithAttachments } from "../../util/attachment-context";
import { ensureClaudeConfigDir, getClaudeConfigDir } from "./claude-config-dir";
import { resolveSkillAllowlist, isToolAllowedBySkill } from "./skill-allowlist";
import { isSkillDisabled, disabledSkillDenyRules, disabledSkillsHash } from "./skill-disabled";
import { matchesDangerousCommand } from "./dangerous-commands";
import { SmartHybridService, type CriticalTaskSignal } from "../routing/smart-hybrid.service";
import { TaskSnapshotWatcherService } from "./task-snapshot-watcher.service";

/**
 * RunnerInput —— 创建 Runner 的对外稳定输入契约（@public）。
 *
 * 只含调用方真正需要提供的字段（用户输入 / 回调 / 会话级覆盖）。
 * 不含 SDK 内部流水线计算的中间态（路由决策、env 覆盖、直连快照等），
 * 那些在 {@link RunnerOptions} 里，由 RunnerService 内部填充，不对外暴露。
 *
 * 以「单一 options 对象」承载：未来新增可选字段不会破坏既有调用方。
 */
export type RunnerInput = {
  prompt: string;
  attachments?: Attachment[];
  attachmentContext?: PersistedAttachmentContext | null;
  session: RuntimeSession;
  resumeSessionId?: string;
  onEvent: (event: ServerEvent) => void;
  onSessionUpdate?: (updates: Partial<Session>) => void;
  channels?: string[];
  extraDisallowedTools?: string[];
  designMode?: boolean;
  designPromptEnhance?: boolean;
  /** 强制走云端模型（用于 channel/IM 场景，避免本地小模型导致空回复）。 */
  forceCloud?: boolean;
  /**
   * 一次性进程模式：禁用进程复用缓存，每次 spawn 全新 CLI 进程，结束后销毁。
   * 用于 channel/IM 场景，避免会话状态积累导致的沉默或 stdin 时序异常。
   */
  ephemeralProcess?: boolean;
  /** 会话级权限模式覆盖（per-session）：plan/default/acceptEdits/bypassPermissions。 */
  permissionMode?: string;
  /** 会话级模型覆盖（per-message，用户在 Composer 选的）。优先于模板/全局路由。 */
  modelOverride?: string;
  /** 会话级 endpoint 覆盖（配合 modelOverride）。 */
  endpointId?: string;
  /**
   * 会话级 Smart Hybrid 配置（per-message，用户在 Composer 选智能升级）。
   * 有值时构造 preference="smart-hybrid" 的 routingOverride，与 modelOverride 互斥。
   */
  smartHybrid?: SmartHybridConfig;
};

/**
 * RunnerOptions —— Runner 内部完整选项（@internal）。
 *
 * = 对外的 {@link RunnerInput} + SDK 内部流水线中间态。后三个字段由
 * RunnerService.createRunner 在路由 / 读盘后填充并向下游 spawn 层透传，
 * 调用方无需也不应设置。不计入对外 semver。
 */
export type RunnerOptions = RunnerInput & {
  envOverrides?: Record<string, string>;
  routingDecision?: {
    target: string;
    modelName: string;
    provider: string;
    reason: string;
    confidence: number;
  };
};

export type RunnerHandle = {
  abort: () => void;
};

const DEFAULT_CWD = process.cwd();

function resolveCliPath(): string {
  // 1. 显式覆盖（最高优先级）
  if (process.env.CLAUDE_CLI_PATH) return process.env.CLAUDE_CLI_PATH;
  // 2. Electron 打包：resourcesPath/claude-cli
  const resourcesPath = (process as typeof process & { resourcesPath?: string }).resourcesPath;
  if (resourcesPath) {
    const packed = resolve(resourcesPath, "claude-cli", "cli-node.js");
    if (existsSync(packed)) return packed;
  }
  // 3. npm 安装场景：从 @lenovo/claude-cli 包解析（强依赖，正常必命中）
  try {
    return require.resolve("@lenovo/claude-cli/cli-node.js");
  } catch {
    /* 包未安装或解析失败，继续兜底 */
  }
  // 4. 旧版相对路径兜底（源码/旧布局）
  const fromDist = resolve(__dirname, "..", "claude-cli", "cli-node.js");
  if (existsSync(fromDist)) return fromDist;
  // 全部失败：抛明确错误，而非返回不存在路径导致静默 spawn 失败
  throw new Error(
    "[runner-spawn] 无法定位 Claude CLI。请确保已安装依赖 @lenovo/claude-cli，" +
      "或通过环境变量 CLAUDE_CLI_PATH 显式指定 cli-node.js 路径。",
  );
}

const CLI_PATH = resolveCliPath();

/**
 * 本机平台的 bundled ripgrep 是否存在（用于条件式系统 rg 兜底）。
 * 位置：<CLI 所在目录>/vendor/ripgrep/<arch>-<platform>/rg[.exe]，与 fork ripgrep.ts 的
 * builtin 解析一致。memo 化（路径在进程生命周期内不变）。
 */
let _bundledRgChecked: boolean | undefined;
function bundledRipgrepExists(): boolean {
  if (_bundledRgChecked !== undefined) return _bundledRgChecked;
  try {
    const cliDir = resolve(CLI_PATH, "..");
    const bin = process.platform === "win32" ? "rg.exe" : "rg";
    const rgPath = join(cliDir, "vendor", "ripgrep", `${process.arch}-${process.platform}`, bin);
    _bundledRgChecked = existsSync(rgPath);
  } catch {
    _bundledRgChecked = false;
  }
  return _bundledRgChecked;
}

/**
 * 解析打包内嵌的最小 bash 集 bash.exe（仅 Windows）。
 *
 * 背景：claude-cli 在 Windows 上硬依赖 git-bash 的 bash.exe（windowsPaths.ts，找不到
 * 即 process.exit(1)），该依赖经本 spawn 层传导到 Agent 的 Bash 工具执行。我们只打包
 * 最小 bash 集（bash + coreutils + msys dll，无 git），注入到 <CLI 所在目录>/vendor/
 * portablegit/minimal-bash/usr/bin/bash.exe。不分架构：Git for Windows 的 ARM64 包里
 * bash 工具链本就是 x64（MSYS2 未原生移植 ARM64，靠 WOW64 模拟），故 x64/arm64 共用一份。
 * git 不打包，由 claude-cli/本项目从用户系统 PATH 解析。
 * 返回 { bash, binDir }；非 win32 或资产缺失返回 undefined。memo 化。
 */
let _bundledGitBash: { bash: string; binDir: string } | null | undefined;
function resolveBundledGitBash(): { bash: string; binDir: string } | undefined {
  if (_bundledGitBash !== undefined) return _bundledGitBash ?? undefined;
  if (process.platform !== "win32") {
    _bundledGitBash = null;
    return undefined;
  }
  try {
    const cliDir = resolve(CLI_PATH, "..");
    const binDir = join(cliDir, "vendor", "portablegit", "minimal-bash", "usr", "bin");
    const bash = join(binDir, "bash.exe");
    _bundledGitBash = existsSync(bash) ? { bash, binDir } : null;
  } catch {
    _bundledGitBash = null;
  }
  return _bundledGitBash ?? undefined;
}

/**
 * Resolve the Node.js executable to use for spawning the CLI.
 *
 * In production (Electron packaged), system "node" may not be in PATH.
 * process.execPath points to the current Node binary (which is Electron's
 * bundled node when run via fork() from main.cjs).
 */
function resolveExecutable(): { exec: string; needsElectronFlag: boolean } {
  const envExec = process.env.CLAUDE_CLI_EXECUTABLE;
  if (envExec && envExec !== "node") {
    return { exec: envExec, needsElectronFlag: isElectronExecutable(envExec) };
  }
  const exec = process.execPath || "node";
  return { exec, needsElectronFlag: isElectronExecutable(exec) };
}

// 惰性求值 + 缓存：不在模块顶层固化（esbuild bundle 后模块求值顺序不确定，
// 顶层读 process.env.CLAUDE_CLI_EXECUTABLE 可能早于其就绪而算错并永久固化）。
// 首次 spawn 时才解析——彼时 fork env 必已生效。
let _resolvedExec: { exec: string; needsElectronFlag: boolean } | null = null;
function getResolvedExecutable(): { exec: string; needsElectronFlag: boolean } {
  if (!_resolvedExec) {
    _resolvedExec = resolveExecutable();
    logger.log(
      `[runner-spawn] resolved executable=${_resolvedExec.exec} ` +
        `needsElectronFlag=${_resolvedExec.needsElectronFlag} ` +
        `(execPath=${process.execPath}, electron=${(process as { versions?: { electron?: string } }).versions?.electron ?? "none"})`,
    );
  }
  return _resolvedExec;
}


type StdoutMessage = SDKMessage | ControlRequest | ControlResponse | KeepAlive;
type ControlRequest = {
  type: "control_request";
  request_id: string;
  request: { subtype: string; [key: string]: unknown };
};
type ControlResponse = {
  type: "control_response";
  response: {
    subtype: string;
    request_id: string;
    response?: Record<string, unknown>;
  };
};
type KeepAlive = { type: "keep_alive" };

/**
 * default 权限模式下需要用户逐个确认的「写类/副作用」工具集合。
 * 命中这些工具且当前为 default 模式时，can_use_tool 弹确认卡片；其余模式或
 * 工具不在集合内 → auto-allow。会话级放行（sessionAllowedTools）可绕过。
 */
const CONFIRM_TOOLS_DEFAULT = new Set<string>([
  "Write",
  "Edit",
  "MultiEdit",
  "NotebookEdit",
  "Bash",
]);

/**
 * 把用户选择的权限模式映射为传给 CLI 的 --permission-mode 值。
 *
 * 关键点：CLI 原生 acceptEdits 会自动放行 Bash（不调 permission-prompt-tool），
 * 导致我们的危险命令检查失效（实测日志无 [can_use_tool] 输出）。故 acceptEdits
 * 对 CLI 谎报为 default，让**所有**工具调用都经过我们的 can_use_tool handler，
 * 再由 handler 依据内部记录的用户真实模式（currentMode）实现 acceptEdits 语义
 * （危险 Bash → 弹确认；其他工具 → 自动放行）。
 *
 * 其余模式通常原样透传；Smart Hybrid 为了保证 can_use_tool 协议门控可见，会把
 * bypassPermissions 仅在 CLI 层映射为 default，SDK 内部仍保留真实 bypassPermissions 语义。
 */
function toCliPermissionMode(
  userMode: string,
  forceControlRequests = false,
): string {
  if (userMode === "acceptEdits") return "default";
  // Smart Hybrid's protocol gate lives in can_use_tool. Native bypassPermissions would skip
  // that callback entirely, so only Smart Hybrid maps it to CLI "default" while keeping the
  // real user mode in currentMode. The handler still auto-allows ordinary tools after routing.
  if (forceControlRequests && userMode === "bypassPermissions") return "default";
  return userMode;
}

/**
 * plan（计划）模式下禁止执行的「写类/副作用」工具集合。
 *
 * 背景：CLI 内部 isBypassPermissionsModeAvailable 硬编码为 true（见 CLI 源码
 * permissionSetup.ts:930），导致 shouldBypassPermissions 在 plan 模式下也会命中。
 * 故 plan 语义由 SDK 在 can_use_tool 层自实现：命中即 deny，提示模型先调 ExitPlanMode
 * 提交计划，待用户批准退出 plan 模式后再执行。读类工具（Read/Grep/Glob 等）放行，
 * 使模型能继续调研；ExitPlanMode 本身放行（走确认流程）。
 */
export const PLAN_FORBIDDEN_TOOLS = new Set<string>([
  "Write",
  "Edit",
  "MultiEdit",
  "NotebookEdit",
  "Bash",
]);

/**
 * Smart Hybrid natural-trigger protocol gate.
 *
 * The model is still the only component that decides whether work is critical. The runner
 * merely requires one explicit TaskCreate(..., critical:true|false) decision before the
 * first substantive tool call of each user turn. Meta/planning/task-management tools stay
 * available so the model can make that decision without deadlocking itself.
 */
const HYBRID_ROUTING_META_TOOLS = new Set<string>([
  "TaskCreate",
  "TaskUpdate",
  "TaskGet",
  "TaskList",
  "Skill",
  "ToolSearch",
  "AskUserQuestion",
  "EnterPlanMode",
  "ExitPlanMode",
  "exit_plan_mode",
]);

export function isHybridRoutingMetaTool(toolName: string): boolean {
  return HYBRID_ROUTING_META_TOOLS.has(toolName);
}

/**
 * Read-only tools that Claude CLI may execute without surfacing a can_use_tool callback.
 * Seeing one of these in the real assistant SDK stream means the default model has already
 * performed substantive analysis before the routing gate got a chance to enforce a decision.
 */
const HYBRID_PREDECISION_READ_TOOLS = new Set<string>(["Read", "Grep", "Glob"]);

/**
 * Final delivery tools. If the default model already performed read-only substantive work
 * before the gate could observe it, do not destroy the deliverable by denying the final write.
 * A first-action Write/Edit is still gated normally.
 */
const HYBRID_LATE_DELIVERY_TOOLS = new Set<string>(["Write", "Edit", "NotebookEdit"]);

function assistantObservedPreDecisionRead(sdkMsg: SDKMessage): boolean {
  if (sdkMsg.type !== "assistant") return false;
  const content = (sdkMsg as any).message?.content;
  if (!Array.isArray(content)) return false;
  return content.some(
    (block: any) =>
      block?.type === "tool_use" &&
      typeof block.name === "string" &&
      HYBRID_PREDECISION_READ_TOOLS.has(block.name),
  );
}

export function readHybridRoutingDecision(
  toolName: string,
  input: unknown,
): boolean | undefined {
  if (toolName !== "TaskCreate" || typeof input !== "object" || input === null) {
    return undefined;
  }
  const critical = (input as Record<string, unknown>).critical;
  return typeof critical === "boolean" ? critical : undefined;
}

/**
 * Read the Smart Hybrid routing decision from the real aggregated assistant SDK message.
 *
 * TaskCreate is not guaranteed to pass through can_use_tool. The assistant tool_use is the
 * authoritative signal that the model actually declared critical=true|false, so mirror that
 * decision into the per-turn gate state from the SDK stream as well.
 */
export function readAssistantHybridRoutingDecision(
  sdkMsg: SDKMessage,
): boolean | undefined {
  if (sdkMsg.type !== "assistant") return undefined;
  const content = (sdkMsg as any).message?.content;
  if (!Array.isArray(content)) return undefined;

  for (const block of content) {
    if (block?.type !== "tool_use" || block.name !== "TaskCreate") continue;
    const decision = readHybridRoutingDecision(block.name, block.input);
    if (decision !== undefined) return decision;
  }
  return undefined;
}

/** plan 模式下该工具是否应被拦截（写类/副作用工具禁止，读类放行）。 */
export function isPlanForbiddenTool(mode: string, toolName: string): boolean {
  return mode === "plan" && PLAN_FORBIDDEN_TOOLS.has(toolName);
}

/**
 * 每轮对话的可变回调引用。进程复用时直接覆盖此对象上的属性，
 * processOutput 的 rl 监听器在每次收到行时读取最新值。
 */
type ActiveCallbacks = {
  onEvent: (e: ServerEvent) => void;
  onSessionUpdate?: (updates: Partial<Session>) => void;
  session: RuntimeSession;
  routingDecision?: RunnerOptions["routingDecision"];
  envOverrides?: Record<string, string>;
  stopped: boolean;
  /**
   * Smart Hybrid per-user-turn routing gate state. A decision is made only after an allowed
   * TaskCreate includes an explicit boolean critical flag. It resets on every new user turn.
   */
  hybridRoutingDecisionMade?: boolean;
  hybridRoutingDecisionCritical?: boolean;
  hybridRoutingGateDenials?: number;
  /**
   * The assistant already performed substantive read-only work before can_use_tool exposed
   * a routing decision boundary. Used only to protect the final Write/Edit from a late gate.
   */
  hybridPreDecisionReadObserved?: boolean;
  /** 被假死/静默超时扫描器主动杀死，rl.close 应下发 error 而非 completed */
  staleKilled?: boolean;
  /**
   * ephemeral 路径专用的 resume 失败兜底回调。ephemeral 进程不入 processCache，
   * 现有 tryHandleResumeFailure 的降级路径（依赖 processCache）对其不生效，
   * 故由此回调在「No conversation found」时清空 claudeSessionId 并无 resume 重跑一次。
   */
  onResumeMiss?: () => void;
};

type ProcessEntry = {
  child: ChildProcess;
  callbackRef: ActiveCallbacks;
  fingerprint: SpawnFingerprint;
  /** 空闲超时计时器：result 后启动，下一轮 sendUserMessage 时清除。 */
  idleTimer?: NodeJS.Timeout;
  /**
   * 首次响应超时计时器：sendUserMessage 后启动，收到首个 stdout 输出时清除。
   * 超时未清除 → 判定 CLI 卡死，杀进程并报错。
   */
  noOutputTimer?: NodeJS.Timeout;
  /** 最后一次 stdout 输出的时间戳，用于假死检测。 */
  lastActivity: number;
  /**
   * 本轮是否已开始实际内容输出（content_block_delta / assistant 消息）。
   * 仅用于 error-trace 诊断日志，区分进程是在「首个输出前」还是「输出后」挂的。
   * 首个输出前的卡死由 noOutputTimer 负责；running 期间的断流交给 CLI 自身处理。
   */
  hasStartedOutput: boolean;
  /**
   * 本轮 run 的原始 options，用于 resume 失败时自动降级重试（去掉 resumeSessionId）。
   * 仅在带 resumeSessionId 的进程上设置；重试一次后清空，避免无限重试。
   */
  resumeRetryOptions?: RunnerOptions;
  /**
   * 此进程是否已建立「会话对话上下文」。
   * - prewarm 冷进程：false（spawn 时不带 --resume，且尚未跑过任何一轮，CLI 内部是空会话）。
   * - run() 真正 spawn 起来并跑过一轮的进程：true（CLI 已建立/恢复了上下文）。
   * 用途：复用判定时，若本轮带 resumeSessionId（需要历史），但进程 establishedConversation=false
   * （典型即预热冷进程），则【不可复用】——否则 --resume 被跳过、历史丢失。须销毁重建走真 --resume。
   */
  establishedConversation?: boolean;
  /**
   * 预热进行中标记：prewarm() spawn 后、bundle 解析窗口结束前为 true。
   * 受 enforceLruCap 保护——预热中的进程不被 LRU 淘汰（否则刚 spawn 就被杀，白费）。
   *
   * 关键：CLI 在收到首个 user message 前**不吐任何 stdout**（实测零输出），因此不能
   * 用「首个 stdout」当就绪信号——否则一个预热了却没被使用的进程会永远 prewarmInFlight，
   * 永久受保护、永不启动 idle timer，变成击穿数量上限的泄漏进程。
   * 就绪改由 prewarmTimer（时间近似：bundle 解析窗口）解除，见 PREWARM_READY_MS。
   */
  prewarmInFlight?: boolean;
  /**
   * 预热就绪计时器：prewarm() spawn 后启动，PREWARM_READY_MS 后触发——
   * 此时 30MB bundle 已驻留内存（预热的真实收益），解除 prewarmInFlight 保护并
   * 启动 idle timer，使「预热了但一直没人用」的进程能像普通空闲进程一样被回收，
   * 兼作预热超时兜底（点 #4：避免握手不全 / 上游慢导致的隐形进程堆积）。
   * 被 run() 复用时清除（复用后由正常 idle/no-output 计时器接管）。
   */
  prewarmTimer?: NodeJS.Timeout;
  /**
   * 此进程「当前生效的主模型名」。spawn 时取 routingDecision.modelName 初始化。
   * 复用时若新一轮目标模型 ≠ 此值且属可切模型路径，发 set_model 控制请求切换、并更新此值，
   * 而非重建进程（见 sendSetModel）。Smart Hybrid 的 critical-task 升级也通过同一
   * set_model 控制通道更新此值，但只在 critical 工具的 tool_result 边界切换，避免中途
   * 控制请求扰乱正在执行的工具调用；下一轮路由重新选择默认模型时仍会自然热切回来。
   */
  currentModel?: string;
  /**
   * Smart Hybrid 不能在 TaskCreate/TaskUpdate 仍执行时直接 set_model：实测 OpenAI-compatible
   * 路径会让升级模型的下一次 TaskUpdate 丢可选参数（如 status），形成无效重试循环。
   * 因此先记录 critical tool_use，等对应 tool_result 回到 SDK 流后再切模型。
   */
  pendingHybridUpgrade?: { signal: CriticalTaskSignal; fromModel: string };
  /** 当前 Smart Hybrid 升级的来源模型；有值即表示本轮处于 upgrade model。 */
  hybridEscalationFromModel?: string;
  /** 当前 critical task id。TaskCreate 创建时未知，在升级后的第一次 TaskUpdate 上绑定。 */
  hybridCriticalTaskId?: string;
  /** critical TaskUpdate(completed) 已发出；等它的 tool_result 完成后再安全降回默认模型。 */
  pendingHybridDeescalation?: { toolUseId: string; taskId: string };
  /**
   * runner 在真实 set_model 边界已直接发出的 Smart Hybrid 遥测指纹。
   * CLI 之后可能在 tool_result 里重放同一条 “[Model switched: ...]” breadcrumb；
   * 对完全相同的指纹只吞掉一次，避免升级/降级重复计数。
   */
  hybridDirectTelemetryFingerprints?: Set<string>;
  /**
   * 此进程「当前生效的权限模式」。spawn 时取启动 --permission-mode 初始化。
   * 复用时若新一轮目标模式 ≠ 此值，发 set_permission_mode 控制请求在进程内切换、并更新
   * 此值，而非重建进程（见 sendSetPermissionMode）。与 currentModel 同机制。
   */
  currentMode?: string;
};

/** 空闲超时阈值（chat 会话）：result 到达后若 10 分钟无新输入，则销毁进程释放资源。 */
const IDLE_TIMEOUT_MS = 10 * 60 * 1000;
/** 空闲超时阈值（非 chat 会话）：30 分钟。 */
const IDLE_TIMEOUT_NON_CHAT_MS = 30 * 60 * 1000;
/** 假死检测阈值：进程 30 分钟无任何 stdout 输出视为假死。
 * running 期间的断流（流式中途断网等）交给 CLI 自身的重试/超时机制处理，
 * 上层不再做激进静默检测——避免靠 stdout 侧信道猜测 CLI 内部阶段。 */
const STALE_PROCESS_MS = 30 * 60 * 1000;
/** 假死检测扫描间隔：每 60s 扫描一次。 */
const STALE_CHECK_INTERVAL_MS = 60 * 1000;
/**
 * 首次响应超时：发出 user message 后，若 CLI 在此时间内无任何 stdout 输出，
 * 判定 spawn/resume 失败（如超长会话 resume 后空转），杀进程并报错。
 * 正常进程 spawn+init 握手仅数秒，resume 加载完也会立即产出 system/init 等消息，
 * 故 60s 无任何输出可安全判定为卡死。
 */
const NO_OUTPUT_TIMEOUT_MS = 60 * 1000;

/**
 * 预热就绪窗口：prewarm() spawn 后，等多久判定「bundle 已解析、进程已就绪」。
 *
 * CLI 收到首个 user message 前不吐任何 stdout，没有可观测的 ready 事件，故只能用
 * 时间近似。取实测冷启动 bundle 加载耗时（~4.7s）的一个保守上界。窗口结束后：
 * - 解除 prewarmInFlight（此后该进程可被 LRU 正常回收）；
 * - 启动 idle timer（预热了却没人用的进程不会永生）。
 * 这一刻起，预热进程与「刚 result 完的空闲进程」在回收语义上完全等价。
 */
const PREWARM_READY_MS = 8 * 1000;

/**
 * 热进程池目标大小：processCache 中保留的进程数上限（含 running 与空闲）。
 *
 * 关键：这是**按进程数**卡的，全程只数 Map.size，绝不读取/判断任何进程的内存。
 * 超出目标且存在「空闲」进程时，LRU 回收最久未活跃的空闲进程；running 进程永不被
 * 淘汰（并发活跃会话允许临时超过此值，等它们完成后再缩回）。
 * 可经环境变量 LOCALCLAW_MAX_WARM_PROCESSES 覆盖。默认 3（单人多 tab 够用）。
 */
const MAX_WARM_PROCESSES = (() => {
  const raw = Number(process.env.LOCALCLAW_MAX_WARM_PROCESSES);
  return Number.isInteger(raw) && raw > 0 ? raw : 3;
})();

/** PID 记录文件路径：用于启动时清理孤儿进程。调用时解析，不在 import 期固化。 */
function getPidFilePath(): string {
  return join(getClaudeConfigDir(), "runner-pids.json");
}

/**
 * 决定是否可以复用进程的关键状态。任何字段变化都必须重启进程。
 *
 * 这里只放「spawn 时定死、之后改不了」的参数。注意 resumeSessionId 不在其中：
 * 它只是冷 spawn 时用来 --resume 恢复上下文的参数（见 buildCliArgs），不参与
 * 「能否复用活进程」的判断。turn1 拿到 claudeSessionId 后 turn2 的 resumeSessionId
 * 会从 "" 变为该 id——若纳入指纹会导致 turn2 误判「配置变了」而白白杀掉 turn1 的活
 * 进程重建一次。复用本就安全：被复用的就是上一轮那个活进程，会话上下文在它内存里，
 * 无需 --resume；--resume 只在「无活进程」的冷 spawn（换 cwd/env、进程已死/被回收）
 * 时才需要。
 */
type SpawnFingerprint = {
  cwd: string;
  envHash: string;
  // permissionMode 不在指纹内：CLI 支持运行时 set_permission_mode 控制请求在活进程内
  // 切换权限模式（与 set_model 同机制），故换模式改走热切（见 sendSetPermissionMode /
  // 复用路径），不重建进程。
  /**
   * MCP 配置（.claude.json 的 mcpServers + mcpServersManaged）短哈希。变化 → 进程重建，
   * 使连接器增/改/删后新会话即时加载最新 MCP 工具，无需等 warm 进程回收或手动杀进程。
   * CLI 仅在冷 spawn 时读 .claude.json，故须把它纳入复用判定。
   */
  mcpConfigHash: string;
  /**
   * 停用 skill 名单（<skillsDir>/.disabled.json）的短哈希。停用集变化 → 进程重建，
   * 使新的 Skill(<name>) deny 规则（spawn 时经 --disallowedTools 注入）即时生效。
   * 缺省（无停用）为空串，与历史指纹兼容、不误触发重建。
   */
  disabledSkillsHash: string;
};

/** 把 env 对象转成稳定哈希。用 JSON.stringify 确保特殊字符（换行、=）不会与分隔符冲突。 */
function hashEnv(env: Record<string, string> | undefined): string {
  if (!env) return "";
  const sorted = Object.fromEntries(Object.entries(env).sort(([a], [b]) => a.localeCompare(b)));
  return JSON.stringify(sorted);
}

/**
 * 仅承载「主模型名」的 env 键。这些键变化**不该**触发进程重建——CLI 支持运行时
 * `set_model` 控制请求在活进程内换模型（实测：同一进程 turn1→haiku、set_model 后
 * turn2→sonnet，网关按 body.model 路由，零重启）。故把它们从 fingerprint 的 envHash 里
 * 剔除，换模型改走 set_model（见 sendSetModel / 复用路径）。
 *
 * 注意只含「主模型」键；连接类（BASE_URL/TOKEN/USE_OPENAI）绝不在此列——那些变了
 * 必须重建。
 */
const MODEL_ONLY_ENV_KEYS = [
  "ANTHROPIC_MODEL",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL",
  "OPENAI_MODEL",
  "OPENAI_DEFAULT_HAIKU_MODEL",
] as const;

/**
 * 该 env 是否走「运行时可切模型」路径。
 *
 * 两条协议路径均已验证 set_model 生效,故恒为 true:
 *  - Anthropic 原生(网关 anthropic):set_model 改 mainLoopModel/activeUserSpecifiedModel,
 *    下一轮出站 body.model 即新模型。
 *  - OpenAI 兼容(CLAUDE_CODE_USE_OPENAI=1):出站 model 由 resolveOpenAIModel 读
 *    process.env.OPENAI_MODEL 决定;CLI 的 set_model handler 已 patch 为同步该 env
 *    (print.ts:3152,抄 TaskUpdateTool 的既有做法)。实测:同进程 turn1=model-alpha、
 *    set_model 后 turn2=model-bravo,出站模型随之切换、零重建。
 *
 * 连接类 env(BASE_URL/TOKEN/USE_OPENAI)变化仍触发重建——它们不在 MODEL_ONLY_ENV_KEYS,
 * 改协议/改端点连接信息必须重建,这是正确的。
 */
function isModelSwitchable(env: Record<string, string> | undefined): boolean {
  if (!env) return false;
  return true;
}

/**
 * 计算进入 fingerprint 的 envHash。可切模型路径下（现两条协议路径皆是），剔除「仅模型名」
 * 键——使「同一连接、换模型」不改变 fingerprint，从而复用热进程 + 发 set_model，而非重建。
 * 连接类 env（BASE_URL/TOKEN/USE_OPENAI）不在 MODEL_ONLY_ENV_KEYS，变化仍改变 hash → 重建。
 */
function hashEnvForFingerprint(env: Record<string, string> | undefined): string {
  if (!env) return "";
  if (!isModelSwitchable(env)) return hashEnv(env);
  const stripped: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if ((MODEL_ONLY_ENV_KEYS as readonly string[]).includes(k)) continue;
    stripped[k] = v;
  }
  return hashEnv(stripped);
}

/**
 * 构造 spawn CLI 的环境变量。
 *
 * 隔离：设置 CLAUDE_CONFIG_DIR 指向 localclaw 专属配置目录，使 CLI 完全不读用户全局
 * ~/.claude（那里的 settings.json env 块写死了 ANTHROPIC_BASE_URL，会让 CLI 直连上游、
 * 绕过 localclaw gateway，导致 max_tokens 裁剪 / content 规整等逻辑全部失效）。
 *
 * 双保险：gateway 模式（CLAUDE_CODE_USE_OPENAI=1）下额外清除继承自 process.env 的
 * ANTHROPIC_BASE_URL / ANTHROPIC_AUTH_TOKEN。
 */
function buildSpawnEnv(envOverrides?: Record<string, string>): NodeJS.ProcessEnv {
  const configDir = ensureClaudeConfigDir();
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    CLAUDE_CONFIG_DIR: configDir,
    CLAUDE_CODE_ENTRYPOINT: "sdk-ts",
    CLAUDE_CODE_ENABLE_TASKS: "1",
    ...(getResolvedExecutable().needsElectronFlag ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
    ...envOverrides,
  };
  if (env.CLAUDE_CODE_USE_OPENAI === "1") {
    delete env.ANTHROPIC_BASE_URL;
    delete env.ANTHROPIC_AUTH_TOKEN;
  }
  // Windows git-bash 注入（强依赖兜底）：claude-cli 的 findGitBashPath() 优先采用
  // CLAUDE_CODE_GIT_BASH_PATH 并跳过探测。打包内嵌的最小 bash 集存在则指向它，
  // 同时把其 usr/bin 前插进子进程 PATH，让 bash 内部能找到 coreutils（sed/grep/cat 等）。
  // 注意：不打包 git —— git 由 claude-cli / 本项目 git.service 从用户系统 PATH 解析；
  // 用户未装 git 时工作区功能降级（前端 GitMissingBanner 引导安装），不在此处理。
  // 资产缺失（异常情况）则【不设】，回退让 claude-cli 探测用户已装的 Git for Windows，
  // 都没有时由 claude-cli 自身报带引导的错误（windowsPaths.ts），不在此重复。
  if (process.platform === "win32" && env.CLAUDE_CODE_GIT_BASH_PATH === undefined) {
    const gitBash = resolveBundledGitBash();
    if (gitBash) {
      env.CLAUDE_CODE_GIT_BASH_PATH = gitBash.bash;
      // 追加在系统 PATH 之后：优先用系统 git（若有），bash 内建 coreutils 用我们这份兜底。
      env.PATH = env.PATH ? `${env.PATH};${gitBash.binDir}` : gitBash.binDir;
    }
  }
  // 条件式系统 rg 兜底（保险丝，非默认）：仅当本机平台的 bundled ripgrep 缺失时，
  // 才设 USE_BUILTIN_RIPGREP=0 让 CLI 退到系统 rg。bundled 存在则【不设】，
  // 保持优先使用受控二进制（设了会无条件优先系统 rg，绕过打包的 rg）。
  // 正常打包路径 bundled 齐全，此分支不触发。
  if (!bundledRipgrepExists() && env.USE_BUILTIN_RIPGREP === undefined) {
    env.USE_BUILTIN_RIPGREP = "0";
  }
  return env;
}

/** 构造复用判定指纹。只取 spawn 时不可变的参数（不含 resumeSessionId / permissionMode，理由见 SpawnFingerprint）。 */
export function buildFingerprint(opts: {
  cwd: string;
  envHash: string;
  mcpConfigHash?: string;
  disabledSkillsHash?: string;
}): SpawnFingerprint {
  return {
    cwd: opts.cwd,
    envHash: opts.envHash,
    mcpConfigHash: opts.mcpConfigHash ?? "",
    disabledSkillsHash: opts.disabledSkillsHash ?? "",
  };
}

export function fingerprintsEqual(a: SpawnFingerprint, b: SpawnFingerprint): boolean {
  return (
    a.cwd === b.cwd &&
    a.envHash === b.envHash &&
    a.mcpConfigHash === b.mcpConfigHash &&
    a.disabledSkillsHash === b.disabledSkillsHash
  );
}

/**
 * MCP 配置短哈希（.claude.json 的 mcpServers + mcpServersManaged）。
 * 用 mtime 做缓存键，避免每次 spawn 都读盘解析；mtime 变化才重算。
 * 文件不存在/解析失败 → 返回空串（视为"无 MCP 配置"，与初始态一致）。
 */
let _mcpHashCache: { mtimeMs: number; hash: string } | undefined;
function hashMcpConfig(): string {
  const path = join(getClaudeConfigDir(), ".claude.json");
  try {
    const mtimeMs = statSync(path).mtimeMs;
    if (_mcpHashCache && _mcpHashCache.mtimeMs === mtimeMs) return _mcpHashCache.hash;
    const json = JSON.parse(readFileSync(path, "utf8")) as {
      mcpServers?: unknown;
      mcpServersManaged?: unknown;
    };
    const subset = {
      mcpServers: json.mcpServers ?? {},
      mcpServersManaged: json.mcpServersManaged ?? [],
    };
    const hash = createHash("sha256").update(JSON.stringify(subset)).digest("hex").slice(0, 12);
    _mcpHashCache = { mtimeMs, hash };
    return hash;
  } catch {
    return "";
  }
}

/**
 * @internal RunnerService 背后的 CLI 进程编排管线。直接使用不在公共契约内，随时可能变更。
 */
@Injectable()
export class RunnerSpawnService implements OnModuleInit {
  /** sessionId → 长驻 CLI 进程缓存 */
  private readonly processCache = new Map<string, ProcessEntry>();
  /** sessionId → spawn Promise（防止并发竞态） */
  private readonly spawnLocks = new Map<string, Promise<RunnerHandle>>();
  /** 假死进程定期扫描定时器 */
  private staleCheckTimer?: NodeJS.Timeout;

  constructor(
    @Inject(SmartHybridService) private readonly smartHybrid: SmartHybridService,
    @Inject(TaskSnapshotWatcherService) private readonly taskWatcher: TaskSnapshotWatcherService,
  ) {}

  onModuleInit(): void {
    this.cleanupOrphanProcesses();
    this.startStaleProcessChecker();
  }

  async run(options: RunnerOptions): Promise<RunnerHandle> {
    const sessionId = options.session.id;

    // 防止并发竞态：如果已有 spawn 在进行中，等它完成后重入
    const inFlight = this.spawnLocks.get(sessionId);
    if (inFlight) {
      await inFlight;
      return this.run(options);
    }

    const promise = this.runInternal(options);
    this.spawnLocks.set(sessionId, promise);
    try {
      return await promise;
    } finally {
      this.spawnLocks.delete(sessionId);
    }
  }

  private async runInternal(options: RunnerOptions): Promise<RunnerHandle> {
    const { prompt, session, resumeSessionId, onEvent, onSessionUpdate } = options;
    const sessionId = session.id;
    const cwd = session.cwd ?? DEFAULT_CWD;

    // ── Ephemeral 路径：每次 spawn 独立进程，处理完即销毁。
    // 适用于 channel/IM 场景：彻底避免进程复用导致的会话状态积累。
    if (options.ephemeralProcess) {
      return this.runEphemeral(options, cwd);
    }

    // 计算本次请求的 fingerprint，决定是否可复用缓存进程（permissionMode 不在其中，走热切）
    const fp = buildFingerprint({
      cwd,
      envHash: hashEnvForFingerprint(options.envOverrides),
      mcpConfigHash: hashMcpConfig(),
      disabledSkillsHash: disabledSkillsHash(),
    });

    // ── 复用路径 ──────────────────────────────────────────────
    let cached = this.processCache.get(sessionId);
    // 关键守卫：本轮需要历史（带 resumeSessionId），但缓存进程尚未建立会话上下文
    // （典型为应用重启后的 prewarm 冷进程——spawn 时不带 --resume）。直接复用会跳过
    // --resume 导致历史丢失、新 claudeSessionId 覆盖旧的。故先销毁该进程并视作无缓存，
    // 落到下方冷 spawn 路径走真正的 --resume 恢复历史。
    if (
      cached &&
      !cached.child.killed &&
      resumeSessionId &&
      !cached.establishedConversation &&
      fingerprintsEqual(cached.fingerprint, fp)
    ) {
      logger.warn(
        `[runner-spawn] not reusing prewarm/cold process for resume turn ` +
          `(sessionId=${sessionId} pid=${cached.child.pid} resumeSessionId=${resumeSessionId}) ` +
          `— evicting and cold-spawning with --resume to preserve history`,
      );
      this.killAndEvict(sessionId, cached.child);
      cached = undefined;
    }
    if (cached && !cached.child.killed) {
      if (fingerprintsEqual(cached.fingerprint, fp)) {
        logger.log(
          `[runner-spawn] reusing process pid=${cached.child.pid} sessionId=${sessionId}`,
        );
        // 用新一轮的回调覆盖旧值，processOutput 的 rl 监听器会读到最新引用
        cached.callbackRef.stopped = false;
        cached.callbackRef.session = session;
        // 回合边界：清空上一轮 skill 激活的工具白名单。skill 限制只在「激活到本回合
        // 结束」内有效，新一轮 user message 解除（见 skill-allowlist.ts）。复用进程跨回合
        // 长驻，必须显式清，否则上一轮的限制会泄漏到本轮。
        cached.callbackRef.session.activeSkillAllowedTools = null;
        // 新一轮开始：显式置 running，与 hasStartedOutput 重置同义。否则若新传入的
        // session 对象 status 仍是上一轮的 completed/error，stale checker 不会监控
        // 本轮，假死进程无法被兜底。result 成功/出错时再同步回 completed/error。
        cached.callbackRef.session.status = "running";
        cached.hasStartedOutput = false; // 新一轮重置，noOutputTimer 负责首个输出前的超时
        cached.callbackRef.routingDecision = options.routingDecision;
        cached.callbackRef.envOverrides = options.envOverrides;
        cached.callbackRef.onSessionUpdate = onSessionUpdate;
        cached.callbackRef.onEvent = (e: ServerEvent) => {
          if (cached.callbackRef.stopped) return;
          onEvent(e);
        };
        // 新 user turn 以 routingDecision 的默认模型为基线；清掉上一轮尚未消费的
        // Smart Hybrid 边界状态，避免 pending tool_result 跨回合误触发。
        cached.pendingHybridUpgrade = undefined;
        cached.hybridEscalationFromModel = undefined;
        cached.hybridCriticalTaskId = undefined;
        cached.pendingHybridDeescalation = undefined;
        cached.hybridDirectTelemetryFingerprints = undefined;
        cached.callbackRef.hybridRoutingDecisionMade = false;
        cached.callbackRef.hybridRoutingDecisionCritical = undefined;
        cached.callbackRef.hybridRoutingGateDenials = 0;
        cached.callbackRef.hybridPreDecisionReadObserved = false;
        this.clearIdleTimer(cached);
        // 复用预热中的进程：解除预热态，撤掉就绪计时器（之后由正常 idle/no-output 计时器接管）
        if (cached.prewarmTimer) {
          clearTimeout(cached.prewarmTimer);
          cached.prewarmTimer = undefined;
        }
        cached.prewarmInFlight = false;
        // 复用活进程时 CLI 不会重发 system/init，这里用已知 claudeSessionId 确保监听已开启（幂等）
        if (cached.callbackRef.session.claudeSessionId) {
          this.taskWatcher.start(sessionId, cached.callbackRef.session.claudeSessionId);
        }
        // 运行时换模型：可切模型路径下，若本轮目标模型 ≠ 进程当前模型，发 set_model
        // 在活进程内切换（而非重建）。必须先于 sendUserMessage（背靠背安全，见 sendSetModel）。
        const desiredModel = options.routingDecision?.modelName;
        if (
          desiredModel &&
          isModelSwitchable(options.envOverrides) &&
          cached.currentModel !== desiredModel
        ) {
          logger.log(
            `[runner-spawn] runtime model switch sessionId=${sessionId} ` +
            `${cached.currentModel ?? "?"} → ${desiredModel} (set_model, no respawn)`,
          );
          this.sendSetModel(cached.child, desiredModel);
          cached.currentModel = desiredModel;
        }
        // 运行时换权限模式：本轮目标模式 ≠ 进程当前模式 → 发 set_permission_mode 在活进程内
        // 切换（而非重建）。与 set_model 同序，先于 sendUserMessage 背靠背写入。
        // currentMode 存用户真实模式（供 handler 判断 acceptEdits 策略）；发给 CLI 时映射
        // （acceptEdits→default），否则 CLI 原生 acceptEdits 会自动放行 Bash，绕过我们的检查。
        const desiredMode = options.permissionMode ?? "default";
        if (cached.currentMode !== desiredMode) {
          const cliMode = toCliPermissionMode(
            desiredMode,
            !!options.envOverrides?.CLAUDE_CODE_CRITICAL_MODEL,
          );
          logger.log(
            `[runner-spawn] runtime permission-mode switch sessionId=${sessionId} ` +
            `${cached.currentMode ?? "?"} → ${desiredMode} (CLI=${cliMode}, set_permission_mode, no respawn)`,
          );
          this.sendSetPermissionMode(cached.child, cliMode);
          cached.currentMode = desiredMode;
        }
        this.sendUserMessage(
          cached.child,
          prompt,
          options.attachments,
          options.attachmentContext ?? undefined,
        );
        // 复用进程发消息后同样启动首次响应超时，防止复用到假死进程
        this.startNoOutputTimer(sessionId, cached);
        return { abort: () => this.killAndEvict(sessionId, cached.child) };
      }
      // fingerprint 变化（cwd / env / mcp / skill 任一变化）→ 销毁重建
      // （permissionMode 不在指纹内，走上面的 set_permission_mode 热切）
      logger.log(
        `[runner-spawn] fingerprint changed, restarting process sessionId=${sessionId}`,
      );
      this.killAndEvict(sessionId, cached.child);
    }

    // 清理已死但未清除的条目（Windows 下 taskkill 不会置 child.killed，exit 事件
    // 尚未触发的窗口里条目仍在 Map 中）。走统一入口确保 timer/watcher 一并清掉。
    if (cached) this.evictEntry(sessionId);

    // ── 首次 spawn 路径 ───────────────────────────────────────
    // Smart Hybrid 会话租约对账：
    //   SH 会话 → acquire（幂等，同 session respawn 不重写文件）
    //   切回单模型 → release（清理注入块；SH→单通过 fingerprint 变化触发 respawn，故此处覆盖）
    const isSmartHybridRun = !!options.envOverrides?.CLAUDE_CODE_CRITICAL_MODEL;
    if (isSmartHybridRun) {
      this.smartHybrid.prepareSessionCwd(cwd, sessionId);
    } else {
      this.smartHybrid.releaseIfHeld(sessionId);
    }

    logger.log("[runner-spawn] run() called", { sessionId: session.id, prompt: prompt?.slice(0, 50), cwd });
    const args = this.buildCliArgs({
      cwd,
      resumeSessionId,
      channels: options.channels,
      extraDisallowedTools: options.extraDisallowedTools,
      additionalDirectories: options.attachmentContext
        ? [options.attachmentContext.directory]
        : undefined,
      permissionMode: options.permissionMode,
      forceControlRequests: !!options.envOverrides?.CLAUDE_CODE_CRITICAL_MODEL,
    });

    logger.log(
      `[runner-spawn] starting sessionId=${sessionId} cwd=${cwd} resumeSessionId=${resumeSessionId ?? "none"}`,
    );
    logger.log(`[runner-spawn] CLI_PATH=${CLI_PATH} exists=${existsSync(CLI_PATH)}`);
    logger.log(`[runner-spawn] args=${JSON.stringify(args)}`);

    const callbackRef: ActiveCallbacks = {
      stopped: false,
      session,
      routingDecision: options.routingDecision,
      envOverrides: options.envOverrides,
      hybridRoutingDecisionMade: false,
      hybridRoutingDecisionCritical: undefined,
      hybridRoutingGateDenials: 0,
      hybridPreDecisionReadObserved: false,
      onSessionUpdate,
      onEvent: (e: ServerEvent) => {
        if (callbackRef.stopped) return;
        onEvent(e);
      },
    };

    let child: ChildProcess;
    try {
      child = spawn(getResolvedExecutable().exec, [CLI_PATH, ...args], {
        cwd,
        stdio: ["pipe", "pipe", "pipe"],
        env: buildSpawnEnv(options.envOverrides),
        windowsHide: true,
      });
    } catch (error) {
      callbackRef.onEvent({
        type: "session.status",
        payload: {
          sessionId: session.id,
          status: "error",
          title: session.title,
          error: `Failed to spawn CLI: ${(error as Error).message}`,
        },
      });
      throw error;
    }
    logger.log(`[runner-spawn] spawned pid=${child.pid} cwd=${cwd} cli=${CLI_PATH}`);

    const stderrLines: string[] = [];
    const MAX_STDERR_LINES = 1000;
    if (child.stderr) {
      const rlErr = createInterface({ input: child.stderr });
      rlErr.on("line", (line) => {
        if (stderrLines.length < MAX_STDERR_LINES) {
          stderrLines.push(line);
        }
        logger.error(`[runner-spawn stderr] ${line}`);
      });
    }

    child.on("exit", (code, signal) => {
      logger.log(
        `[runner-spawn] pid=${child.pid} exit code=${code} signal=${signal}`,
        stderrLines,
      );
      for (const l of stderrLines.slice(0, 5)) {
        logger.error(`[runner-spawn stderr early] ${l}`);
      }
      // 进程退出时清除缓存（正常退出 / kill / 崩溃均走此路）
      this.killAndEvict(sessionId, child);
    });

    this.processCache.set(sessionId, {
      child,
      callbackRef,
      fingerprint: fp,
      lastActivity: Date.now(),
      hasStartedOutput: false,
      // 此进程当前主模型，供复用时判断是否需 set_model 切换（见复用路径）
      currentModel: options.routingDecision?.modelName,
      // 此进程当前权限模式（= 启动 --permission-mode 初值），供复用时判断是否需 set_permission_mode 切换
      currentMode: options.permissionMode ?? "default",
      // 带 resume 时记住 options，供 resume 失败自动降级重试
      resumeRetryOptions: resumeSessionId ? options : undefined,
      // run() 真正 spawn（带 prompt，会跑一轮）：CLI 将建立/恢复会话上下文。
      // 标记为 true，使后续续聊可安全复用此进程（区别于无上下文的 prewarm 冷进程）。
      establishedConversation: true,
    });
    // 新增进程后强制收敛热进程池到目标大小（纯计数 + LRU，不读内存）。
    this.enforceLruCap(sessionId);
    this.recordPid(child.pid);
    this.sendUserMessage(
      child,
      prompt,
      options.attachments,
      options.attachmentContext ?? undefined,
    );
    this.processOutput(child, callbackRef);
    // 启动首次响应超时：spawn/resume 后 60s 无任何 stdout 即判定卡死
    const entry = this.processCache.get(sessionId);
    if (entry) this.startNoOutputTimer(sessionId, entry);

    return { abort: () => this.killAndEvict(sessionId, child) };
  }

  /**
   * 预热：为某个会话提前 spawn 一个 CLI 进程并跑到就绪，但**不发送任何 user message**。
   * 目的是把冷启动（~5s 加载 30MB bundle + init）提前到「用户聚焦 tab」时静默完成，
   * 等用户真正发消息时（run() 复用此进程）直接命中热进程。
   *
   * 与 run() 的关键差异：
   * - 不调 sendUserMessage —— 进程 spawn 后停在 system/init 就绪态等待 stdin。
   * - callbackRef.onEvent 为 no-op —— 预热阶段 CLI 的 init 等输出不该推给前端；
   *   run() 复用时会用真实回调覆盖 callbackRef.onEvent / session / onSessionUpdate。
   * - 标记 prewarmInFlight，受 enforceLruCap 保护，spawn→首个 stdout 间不被 LRU 淘汰。
   *
   * 幂等且尽力而为：已有该 session 的缓存进程则直接跳过（不重建、不抢占）；
   * spawn 失败只记日志、不抛错（预热失败只是退化为冷启动，不该打扰用户）。
   */
  prewarm(options: RunnerOptions): void {
    const session = options.session;
    const sessionId = session.id;
    const cwd = session.cwd ?? DEFAULT_CWD;

    // 已有缓存进程（无论是否就绪）→ 跳过。run() 自会判定 fingerprint 决定复用或重建。
    const cached = this.processCache.get(sessionId);
    if (cached && !cached.child.killed) return;
    // 正在 spawn 中（spawnLocks）→ 跳过，避免与 run() 竞态
    if (this.spawnLocks.has(sessionId)) return;

    const fp = buildFingerprint({
      cwd,
      envHash: hashEnvForFingerprint(options.envOverrides),
      mcpConfigHash: hashMcpConfig(),
      disabledSkillsHash: disabledSkillsHash(),
    });

    const isSmartHybridPrewarm = !!options.envOverrides?.CLAUDE_CODE_CRITICAL_MODEL;
    if (isSmartHybridPrewarm) this.smartHybrid.prepareSessionCwd(cwd, sessionId);

    const args = this.buildCliArgs({
      cwd,
      channels: options.channels,
      extraDisallowedTools: options.extraDisallowedTools,
      additionalDirectories: options.attachmentContext ? [options.attachmentContext.directory] : undefined,
      permissionMode: options.permissionMode,
      forceControlRequests: !!options.envOverrides?.CLAUDE_CODE_CRITICAL_MODEL,
    });

    // 预热阶段吞掉所有事件；run() 复用时覆盖为真实回调。
    const callbackRef: ActiveCallbacks = {
      stopped: false,
      session,
      routingDecision: options.routingDecision,
      envOverrides: options.envOverrides,
      hybridRoutingDecisionMade: false,
      hybridRoutingDecisionCritical: undefined,
      hybridRoutingGateDenials: 0,
      hybridPreDecisionReadObserved: false,
      onSessionUpdate: undefined,
      onEvent: () => { /* prewarm: swallow until run() takes over */ },
    };

    let child: ChildProcess;
    try {
      child = spawn(getResolvedExecutable().exec, [CLI_PATH, ...args], {
        cwd,
        stdio: ["pipe", "pipe", "pipe"],
        env: buildSpawnEnv(options.envOverrides),
        windowsHide: true,
      });
    } catch (error) {
      logger.warn(`[runner-spawn] prewarm spawn failed sessionId=${sessionId}: ${(error as Error).message}`);
      // 租约由会话持有，spawn 失败不释放——run() 会在真正需要时 acquire/release
      return;
    }
    logger.log(`[runner-spawn] prewarm spawned pid=${child.pid} sessionId=${sessionId} cwd=${cwd}`);

    if (child.stderr) {
      const rlErr = createInterface({ input: child.stderr });
      rlErr.on("line", (line) => logger.error(`[runner-spawn prewarm stderr] ${line}`));
    }
    child.on("exit", (code, signal) => {
      logger.log(`[runner-spawn] prewarm pid=${child.pid} exit code=${code} signal=${signal}`);
      this.killAndEvict(sessionId, child);
    });

    const entry: ProcessEntry = {
      child,
      callbackRef,
      fingerprint: fp,
      lastActivity: Date.now(),
      hasStartedOutput: false,
      prewarmInFlight: true,
      // 预热进程未带 --resume、尚未跑过任何一轮，CLI 内部是空会话。带 resume 的续聊
      // 不可复用它（见复用守卫），否则历史丢失。
      establishedConversation: false,
      // 预热进程的初始主模型；复用时若用户最终选了别的模型，复用路径发 set_model 切换
      currentModel: options.routingDecision?.modelName,
      // 预热进程的初始权限模式；复用时若用户最终选了别的模式，复用路径发 set_permission_mode 切换
      currentMode: options.permissionMode ?? "default",
    };
    this.processCache.set(sessionId, entry);
    // 就绪窗口：bundle 解析完成后解除保护并启动 idle timer。CLI 在收到 user message
    // 前零 stdout，没有可观测 ready 事件，故用时间近似（见 PREWARM_READY_MS）。
    // 不这样做的话，预热了却没人用的进程会永远 prewarmInFlight → 永久受保护 → 泄漏。
    entry.prewarmTimer = setTimeout(() => {
      const live = this.processCache.get(sessionId);
      if (!live || live.child !== child) return;
      live.prewarmInFlight = false;
      live.prewarmTimer = undefined;
      logger.log(`[runner-spawn] prewarm ready pid=${child.pid} sessionId=${sessionId} (bundle 已驻留)`);
      // 就绪即视为「空闲热进程」：启动 idle timer（没人用则到点回收），并收敛池子
      this.startIdleTimer(sessionId, live);
      this.enforceLruCap(sessionId);
    }, PREWARM_READY_MS);
    this.enforceLruCap(sessionId);
    this.recordPid(child.pid);
    this.processOutput(child, callbackRef);
  }


  private async runEphemeral(options: RunnerOptions, cwd: string): Promise<RunnerHandle> {
    const { prompt, session, onEvent, onSessionUpdate } = options;
    const args = this.buildCliArgs({
      cwd,
      resumeSessionId: options.resumeSessionId,
      channels: options.channels,
      extraDisallowedTools: options.extraDisallowedTools,
      additionalDirectories: options.attachmentContext
        ? [options.attachmentContext.directory]
        : undefined,
      permissionMode: options.permissionMode,
      forceControlRequests: !!options.envOverrides?.CLAUDE_CODE_CRITICAL_MODEL,
    });

    logger.log(`[runner-spawn ephemeral] starting sessionId=${session.id} cwd=${cwd} resumeSessionId=${options.resumeSessionId ?? "none"}`);

    const callbackRef: ActiveCallbacks = {
      stopped: false,
      session,
      routingDecision: options.routingDecision,
      envOverrides: options.envOverrides,
      hybridRoutingDecisionMade: false,
      hybridRoutingDecisionCritical: undefined,
      hybridRoutingGateDenials: 0,
      hybridPreDecisionReadObserved: false,
      onSessionUpdate,
      onEvent: (e: ServerEvent) => {
        if (callbackRef.stopped) return;
        onEvent(e);
      },
    };

    // resume 失败兜底：ephemeral 不入 processCache，tryHandleResumeFailure 的降级
    // 路径对其不生效。这里在带 resumeSessionId 时挂一次性兜底——CLI 报
    // "No conversation found" 时清空失效 claudeSessionId 并以无 resume 重跑一次。
    if (options.resumeSessionId) {
      let retried = false;
      callbackRef.onResumeMiss = () => {
        if (retried) return;
        retried = true;
        callbackRef.stopped = true;
        callbackRef.onSessionUpdate?.({ claudeSessionId: undefined });
        logger.warn(
          `[runner-spawn ephemeral] resume target missing (resumeSessionId=${options.resumeSessionId}), ` +
            `falling back to fresh session sessionId=${session.id}`,
        );
        void this.runEphemeral(
          { ...options, resumeSessionId: undefined, session: { ...session, claudeSessionId: undefined } },
          cwd,
        ).catch((e) => {
          logger.error(`[runner-spawn ephemeral] resume-fallback retry failed:`, e);
          onEvent({
            type: "session.status",
            payload: { sessionId: session.id, status: "error", title: session.title },
          });
        });
      };
    }

    const child = spawn(getResolvedExecutable().exec, [CLI_PATH, ...args], {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: buildSpawnEnv(options.envOverrides),
      windowsHide: true,
    });
    logger.log(`[runner-spawn ephemeral] spawned pid=${child.pid}`);

    if (child.stderr) {
      const rlErr = createInterface({ input: child.stderr });
      rlErr.on("line", (line) => logger.error(`[runner-spawn ephemeral stderr] ${line}`));
    }

    const killChild = () => {
      callbackRef.stopped = true;
      if (child.killed) return;
      if (process.platform === "win32" && child.pid) {
        spawnSync("taskkill", ["/F", "/T", "/PID", String(child.pid)], { stdio: "ignore", shell: false });
      } else {
        child.kill("SIGTERM");
      }
    };

    child.on("exit", (code, signal) => {
      logger.log(`[runner-spawn ephemeral] pid=${child.pid} exit code=${code} signal=${signal}`);
      callbackRef.stopped = true;
    });

    this.sendUserMessage(child, prompt, options.attachments, options.attachmentContext ?? undefined);
    this.processOutput(child, callbackRef);

    return { abort: killChild };
  }

  /**
   * 从缓存移除条目并清理其所有本地资源（timer / watcher / CLAUDE.md 引用）。
   * 不杀进程——纯本地清理。幂等。
   *
   * 这是「移除一个缓存条目」的唯一入口：任何删除 processCache 条目的路径都必须
   * 经过它，否则会漏清 timer（孤儿 idleTimer 会持有旧 entry 闭包到触发为止）。
   * 不要在别处裸调用 processCache.delete()。
   */
  private evictEntry(sessionId: string): void {
    const entry = this.processCache.get(sessionId);
    if (!entry) return;
    entry.callbackRef.stopped = true;
    this.clearIdleTimer(entry);
    this.clearNoOutputTimer(entry);
    if (entry.prewarmTimer) {
      clearTimeout(entry.prewarmTimer);
      entry.prewarmTimer = undefined;
    }
    this.processCache.delete(sessionId);
    // 进程退出：停止任务目录监听，释放 watcher/timer
    this.taskWatcher.stop(sessionId);
    // 注意：CLAUDE.md 注入块的生命周期现在绑定到「会话的 SH 租约」而非进程实例。
    // 进程 evict 不再 release——由 session 删除 / 切回单模型 两个语义事件负责清理。
  }

  /** 杀进程并从缓存中清除（幂等）。 */
  private killAndEvict(sessionId: string, child: ChildProcess): void {
    const entry = this.processCache.get(sessionId);
    if (entry?.child === child) {
      this.evictEntry(sessionId);
    }
    this.removePid(child.pid);
    if (child.killed) return;
    if (process.platform === "win32" && child.pid) {
      try {
        execSync(`taskkill /F /T /PID ${child.pid}`, { stdio: "ignore" });
      } catch { /* ignore */ }
    } else {
      child.kill("SIGTERM");
    }
  }

  /**
   * 把热进程池收敛到目标大小 MAX_WARM_PROCESSES。
   *
   * 设计约束（务必保持）：
   * - **纯计数**：只看 processCache.size 与各条目的 lastActivity，**绝不读取任何进程的
   *   内存**（无 process.memoryUsage / RSS / working set）。内存变大是真实需求，不干预。
   * - **只淘汰空闲进程**：running（正在生成回复）与 prewarmInFlight（预热 spawn 进行中）
   *   的进程永不被淘汰——否则会中断用户回复或白费刚起的预热。
   * - **允许临时超过 N**：若超限但无空闲可淘汰（全在 running），不杀活进程，让 size 暂时
   *   鼓出 N；待它们 completed/error 后的下一次 set/超时再缩回。
   *
   * @param keepSessionId 本次刚写入的 session，永不在本轮被淘汰（它就是触发收敛的那个）。
   */
  private enforceLruCap(keepSessionId: string): void {
    if (this.processCache.size <= MAX_WARM_PROCESSES) return;

    // 候选 = 空闲（非 running、非 prewarmInFlight）且非本轮新增者。
    // 排序（淘汰优先级）：error 进程先于 completed（error 进程不健康，优先释放），
    // 同类内按 lastActivity 升序（最久未活跃先淘汰，即标准 LRU）。
    const evictable = [...this.processCache.entries()]
      .filter(([sid, e]) =>
        sid !== keepSessionId &&
        !e.prewarmInFlight &&
        e.callbackRef.session.status !== "running")
      .sort((a, b) => {
        const aErr = a[1].callbackRef.session.status === "error" ? 0 : 1;
        const bErr = b[1].callbackRef.session.status === "error" ? 0 : 1;
        if (aErr !== bErr) return aErr - bErr; // error(0) 排在前，先淘汰
        return a[1].lastActivity - b[1].lastActivity;
      });

    let overflow = this.processCache.size - MAX_WARM_PROCESSES;
    for (const [sid, entry] of evictable) {
      if (overflow <= 0) break;
      logger.log(
        `[runner-spawn] LRU cap (${MAX_WARM_PROCESSES}), evicting idle pid=${entry.child.pid} sessionId=${sid} ` +
        `idleFor=${Math.round((Date.now() - entry.lastActivity) / 1000)}s`,
      );
      this.killAndEvict(sid, entry.child);
      overflow--;
    }
    // overflow 仍 > 0 说明剩下的都是 running/prewarming —— 有意保留，允许临时超过 N。
  }

  /** 启动空闲超时计时器：触发后销毁进程释放资源。chat 会话 10min，非 chat 30min。 */
  private startIdleTimer(sessionId: string, entry: ProcessEntry): void {
    this.clearIdleTimer(entry);
    const timeout =
      entry.callbackRef.session.kind === "chat"
        ? IDLE_TIMEOUT_MS
        : IDLE_TIMEOUT_NON_CHAT_MS;
    entry.idleTimer = setTimeout(() => {
      logger.log(
        `[runner-spawn] idle timeout (${timeout}ms), evicting pid=${entry.child.pid} sessionId=${sessionId}`,
      );
      this.killAndEvict(sessionId, entry.child);
    }, timeout);
  }

  /** 清除空闲计时器（幂等）。 */
  private clearIdleTimer(entry: ProcessEntry): void {
    if (entry.idleTimer) {
      clearTimeout(entry.idleTimer);
      entry.idleTimer = undefined;
    }
  }

  /**
   * 启动首次响应超时：NO_OUTPUT_TIMEOUT_MS 内未收到任何 stdout 输出，
   * 判定 CLI 卡死（如超长会话 resume 后空转），杀进程并向前端报错。
   */
  private startNoOutputTimer(sessionId: string, entry: ProcessEntry): void {
    this.clearNoOutputTimer(entry);
    entry.noOutputTimer = setTimeout(() => {
      logger.warn(
        `[runner-spawn] no-output timeout (${NO_OUTPUT_TIMEOUT_MS}ms), CLI stuck after spawn/resume ` +
          `pid=${entry.child.pid} sessionId=${sessionId}`,
      );
      const session = entry.callbackRef.session;
      const errorMsg =
        "会话恢复失败：模型长时间无响应（可能因会话过长导致恢复异常）。建议新建会话重试。";
      // session.status=error 让前端停止「思考中」；runner.error 弹出错误说明
      entry.callbackRef.onEvent({
        type: "session.status",
        payload: {
          sessionId,
          status: "error",
          title: session.title,
          error: errorMsg,
        },
      });
      entry.callbackRef.onEvent({
        type: "runner.error",
        payload: { sessionId, message: errorMsg },
      });
      this.killAndEvict(sessionId, entry.child);
    }, NO_OUTPUT_TIMEOUT_MS);
    if (entry.noOutputTimer.unref) entry.noOutputTimer.unref();
  }

  /** 清除首次响应超时计时器（幂等）。 */
  private clearNoOutputTimer(entry: ProcessEntry): void {
    if (entry.noOutputTimer) {
      clearTimeout(entry.noOutputTimer);
      entry.noOutputTimer = undefined;
    }
  }

  private buildCliArgs(opts: {
    cwd: string;
    resumeSessionId?: string;
    channels?: string[];
    extraDisallowedTools?: string[];
    additionalDirectories?: string[];
    permissionMode?: string;
    forceControlRequests?: boolean;
  }): string[] {
    // permissionMode 白名单校验：非法值 fallback "default"，避免 CLI commander .choices() 报错退出。
    // 默认 "default"（Ask 逐次询问），不再写死 bypassPermissions——由会话级 mode 控制。
    const VALID_MODES = ["plan", "default", "acceptEdits", "bypassPermissions"];
    const userMode = VALID_MODES.includes(opts.permissionMode ?? "")
      ? (opts.permissionMode as string)
      : "default";

    const args = [
      "--output-format",
      "stream-json",
      "--input-format",
      "stream-json",
      "--verbose",
      "--permission-prompt-tool",
      "stdio",
      "--permission-mode",
      toCliPermissionMode(userMode, opts.forceControlRequests === true),
      "--include-partial-messages",
      // ⚠️ 勿加 --replay-user-messages：它会让 CLI 在 resume 时给**真实历史 user 消息**
      // 打 isReplay:true。processOutput 的 isCliReplayNoise 过滤当前依赖「isReplay 只可能是
      // 模型切换面包屑」这一前提（靠不传此 flag 保证）。若确需开启，必须同步收紧
      // isCliReplayNoise（已用 content tag 兜底，但请复核）否则历史展示行为会变。
    ];
    if (opts.resumeSessionId) args.push("--resume", opts.resumeSessionId);
    const disallowed = [
      "CronCreate",
      "CronDelete",
      "CronList",
      ...(opts.extraDisallowedTools ?? []),
      // 停用的 skill → Skill(<name>) deny 规则。CLI 权限主流程中 deny 规则最先检查、
      // 命中即拒绝（先于 bypassPermissions 短路），对纯 prompt 类型 skill 同样生效。
      ...disabledSkillDenyRules(),
    ];
    args.push("--disallowedTools", ...disallowed);

    for (const dir of opts.additionalDirectories ?? [])
      args.push("--add-dir", dir);
    if (opts.channels?.length) args.push("--channels", ...opts.channels);
    return args;
  }

  private writeStdin(child: ChildProcess, data: unknown): void {
    if (child.stdin && !child.killed) {
      child.stdin.write(JSON.stringify(data) + "\n");
    }
  }

  /**
   * 向活进程发 set_model 控制请求，在进程内切换主模型（无需重建）。
   * CLI 的 structured-IO 路径里 onSetModel 是同步赋值（activeUserSpecifiedModel = resolved），
   * CLI 按行读 stdin，故本请求与紧随其后的 user message 背靠背写入即安全——下一条消息
   * 构造请求体时已用新模型。不等 control_response ACK（实测顺序写入即生效）。
   */
  private sendSetModel(child: ChildProcess, model: string): void {
    this.writeStdin(child, {
      type: "control_request",
      request_id: crypto.randomUUID(),
      request: { subtype: "set_model", model },
    });
  }

  /**
   * 向活进程发 set_permission_mode 控制请求，在进程内切换权限模式（无需重建）。
   * 与 sendSetModel 同机制：CLI 按行读 stdin，本请求与紧随其后的 user message 背靠背写入
   * 即安全——下一轮工具决策时已用新模式。不等 control_response ACK。
   */
  private sendSetPermissionMode(child: ChildProcess, mode: string): void {
    this.writeStdin(child, {
      type: "control_request",
      request_id: crypto.randomUUID(),
      request: { subtype: "set_permission_mode", mode },
    });
  }

  private sendUserMessage(
    child: ChildProcess,
    prompt: string,
    attachments?: Attachment[],
    attachmentContext?: RunnerOptions["attachmentContext"],
  ): void {
    const fullPrompt = buildPromptWithAttachments(
      prompt,
      attachments,
      attachmentContext ?? undefined,
    );
    const content: unknown[] = [{ type: "text", text: fullPrompt }];
    if (attachments?.length) {
      for (const att of attachments) {
        if (att.mimeType.startsWith("image/")) {
          content.push({
            type: "image",
            source: {
              type: "base64",
              media_type: att.mimeType as any,
              data: att.base64,
            },
          });
        }
      }
    }
    this.writeStdin(child, {
      type: "user",
      session_id: "",
      message: { role: "user", content },
      parent_tool_use_id: null,
    });
  }

  private handleControlRequest(
    child: ChildProcess,
    msg: ControlRequest,
    callbackRef: ActiveCallbacks,
  ): void {
    const session = callbackRef.session;
    const onEvent = callbackRef.onEvent;
    const req = msg.request;
    const requestId = msg.request_id;

    if (req.subtype === "initialize") {
      this.writeStdin(child, {
        type: "control_response",
        response: { subtype: "success", request_id: requestId, response: {} },
      });
      return;
    }

    if (req.subtype === "can_use_tool") {
      const toolName = req.tool_name as string;
      const input = req.input as unknown;
      const toolUseId = (req.tool_use_id as string) || crypto.randomUUID();

      // Skill 激活：模型调用内置 Skill 工具时，解析其 allowed-tools 白名单并缓存到
      // 会话运行时态，对本回合后续工具调用门控。Skill 工具本身始终放行（元工具）。
      // input.skill 为 skill 目录名（见 CLI extractSkillName）。白名单为 null=不约束。
      if (toolName === "Skill") {
        const skillName =
          typeof input === "object" && input !== null && "skill" in input
            ? String((input as Record<string, unknown>).skill ?? "")
            : "";
        // 停用门控：技能被用户停用 → 拒绝激活并回传明确提示。模型会将提示转述给用户。
        if (skillName && isSkillDisabled(skillName)) {
          logger.warn(
            `[skill-disabled] denied activation of disabled skill="${skillName}" ` +
              `sessionId=${session.id}`,
          );
          this.writeStdin(child, {
            type: "control_response",
            response: {
              subtype: "success",
              request_id: requestId,
              response: {
                behavior: "deny",
                message:
                  `技能「${skillName}」已被停用，无法使用。` +
                  `如需使用，请先在技能管理中重新启用该技能。`,
              },
            },
          });
          return;
        }
        if (skillName) {
          session.activeSkillAllowedTools = resolveSkillAllowlist(skillName);
          if (session.activeSkillAllowedTools) {
            logger.log(
              `[skill-allowlist] skill="${skillName}" restricts tools to: ` +
                session.activeSkillAllowedTools.join(", "),
            );
          }
        }
      }

      // 白名单门控：激活了带限制的 skill 且当前工具不在白名单内（且非元工具）→ deny。
      if (
        toolName !== "Skill" &&
        !isToolAllowedBySkill(session.activeSkillAllowedTools, toolName)
      ) {
        const allowed = (session.activeSkillAllowedTools ?? []).join(", ");
        logger.warn(
          `[skill-allowlist] denied tool="${toolName}" sessionId=${session.id} ` +
            `(skill allows only: ${allowed})`,
        );
        this.writeStdin(child, {
          type: "control_response",
          response: {
            subtype: "success",
            request_id: requestId,
            response: {
              behavior: "deny",
              message: `当前 Skill 仅允许使用以下工具：${allowed}。`,
            },
          },
        });
        return;
      }

      // Smart Hybrid protocol gate: Qwen must make an explicit critical true/false
      // decision before the first substantive tool of this user turn. This is deliberately
      // enforced at can_use_tool rather than only via CLAUDE.md so normal benchmark prompts
      // cannot silently bypass routing by going straight to WebSearch/WebFetch/Write/etc.
      //
      // The runner does NOT decide criticality. It only verifies that TaskCreate carries an
      // explicit boolean decision. TaskCreate/TaskUpdate/TaskList/etc. remain available before
      // the decision so the model can establish task state without a protocol deadlock.
      const criticalModel = callbackRef.envOverrides?.CLAUDE_CODE_CRITICAL_MODEL;
      const activeModel =
        this.processCache.get(session.id)?.currentModel ??
        callbackRef.routingDecision?.modelName;
      const isCriticalModelActive =
        !!criticalModel && activeModel === criticalModel;

      // The gate only forces the DEFAULT model to declare critical=true|false.
      // Once the live process has upgraded to Kimi, never gate Kimi (or its delegated work).
      if (
        criticalModel &&
        !isCriticalModelActive &&
        !callbackRef.hybridRoutingDecisionMade
      ) {
        if (toolName === "TaskCreate") {
          const critical = readHybridRoutingDecision(toolName, input);
          if (critical === undefined) {
            callbackRef.hybridRoutingGateDenials =
              (callbackRef.hybridRoutingGateDenials ?? 0) + 1;
            logger.warn(
              `[runner-spawn] smart-hybrid routing gate denied TaskCreate without boolean critical ` +
                `sessionId=${session.id} toolUseId=${toolUseId}`,
            );
            this.writeStdin(child, {
              type: "control_response",
              response: {
                subtype: "success",
                request_id: requestId,
                response: {
                  behavior: "deny",
                  message:
                    "Smart Hybrid routing decision required: retry TaskCreate and include an " +
                    "explicit boolean `critical: true` or `critical: false`. You decide which " +
                    "value is correct from the work itself; do not infer it from benchmark names " +
                    "or task categories.",
                },
              },
            });
            return;
          }
          callbackRef.hybridRoutingDecisionMade = true;
          callbackRef.hybridRoutingDecisionCritical = critical;
          logger.log(
            `[runner-spawn] smart-hybrid routing decision sessionId=${session.id} ` +
              `critical=${critical} toolUseId=${toolUseId}`,
          );
        } else if (!isHybridRoutingMetaTool(toolName)) {
          const protectLateDelivery =
            callbackRef.hybridPreDecisionReadObserved === true &&
            HYBRID_LATE_DELIVERY_TOOLS.has(toolName);

          if (protectLateDelivery) {
            logger.warn(
              `[runner-spawn] smart-hybrid late-delivery safeguard allowing tool="${toolName}" ` +
                `sessionId=${session.id} toolUseId=${toolUseId}; ` +
                `read-only substantive work was already observed before routing decision`,
            );
            // Fall through to the normal permission policy. This is deliberately narrow:
            // first-action Write/Edit is still denied; only a final delivery after observed
            // Read/Grep/Glob work is protected from being destroyed by a late routing gate.
          } else {
            callbackRef.hybridRoutingGateDenials =
              (callbackRef.hybridRoutingGateDenials ?? 0) + 1;
            logger.warn(
              `[runner-spawn] smart-hybrid routing gate denied substantive tool="${toolName}" ` +
                `before decision sessionId=${session.id} toolUseId=${toolUseId} ` +
                `denial=${callbackRef.hybridRoutingGateDenials}`,
            );
            this.writeStdin(child, {
              type: "control_response",
              response: {
                subtype: "success",
                request_id: requestId,
                response: {
                  behavior: "deny",
                  message:
                    `Smart Hybrid routing decision required before ${toolName}. ` +
                    "First call TaskCreate for the top-level work and include exactly one explicit " +
                    "boolean `critical: true` or `critical: false`. Choose the value yourself based " +
                    "on whether success depends on judgment/ambiguity/tradeoffs versus straightforward " +
                    "execution. After TaskCreate succeeds, retry this tool.",
                },
              },
            });
            return;
          }
        }
      }

      // 需要用户确认的工具：
      //  1. AskUserQuestion（问答）+ ExitPlanMode（提交计划）—— 任何模式都要用户决策。
      //  2. default 权限模式下命中 CONFIRM_TOOLS_DEFAULT 的写类工具 —— 弹确认卡片。
      // 会话级放行（sessionAllowedTools，用户选过「本次会话不再询问」）直接 auto-allow。
      const curMode =
        this.processCache.get(session.id)?.currentMode ?? "default";

      // plan 模式：拦截写类/副作用工具（CLI 原生 plan 保护被 flag 绕过，故在此自实现）。
      // deny 并提示模型先调 ExitPlanMode 提交计划，待批准后再执行。读类工具不在集合内 → 放行。
      if (isPlanForbiddenTool(curMode, toolName)) {
        logger.log(
          `[runner-spawn] plan-mode deny tool="${toolName}" sessionId=${session.id} ` +
            `(must ExitPlanMode first)`,
        );
        this.writeStdin(child, {
          type: "control_response",
          response: {
            subtype: "success",
            request_id: requestId,
            response: {
              behavior: "deny",
              message:
                `当前处于计划模式（Plan Mode），不能直接执行 ${toolName} 等修改类操作。` +
                `请先用 ExitPlanMode 工具提交你的实施计划，等用户批准退出计划模式后再执行。`,
            },
          },
        });
        return;
      }

      const alreadyAllowed = session.sessionAllowedTools?.has(toolName) ?? false;

      // acceptEdits 模式下 Bash 高危命令检查（这是与 bypassPermissions 的唯一差异）
      const bashCmd = toolName === "Bash" ? (input as any)?.command ?? "" : "";
      const isDangerous = bashCmd ? matchesDangerousCommand(bashCmd) : false;
      const isAcceptEditsDangerousBash =
        curMode === "acceptEdits" &&
        toolName === "Bash" &&
        isDangerous;

      // acceptEdits 模式的自动放行逻辑：除了危险 Bash 外，所有工具自动放行（包括
      // CONFIRM_TOOLS_DEFAULT 里的 Write/Edit 等）。这是我们自己实现的 acceptEdits 语义，
      // 因为 CLI 原生 acceptEdits 不调我们的 handler（导致危险命令检查失效）。
      const shouldAutoAllowInAcceptEdits =
        curMode === "acceptEdits" &&
        !isAcceptEditsDangerousBash &&
        toolName !== "AskUserQuestion" &&
        toolName !== "ExitPlanMode" &&
        toolName !== "exit_plan_mode";

      if (shouldAutoAllowInAcceptEdits) {
        this.writeStdin(child, {
          type: "control_response",
          response: {
            subtype: "success",
            request_id: requestId,
            response: { behavior: "allow", updatedInput: input },
          },
        });
        return;
      }

      const needsUserDecision =
        !alreadyAllowed &&
        (toolName === "AskUserQuestion" ||
          toolName === "ExitPlanMode" ||
          toolName === "exit_plan_mode" ||
          (curMode === "default" && CONFIRM_TOOLS_DEFAULT.has(toolName)) ||
          isAcceptEditsDangerousBash);

      if (needsUserDecision) {
        const isExitPlan =
          toolName === "ExitPlanMode" || toolName === "exit_plan_mode";
        onEvent({
          type: "permission.request",
          payload: { sessionId: session.id, toolUseId, toolName, input },
        });
        session.pendingPermissions.set(toolUseId, {
          toolUseId,
          toolName,
          input,
          resolve: (result) => {
            session.pendingPermissions.delete(toolUseId);
            // ExitPlanMode 被批准 → 退出计划模式。headless 下 CLI 不会自动切我们的
            // currentMode，须在此把进程权限模式切到 default（解除 plan 写拦截，后续写类
            // 工具走确认卡片）。否则批准后 Write/Bash 仍被 isPlanForbiddenTool 拦（见 14.png）。
            if (isExitPlan && result.behavior === "allow") {
              const entry = this.processCache.get(session.id);
              if (entry && entry.currentMode === "plan") {
                logger.log(
                  `[runner-spawn] ExitPlanMode approved → switch plan→default ` +
                    `sessionId=${session.id} (set_permission_mode)`,
                );
                this.sendSetPermissionMode(child, "default");
                entry.currentMode = "default";
              }
            }
            this.writeStdin(child, {
              type: "control_response",
              response: {
                subtype: "success",
                request_id: requestId,
                response: result,
              },
            });
          },
        });
        return;
      }

      this.writeStdin(child, {
        type: "control_response",
        response: {
          subtype: "success",
          request_id: requestId,
          response: { behavior: "allow", updatedInput: input },
        },
      });
      return;
    }

    this.writeStdin(child, {
      type: "control_response",
      response: { subtype: "success", request_id: requestId, response: {} },
    });
  }

  /**
   * 注册 stdout 监听器。每次 spawn 只调用一次；
   * 进程复用时通过更新 callbackRef 属性来切换回调。
   */
  private processOutput(child: ChildProcess, callbackRef: ActiveCallbacks): void {
    if (!child.stdout) return;
    const rl = createInterface({ input: child.stdout });

    rl.on("line", (line) => {
      if (!line.trim()) return;
      // 任何 stdout 行都视为活跃信号，刷新假死检测时间戳
      const liveEntry = this.processCache.get(callbackRef.session.id);
      if (liveEntry && liveEntry.child === child) {
        liveEntry.lastActivity = Date.now();
        // 收到首个输出 → CLI 正常存活，取消首次响应超时
        this.clearNoOutputTimer(liveEntry);
        // 预热进程意外提前吐输出（正常情况下 prewarmTimer 会先触发就绪）→ 视为就绪，
        // 解除保护、撤掉就绪计时器、启动 idle timer，回收语义与计时器路径一致。
        if (liveEntry.prewarmInFlight) {
          liveEntry.prewarmInFlight = false;
          if (liveEntry.prewarmTimer) {
            clearTimeout(liveEntry.prewarmTimer);
            liveEntry.prewarmTimer = undefined;
          }
          this.startIdleTimer(callbackRef.session.id, liveEntry);
        }
      }
      // stopped 检查：abort 后进程在真正退出前可能还有残留输出
      if (callbackRef.stopped) return;

      let msg: StdoutMessage;
      try {
        msg = JSON.parse(line) as StdoutMessage;
      } catch {
        logger.warn(`[runner-spawn stdout non-json] ${line.slice(0, 200)}`);
        return;
      }

      // Trace every SDK message type to debug silent / no-reply cases.
      // debug 级别：默认（log）不输出，避免刷屏；需要时设 LENOVO_SDK_LOG_LEVEL=debug 打开。
      const subtype = (msg as any).subtype ? `/${(msg as any).subtype}` : "";
      logger.debug(`[runner-spawn trace pid=${child.pid}] msg type=${msg.type}${subtype} preview=${line.slice(0, 2000)}`);

      if (msg.type === "keep_alive" || msg.type === "control_response") return;
      if (msg.type === "control_request") {
        this.handleControlRequest(
          child,
          msg as ControlRequest,
          callbackRef,
        );
        return;
      }

      const sdkMsg = msg as SDKMessage;

      // CLI 回放噪声（当前唯一来源：set_model 实时注入的模型切换面包屑
      // <local-command-stdout>Set model to …</local-command-stdout>）：在广播前丢弃。
      // 这里是「CLI 协议流 → 我们事件」的适配边界，丢在此处可一处同时挡住下游的
      // recordMessage(落库) 与 emit(广播)（见 runner-host.buildOnEvent）。判别合取
      // isReplay + tag，详见 isCliReplayNoise；⚠️ 与 buildCliArgs 不传
      // --replay-user-messages 这一不变式耦合（那里有反向提示）。
      if (isCliReplayNoise(sdkMsg)) return;

      // CLI 内置的 API 重连进度（无网络/上游波动时 CLI 自动指数退避重试，max_retries 默认 10）。
      // 不写入消息流（避免污染历史），转成 session.retry 事件供前端显示「重连中 N/10」。
      if (
        sdkMsg.type === "system" &&
        "subtype" in sdkMsg &&
        (sdkMsg as any).subtype === "api_retry"
      ) {
        const r = sdkMsg as any;
        callbackRef.onEvent({
          type: "session.retry",
          payload: {
            sessionId: callbackRef.session.id,
            attempt: Number(r.attempt) || 0,
            maxRetries: Number(r.max_retries) || 0,
            delayMs: typeof r.retry_delay_ms === "number" ? r.retry_delay_ms : undefined,
          },
        });
        return;
      }

      if (
        sdkMsg.type === "system" &&
        "subtype" in sdkMsg &&
        sdkMsg.subtype === "init"
      ) {
        const initMsg = sdkMsg as Record<string, unknown>;
        const sid = initMsg.session_id as string | undefined;
        if (sid) {
          callbackRef.session.claudeSessionId = sid;
          callbackRef.onSessionUpdate?.({ claudeSessionId: sid });
          // 拿到 claudeSessionId 后即开始监听任务目录（早于任何任务创建）
          this.taskWatcher.start(callbackRef.session.id, sid);
        }
        const realModel = initMsg.model as string | undefined;
        if (realModel) {
          const routingDecision = callbackRef.routingDecision;
          // 确定显示的模型名：OpenAI-compatible 路径（OpenRouter 等）或无路由决策时
          // 保留路由决策的名字；纯 Anthropic 云端用 CLI 返回的 model（更精确，含版本号）
          const useOpenAICompatible = callbackRef.envOverrides?.CLAUDE_CODE_USE_OPENAI === "1";
          const noDecision = routingDecision == null;
          const modelName = noDecision || useOpenAICompatible
            ? (routingDecision?.modelName ?? realModel ?? "")
            : realModel ?? "";
          callbackRef.onEvent({
            type: "routing.decision",
            payload: {
              sessionId: callbackRef.session.id,
              decision: {
                target: (routingDecision?.target ?? "cloud") as "cloud",
                modelName,
                provider: (routingDecision?.provider ?? "firstParty") as "firstParty" | "openai" | "openrouter" | "anthropic",
                reason: routingDecision?.reason ?? "",
                confidence: routingDecision?.confidence ?? 1,
              },
            },
          });
        }
      }

      callbackRef.onEvent({
        type: "stream.message",
        payload: { sessionId: callbackRef.session.id, message: sdkMsg },
      });

      // Synchronize the V4 gate from the REAL assistant TaskCreate tool_use.
      // Real TaskCreate calls may skip can_use_tool, so the permission callback alone is not
      // authoritative enough to unlock the per-turn routing gate.
      const assistantRoutingDecision = readAssistantHybridRoutingDecision(sdkMsg);
      if (assistantRoutingDecision !== undefined) {
        callbackRef.hybridRoutingDecisionMade = true;
        callbackRef.hybridRoutingDecisionCritical = assistantRoutingDecision;
        logger.log(
          `[runner-spawn] smart-hybrid routing decision observed from assistant ` +
            `sessionId=${callbackRef.session.id} critical=${assistantRoutingDecision}`,
        );
      } else if (
        !callbackRef.hybridRoutingDecisionMade &&
        assistantObservedPreDecisionRead(sdkMsg)
      ) {
        callbackRef.hybridPreDecisionReadObserved = true;
        logger.log(
          `[runner-spawn] smart-hybrid pre-decision read observed ` +
            `sessionId=${callbackRef.session.id}`,
        );
      }

      // Smart Hybrid 安全切换桥（两阶段）：
      // 1) default model 用 TaskCreate/TaskUpdate(critical:true) 自主声明 critical；这里只记 pending。
      // 2) 等同一个 tool_use 的 tool_result 已从 CLI 回到 SDK 流，才发 set_model。
      //
      // 为什么不能在 assistant tool_use 到达时立即切：CLI 此时仍在执行该工具。实测在
      // OpenAI-compatible 热切 Qwen→Kimi 后，下一次 TaskUpdate 会反复只剩 {taskId}，
      // status 等参数丢失；固定 Qwen/Kimi 均正常。把控制请求移到 tool_result 边界后，
      // 不再把模型切换插进活跃工具调用中。整个判断仍只依赖模型显式 critical 标记，
      // 不看 benchmark task id / prompt / category。
      const hybridEntry = this.processCache.get(callbackRef.session.id);
      if (hybridEntry && hybridEntry.child === child) {
        const pendingUpgrade = hybridEntry.pendingHybridUpgrade;
        if (
          pendingUpgrade &&
          this.smartHybrid.hasToolResultFor(sdkMsg, pendingUpgrade.signal.toolUseId)
        ) {
          const { signal, fromModel } = pendingUpgrade;
          hybridEntry.pendingHybridUpgrade = undefined;
          if (
            isModelSwitchable(callbackRef.envOverrides) &&
            hybridEntry.currentModel !== signal.model
          ) {
            logger.log(
              `[runner-spawn] smart-hybrid critical switch sessionId=${callbackRef.session.id} ` +
                `${fromModel} → ${signal.model} after tool_result ` +
                `(tool=${signal.toolName} task=${signal.taskId ?? "(new)"} toolUseId=${signal.toolUseId})`,
            );
            this.sendSetModel(child, signal.model);
            hybridEntry.currentModel = signal.model;
            hybridEntry.hybridEscalationFromModel = fromModel;
            hybridEntry.hybridCriticalTaskId = signal.taskId;
            (hybridEntry.hybridDirectTelemetryFingerprints ??= new Set()).add(
              `true\u0000${fromModel}\u0000${signal.model}`,
            );
            callbackRef.onEvent({
              type: "escalation.status",
              payload: {
                sessionId: callbackRef.session.id,
                active: true,
                model: signal.model,
                from: fromModel,
              },
            } as ServerEvent);
          }
        }

        const pendingDeescalation = hybridEntry.pendingHybridDeescalation;
        if (
          pendingDeescalation &&
          this.smartHybrid.hasToolResultFor(sdkMsg, pendingDeescalation.toolUseId)
        ) {
          hybridEntry.pendingHybridDeescalation = undefined;
          const defaultModel =
            callbackRef.routingDecision?.modelName ??
            callbackRef.envOverrides?.OPENAI_MODEL ??
            callbackRef.envOverrides?.ANTHROPIC_MODEL;
          const fromModel = hybridEntry.currentModel ?? "(unknown)";
          if (
            defaultModel &&
            isModelSwitchable(callbackRef.envOverrides) &&
            hybridEntry.currentModel !== defaultModel
          ) {
            logger.log(
              `[runner-spawn] smart-hybrid critical complete sessionId=${callbackRef.session.id} ` +
                `${fromModel} → ${defaultModel} after tool_result ` +
                `(task=${pendingDeescalation.taskId} toolUseId=${pendingDeescalation.toolUseId})`,
            );
            this.sendSetModel(child, defaultModel);
            hybridEntry.currentModel = defaultModel;
            (hybridEntry.hybridDirectTelemetryFingerprints ??= new Set()).add(
              `false\u0000${fromModel}\u0000${defaultModel}`,
            );
            callbackRef.onEvent({
              type: "escalation.status",
              payload: {
                sessionId: callbackRef.session.id,
                active: false,
                model: defaultModel,
                from: fromModel,
              },
            } as ServerEvent);
          }
          hybridEntry.hybridEscalationFromModel = undefined;
          hybridEntry.hybridCriticalTaskId = undefined;
        }

        const criticalSignal = this.smartHybrid.detectCriticalTaskSignal(
          sdkMsg,
          callbackRef.envOverrides ?? {},
        );
        if (
          criticalSignal &&
          !hybridEntry.hybridEscalationFromModel &&
          !hybridEntry.pendingHybridUpgrade &&
          isModelSwitchable(callbackRef.envOverrides) &&
          hybridEntry.currentModel !== criticalSignal.model
        ) {
          const fromModel =
            hybridEntry.currentModel ?? callbackRef.routingDecision?.modelName ?? "(unknown)";
          hybridEntry.pendingHybridUpgrade = { signal: criticalSignal, fromModel };
          logger.log(
            `[runner-spawn] smart-hybrid critical pending sessionId=${callbackRef.session.id} ` +
              `${fromModel} → ${criticalSignal.model} waiting tool_result ` +
              `(tool=${criticalSignal.toolName} task=${criticalSignal.taskId ?? "(new)"} ` +
              `toolUseId=${criticalSignal.toolUseId})`,
          );
        }

        if (hybridEntry.hybridEscalationFromModel) {
          const updateSignal = this.smartHybrid.detectTaskUpdateSignal(sdkMsg);
          if (updateSignal) {
            // TaskCreate 的返回 id 不在原始 tool_use 参数里；升级后模型开始处理该 critical
            // task 时，第一次 TaskUpdate 就把真实 id 绑定回来。注入规则要求 critical task
            // 单独执行，因此不会把其他并行 task 误绑定为当前 critical task。
            if (!hybridEntry.hybridCriticalTaskId) {
              hybridEntry.hybridCriticalTaskId = updateSignal.taskId;
              logger.log(
                `[runner-spawn] smart-hybrid bound critical task id=${updateSignal.taskId} ` +
                  `sessionId=${callbackRef.session.id}`,
              );
            }
            if (
              updateSignal.taskId === hybridEntry.hybridCriticalTaskId &&
              updateSignal.status === "completed"
            ) {
              hybridEntry.pendingHybridDeescalation = {
                toolUseId: updateSignal.toolUseId,
                taskId: updateSignal.taskId,
              };
              logger.log(
                `[runner-spawn] smart-hybrid deescalation pending sessionId=${callbackRef.session.id} ` +
                  `task=${updateSignal.taskId} waiting tool_result=${updateSignal.toolUseId}`,
              );
            }
          }
        }
      }

      // 标记已开始实际内容输出：assistant 消息，或带 content_block 的流式事件。
      // 仅用于 error-trace 诊断日志（区分进程在首个输出前/后挂掉）。
      const isContentOutput =
        sdkMsg.type === "assistant" ||
        (sdkMsg.type === "stream_event" &&
          typeof (sdkMsg as any).event?.type === "string" &&
          (sdkMsg as any).event.type.startsWith("content_block"));
      if (isContentOutput) {
        const e = this.processCache.get(callbackRef.session.id);
        if (e && e.child === child) e.hasStartedOutput = true;
      }

      // Legacy breadcrumb compatibility. V2+ emits the authoritative telemetry exactly when
      // runner sends set_model. Claude CLI can later replay the same switch in a tool_result as
      // “[Model switched: A → B]”; suppress that exact replay once so counts equal real switches.
      const escalation = this.smartHybrid.detectEscalation(sdkMsg, callbackRef.envOverrides ?? {});
      if (escalation) {
        const entry = this.processCache.get(callbackRef.session.id);
        const fingerprint = `${escalation.active}\u0000${escalation.from}\u0000${escalation.model}`;
        const duplicateDirectTelemetry =
          entry?.hybridDirectTelemetryFingerprints?.has(fingerprint) === true;

        if (duplicateDirectTelemetry) {
          logger.log(
            `[runner-spawn] smart-hybrid duplicate escalation breadcrumb suppressed ` +
              `sessionId=${callbackRef.session.id} ${escalation.from} → ${escalation.model} ` +
              `active=${escalation.active}`,
          );
        } else {
          callbackRef.onEvent({
            type: "escalation.status",
            payload: { sessionId: callbackRef.session.id, ...escalation },
          } as ServerEvent);
          logger.log(
            `[runner-spawn] escalation: ${escalation.from} → ${escalation.model} ` +
              `active=${escalation.active}`,
          );
        }
      }

      if (sdkMsg.type === "result") {
        // resume 失败检测：目标 conversation 不存在时，CLI 立即报 error_during_execution。
        // 自动降级为无 resume 重试一次，让用户至少能继续对话而非每次秒错。
        if (this.tryHandleResumeFailure(child, callbackRef, sdkMsg)) return;

        // CLI 在网络错误时会发 subtype="success" 但 is_error=true（如断网时
        // result="API Error: Unable to connect to API (ENOTFOUND)"），需同时判断
        // is_error，否则会被误标为 completed，前端不显示「重新发送」。
        const isError =
          sdkMsg.subtype !== "success" || (sdkMsg as any).is_error === true;
        const status = isError ? "error" : "completed";
        if (isError) {
          const r = sdkMsg as any;
          const resultText = typeof r.result === "string" ? r.result : "";
          const eForLog = this.processCache.get(callbackRef.session.id);
          logger.warn(
            `[error-trace] reason=result-is-error sessionId=${callbackRef.session.id} ` +
            `subtype=${r.subtype} is_error=${r.is_error === true} ` +
            `resultLen=${resultText.length} hasStartedOutput=${eForLog?.hasStartedOutput === true} ` +
            `resultPreview=${JSON.stringify(resultText.slice(0, 200))}`,
          );
        } else {
          logger.log(
            `[error-trace] reason=result-success sessionId=${callbackRef.session.id} status=completed`,
          );
        }
        // 同步内存态：否则 stale checker 仍读到旧的 "running"，会在进程成功驻留
        // 期间(>90s 静默)误判为卡死并杀进程、下发 error，覆盖掉已 completed 的状态
        // （表现为「内容成功却显示回复中断」）。必须先于 onEvent 写入。
        callbackRef.session.status = status as Session["status"];
        callbackRef.onEvent({
          type: "session.status",
          payload: {
            sessionId: callbackRef.session.id,
            status,
            title: callbackRef.session.title,
            cwd: callbackRef.session.cwd,
          },
        });
        // 进程继续驻留，等待下一条 stdin 消息，不在此处 kill
        // 启动空闲超时计时器：无新输入则销毁释放资源
        const entry = this.processCache.get(callbackRef.session.id);
        if (entry && entry.child === child) {
          this.startIdleTimer(callbackRef.session.id, entry);
          // 本进程刚从 running 转为 completed/error（变为可淘汰空闲）→ 触发一次收敛。
          // 否则多个并发会话陆续 result 后、若无新的 set()，池子会一直鼓到 idle timeout
          // 才缩回（点 #1 的场景）。这里 keep 自身：它就是刚空闲下来的那个，按 LRU 它最新。
          this.enforceLruCap(callbackRef.session.id);
        }
      }
    });

    rl.on("close", () => {
      // stdout 关闭说明进程已退出（正常或异常）
      // staleKilled: 被静默超时扫描器主动杀死，error 事件已提前下发，这里跳过
      if (callbackRef.staleKilled) return;
      // 走到这里时 status 仍是 running，说明进程在本轮没发出 result 就退出了。
      // 正常结束一定先发 result（见上方 sdkMsg.type === "result"，那时 status 已置
      // completed/error）；进程平时也驻留不退出，只有 result 后空闲超时才退。
      // 因此「running 状态下进程消失」一定是异常退出——典型如无网络时 CLI 打印
      // "API Error: Unable to connect to API (ENOTFOUND)" 后直接退出、未发 result。
      // 判为 error，让前端显示「重新发送」按钮，而非误标 completed。
      if (callbackRef.session.status === "running") {
        const eForLog = this.processCache.get(callbackRef.session.id);
        logger.warn(
          `[error-trace] reason=stdout-close-while-running sessionId=${callbackRef.session.id} ` +
          `pid=${child.pid} hasStartedOutput=${eForLog?.hasStartedOutput === true} ` +
          `(进程未发 result 就退出，典型为上游断连/CLI 异常退出)`,
        );
        callbackRef.onEvent({
          type: "session.status",
          payload: {
            sessionId: callbackRef.session.id,
            status: "error",
            title: callbackRef.session.title,
          },
        });
      }
    });

    child.on("error", (error) => {
      logger.warn(
        `[error-trace] reason=child-process-error sessionId=${callbackRef.session.id} ` +
        `pid=${child.pid} error=${String(error)}`,
      );
      callbackRef.onEvent({
        type: "session.status",
        payload: {
          sessionId: callbackRef.session.id,
          status: "error",
          title: callbackRef.session.title,
          error: String(error),
        },
      });
    });
  }

  /**
   * 检测并处理 resume 失败：CLI resume 一个不存在的 conversation 时，会立即返回
   * error_during_execution，errors 含 "No conversation found"。此时自动降级为
   * 无 resume 重试一次（清掉 claudeSessionId + resumeSessionId），让用户能继续对话。
   *
   * 返回 true 表示已接管处理（调用方应 return，不再发常规 error）；false 表示非该场景。
   */
  private tryHandleResumeFailure(
    child: ChildProcess,
    callbackRef: ActiveCallbacks,
    result: SDKMessage,
  ): boolean {
    const r = result as Record<string, unknown>;
    if (r.subtype === "success" || !r.is_error) return false;
    const errors = Array.isArray(r.errors) ? (r.errors as unknown[]) : [];
    const isResumeMiss = errors.some(
      (e) => typeof e === "string" && e.includes("No conversation found"),
    );
    if (!isResumeMiss) return false;

    const sessionId = callbackRef.session.id;
    const entry = this.processCache.get(sessionId);
    const retryOptions = entry?.resumeRetryOptions;
    // ephemeral 路径：进程不入 processCache，改走 callbackRef.onResumeMiss 兜底。
    if ((!entry || entry.child !== child) && callbackRef.onResumeMiss) {
      this.killEphemeralChild(child);
      callbackRef.onResumeMiss();
      return true;
    }
    // 没有可重试上下文（已重试过 / 非首轮 resume）→ 不接管，走常规错误流程
    if (!entry || entry.child !== child || !retryOptions) return false;

    logger.warn(
      `[runner-spawn] resume target missing (claudeSessionId=${retryOptions.resumeSessionId}), ` +
        `falling back to fresh session sessionId=${sessionId}`,
    );

    // 清掉失效的 claudeSessionId，避免下次又拿它去 resume
    callbackRef.onSessionUpdate?.({ claudeSessionId: undefined });
    callbackRef.session.claudeSessionId = undefined;

    // 销毁当前(已失败)进程并以无 resume 重新发起；retryOptions 置空防止无限重试
    this.killAndEvict(sessionId, child);
    void this.run({
      ...retryOptions,
      resumeSessionId: undefined,
      session: { ...retryOptions.session, claudeSessionId: undefined },
    }).catch((e) => {
      logger.error(`[runner-spawn] resume-fallback retry failed:`, e);
      // 用原始(未经 stopped 包装的)onEvent，确保错误能送达前端
      retryOptions.onEvent({
        type: "session.status",
        payload: { sessionId, status: "error", title: callbackRef.session.title },
      });
    });
    return true;
  }

  /**
   * 跨平台杀掉一个 ephemeral 子进程（不涉及 processCache）。
   * 用于 ephemeral resume 失败兜底：销毁失败进程后再以无 resume 重跑。
   */
  private killEphemeralChild(child: ChildProcess): void {
    if (child.killed) return;
    if (process.platform === "win32" && child.pid) {
      spawnSync("taskkill", ["/F", "/T", "/PID", String(child.pid)], { stdio: "ignore", shell: false });
    } else {
      child.kill("SIGTERM");
    }
  }

  // ── 假死进程定期扫描 ──────────────────────────────────────────

  /** 启动定期扫描器，清理假死进程（统一 30min 阈值）。
   * running 期间的断流交给 CLI 自身的重试/超时机制，上层不再做激进静默检测。 */
  private startStaleProcessChecker(): void {
    this.staleCheckTimer = setInterval(() => {
      const now = Date.now();
      for (const [sessionId, entry] of this.processCache) {
        const isRunning = entry.callbackRef.session.status === "running";
        const silence = now - entry.lastActivity;
        // 统一用 30min 假死阈值。running 期间的断流（流式中途断网、上游卡死等）
        // 由 CLI 内置的指数退避重试 / 请求超时处理，上层不再靠 stdout 静默时长
        // 猜测 CLI 内部阶段——那样会引入大量标记位和误杀。这里只兜「进程真死」。
        if (silence > STALE_PROCESS_MS) {
          logger.warn(
            `[error-trace] reason=stale-process-killed ` +
            `pid=${entry.child.pid} sessionId=${sessionId} silence=${Math.round(silence / 1000)}s ` +
            `threshold=${Math.round(STALE_PROCESS_MS / 1000)}s hasStartedOutput=${entry.hasStartedOutput === true}`,
          );
          // running 状态下假死被杀 → 标记让 rl.close 跳过，并主动下发 error，
          // 否则前端会永久转圈。非 running（已 completed/error）静默清理即可。
          if (isRunning) {
            entry.callbackRef.staleKilled = true;
            const errorMsg = "回复中断：长时间无响应，可能是网络中断或服务超时。";
            entry.callbackRef.onEvent({
              type: "session.status",
              payload: { sessionId, status: "error", title: entry.callbackRef.session.title, error: errorMsg },
            });
            entry.callbackRef.onEvent({
              type: "runner.error",
              payload: { sessionId, message: errorMsg },
            });
          }
          this.killAndEvict(sessionId, entry.child);
        }
      }
    }, STALE_CHECK_INTERVAL_MS);
    // 不阻止 Node 进程退出
    if (this.staleCheckTimer.unref) this.staleCheckTimer.unref();
  }

  // ── 孤儿进程 PID 文件管理 ─────────────────────────────────────

  /** 启动时清理上次残留的子进程。 */
  private cleanupOrphanProcesses(): void {
    try {
      if (!existsSync(getPidFilePath())) return;
      const raw = readFileSync(getPidFilePath(), "utf8");
      const pids: number[] = JSON.parse(raw);
      if (!Array.isArray(pids) || pids.length === 0) return;
      logger.log(`[runner-spawn] cleaning up orphan PIDs: ${pids.join(", ")}`);
      for (const pid of pids) {
        this.killPidIfAlive(pid);
      }
    } catch (e) {
      logger.warn(`[runner-spawn] orphan cleanup failed:`, e);
    } finally {
      // 清空 PID 文件
      this.writePidFile([]);
    }
  }

  /** 检查进程是否存活并 kill。 */
  private killPidIfAlive(pid: number): void {
    try {
      if (process.platform === "win32") {
        // tasklist 查找 PID 是否存在
        const result = spawnSync("tasklist", ["/FI", `PID eq ${pid}`], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        });
        if (result.stdout && result.stdout.includes(String(pid))) {
          execSync(`taskkill /F /T /PID ${pid}`, { stdio: "ignore" });
          logger.log(`[runner-spawn] killed orphan pid=${pid}`);
        }
      } else {
        // Unix: kill -0 检查存活, kill -9 终止
        process.kill(pid, 0); // throws if not alive
        process.kill(pid, "SIGKILL");
        logger.log(`[runner-spawn] killed orphan pid=${pid}`);
      }
    } catch {
      // 进程已不存在，正常
    }
  }

  /** 记录新的子进程 PID 到文件。 */
  private recordPid(pid: number | undefined): void {
    if (!pid) return;
    try {
      const pids = this.readPidFile();
      if (!pids.includes(pid)) {
        pids.push(pid);
        this.writePidFile(pids);
      }
    } catch (e) {
      logger.warn(`[runner-spawn] recordPid failed:`, e);
    }
  }

  /** 从 PID 文件移除已结束的进程。 */
  private removePid(pid: number | undefined): void {
    if (!pid) return;
    try {
      const pids = this.readPidFile();
      const idx = pids.indexOf(pid);
      if (idx >= 0) {
        pids.splice(idx, 1);
        this.writePidFile(pids);
      }
    } catch (e) {
      logger.warn(`[runner-spawn] removePid failed:`, e);
    }
  }

  private readPidFile(): number[] {
    try {
      if (!existsSync(getPidFilePath())) return [];
      return JSON.parse(readFileSync(getPidFilePath(), "utf8")) as number[];
    } catch {
      return [];
    }
  }

  private writePidFile(pids: number[]): void {
    try {
      const dir = getClaudeConfigDir();
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(getPidFilePath(), JSON.stringify(pids), "utf8");
    } catch (e) {
      logger.warn(`[runner-spawn] writePidFile failed:`, e);
    }
  }
}
