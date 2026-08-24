import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";

// ── Session types ──

export type SessionStatus = "idle" | "running" | "completed" | "error";

export type SessionKind = "chat" | "cron" | "channel";

// 运行模式 = CLI permissionMode（对齐 claude-cli 真实枚举，前端暴露 4 档）。
// plan=只读出计划 / default=Ask逐次询问 / acceptEdits=Auto自动接受编辑 / bypassPermissions=Full完全权限。
export type PermissionMode = "plan" | "default" | "acceptEdits" | "bypassPermissions";

export type SessionInfo = {
  id: string;
  title: string;
  status: SessionStatus;
  claudeSessionId?: string;
  cwd?: string;
  createdAt: number;
  updatedAt: number;
  type?: "normal";
  kind?: SessionKind;
};

// ── Attachment types ──

export type Attachment = {
  base64: string;
  mimeType: string;
  name: string;
  size: number;
};

export type UserPromptMessage = {
  type: "user_prompt";
  prompt: string;
  attachments?: Attachment[];
  /** 消息来源：缺省/user=用户手动发送；automation=定时任务续聊自动发送（前端据此显示徽标）。 */
  source?: "user" | "automation";
};

/** 用户主动停止任务的标记。写入消息流，用于区分「主动停止」与「被动中断」。 */
export type SessionStoppedMessage = {
  type: "session_stopped";
  at: number;
};

export type StreamMessage = SDKMessage | UserPromptMessage | SessionStoppedMessage;

/**
 * 判别「CLI 回放噪声」——当前唯一来源是 set_model 实时注入的模型切换面包屑
 * （`<local-command-stdout>Set model to …</local-command-stdout>`，见打包 CLI
 * injectModelSwitchBreadcrumbs）。这类消息是为交互式 TUI 的转录保真设计的，对
 * 「自维护历史」的 localcoding（DB + session.history 重绘）是噪声：归因错（伪造成
 * 用户敲了 /model）、且只在热进程复用发 set_model 时非确定性出现。
 *
 * 合取两个信号，互为保险：
 *  1) isReplay === true —— 官方协议给「回放/合成、非当前真实交互」的标记位
 *     （对应 SDK 的 SDKUserMessageReplaySchema）。这是语义主信号。
 *  2) content 含 <local-command-stdout> tag —— 兜底。⚠️ 关键不变式：localcoding 的
 *     buildCliArgs **不传** --replay-user-messages，故 isReplay 当前只可能是面包屑。
 *     但若将来有人为修「resume 历史重建」在 buildCliArgs 加了该 flag，CLI 会给**真实
 *     历史 user 消息**也打 isReplay:true（实测 cli.js resume 回放路径）——那些消息不含
 *     此 tag，靠这一条挡住，避免「只判 isReplay」悄悄吞掉用户真实历史对话。
 *
 * 用 tag 常量而非 "Set model to" 英文文案做兜底：tag 是协议常量（LOCAL_COMMAND_STDOUT_TAG），
 * 比可本地化/改写的文案稳定。两信号全中才判为噪声 → 严格只删更少消息，不会比单信号更激进。
 */
export function isCliReplayNoise(msg: unknown): boolean {
  if (!msg || typeof msg !== "object") return false;
  const m = msg as Record<string, unknown>;
  if (m.type !== "user" || m.isReplay !== true) return false;
  return messageContentHasTag(m, "local-command-stdout");
}

/** 在消息的顶层 content（字符串）或 message.content（字符串/块数组）中查找指定 tag。 */
function messageContentHasTag(m: Record<string, unknown>, tag: string): boolean {
  const needle = `<${tag}`;
  const hit = (v: unknown): boolean => {
    if (typeof v === "string") return v.includes(needle);
    if (Array.isArray(v)) {
      return v.some((b) => typeof b === "object" && b !== null && hit((b as Record<string, unknown>).text));
    }
    return false;
  };
  if (hit(m.content)) return true;
  const inner = m.message as Record<string, unknown> | undefined;
  return !!inner && hit(inner.content);
}

// ── Usage Summary types ──

export type UsageSummaryItem = {
  name: string;
  count: number;
  detail?: string;
};

export type UsageSummary = {
  skills: UsageSummaryItem[];
  memories: UsageSummaryItem[];
  mcpTools: UsageSummaryItem[];
  agents: UsageSummaryItem[];
  otherTools: Record<string, number>;
};