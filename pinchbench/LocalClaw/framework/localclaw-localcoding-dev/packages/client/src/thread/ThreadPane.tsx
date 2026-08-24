// 中间区容器：空态 → Homepage；有会话 → 权限面板 + 消息列表 + 底部 Composer。
// 步骤状态由 Composer 上方的 StepStatusLine 展示（会话级、Codex 式当前步骤行），此处无任务卡片。
import { useCallback } from "react";
import { ThreadPrimitive } from "@assistant-ui/react";
import type { ClientEvent } from "@lenovo/agent-protocol";
import type { PermissionResult } from "@anthropic-ai/claude-agent-sdk";
import { useAppStore } from "../store/useAppStore";
import { DecisionPanel } from "../components/DecisionPanel";
import type { PartialState } from "../runtime/usePartialStream";
import { Homepage } from "./Homepage";
import { MessageList } from "./MessageList";
import { Composer } from "./Composer";
import { StepStatusLine } from "./steps/StepStatusLine";
import { ThreadHeader } from "./ThreadHeader";

interface Props {
  partial: PartialState;
  sendEvent: (event: ClientEvent) => void;
  hidden?: boolean; // 右面板全屏时，中间面板隐藏
}

export function ThreadPane({ partial, sendEvent, hidden }: Props) {
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const sessions = useAppStore((s) => s.sessions);
  const activeSession = activeSessionId ? sessions[activeSessionId] : undefined;
  // 写类工具的确认、AskUserQuestion、ExitPlanMode 均已移至 Composer（覆盖输入框）。
  // 这里只保留其余（默认）权限请求。
  const COMPOSER_CONFIRM_TOOLS = new Set([
    "Write", "Edit", "MultiEdit", "NotebookEdit", "Bash", "AskUserQuestion",
    "ExitPlanMode", "exit_plan_mode",
  ]);
  const permissionRequests = (activeSession?.permissionRequests ?? []).filter(
    (r: { toolName: string }) => !COMPOSER_CONFIRM_TOOLS.has(r.toolName),
  );

  // 右面板全屏时，中间面板让出全部空间（宽度塌为 0）
  const mainCls = `relative flex flex-1 flex-col min-w-0 overflow-hidden rounded-l-lg border-l border-y border-border-200 bg-bg-000 shadow-[-4px_0_16px_rgba(0,0,0,0.04)] ${hidden ? "hidden" : ""}`;

  const resolvePermissionRequest = useAppStore((s) => s.resolvePermissionRequest);

  const handlePermissionResponse = useCallback((result: PermissionResult) => {
    const req = permissionRequests[permissionRequests.length - 1];
    if (!req) return;
    sendEvent({
      type: "permission.response",
      payload: { sessionId: activeSessionId, toolUseId: req.toolUseId, result },
    } as any);
    // 乐观更新：本地清除该请求，面板立即消失（不等后端回包）。
    if (activeSessionId) resolvePermissionRequest(activeSessionId, req.toolUseId);
  }, [activeSessionId, permissionRequests, sendEvent, resolvePermissionRequest]);

  // 空态：无激活会话 → 首页
  if (!activeSessionId) {
    return (
      <main className={mainCls}>
        <Homepage sendEvent={sendEvent} />
      </main>
    );
  }

  return (
    <main className={mainCls}>
      <ThreadHeader />
      {permissionRequests.length > 0 && (
        <div className="px-4 py-3">
          <DecisionPanel
            request={permissionRequests[permissionRequests.length - 1]}
            onSubmit={handlePermissionResponse}
          />
        </div>
      )}
      <ThreadPrimitive.Root className="flex flex-1 flex-col overflow-hidden">
        <MessageList partial={partial} />
        <div className="bg-bg-000 px-6 py-3">
          {/* key=会话ID：切会话即 remount，归零局部 UI state（展开/隐藏），按会话隔离 */}
          <StepStatusLine key={activeSessionId} />
          <Composer sendEvent={sendEvent} />
        </div>
      </ThreadPrimitive.Root>
    </main>
  );
}
