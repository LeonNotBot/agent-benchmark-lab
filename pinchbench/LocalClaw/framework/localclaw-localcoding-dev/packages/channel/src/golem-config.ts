import type { GolemConfig } from "golembot";
import type { ChannelType } from "@lenovo/agent-protocol";

/**
 * Build an in-memory default GolemConfig for Local Claw.
 *
 * Local Claw 不写 `golem.yaml`，因此用代码构造 GolemBot `handleMessage()`
 * 期望的 GolemConfig（含 group/streaming/maxTurns 等策略）。
 *
 * streaming.mode：四端统一用 "streaming"（实时分段下发）。
 * - 飞书/钉钉/企微：支持可编辑状态消息，showToolCalls=true 显示工具调用 hint。
 * - 微信：每条 reply 都是独立新消息（无法编辑/撤回），streaming 表现为「多条气泡
 *   按段落顺序实时发出」。showToolCalls=false——微信无可编辑状态消息承载
 *   "🔧 ..." hint，tool_call 时只 flush 已累积正文，不发 hint。
 *
 * 微信 streaming 的安全前提（均已满足）：
 * - thinking 气泡：WeixinAdapter wrapper 的 no-op sendStatus（返回""）使 gateway 走
 *   状态分支而非 fallback reply，零气泡（见 weixin-adapter-wrapper.ts）。
 * - narration 泄漏：legacy daemon 的 CLI stdout 独白通道已删除；golembot 路径下
 *   ChannelAssistant.mapServerEvent 只把真实 text_delta 当正文，无独白泄漏。
 * - 代码块跨气泡断裂：gateway 段落 flush 已加围栏保护（patch），``` 未闭合时
 *   暂缓 flush，避免拆出未闭合代码块。
 *
 * `channels` 字段保持 undefined：channel adapter 由 GolemChannelManager
 * 单独 new，不通过 GolemConfig 传入。
 *
 * 注意：golembot 的 ClaudeCodeEngine 需要在 PATH 中找到 "claude" 二进制文件。
 * 在生产环境中，如果 CLI 不在 PATH 中，channel 通信会失败。
 */
export function buildDefaultGolemConfig(opts: { botName: string; channelType?: ChannelType }): GolemConfig {
  const isWechat = opts.channelType === "wechat";
  return {
    name: opts.botName,
    engine: "claude-code",
    groupChat: {
      groupPolicy: "mention-only",
      historyLimit: 20,
      maxTurns: 30,
    },
    streaming: { mode: "streaming", showToolCalls: !isWechat },
  };
}
