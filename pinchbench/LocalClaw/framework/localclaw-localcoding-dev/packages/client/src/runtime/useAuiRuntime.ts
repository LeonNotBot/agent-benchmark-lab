// Runtime 桥接：把 zustand sessionSlice 的消息流暴露给 assistant-ui
// messages 转换 + tool_result 合并后交给 useExternalStoreRuntime
// onNew 由 Composer 直接走 sendEvent；onAddToolResult 把工具结果(如 AskUserQuestion 答案)
// 路由到后端 permission.response —— 这是 assistant-ui human-in-the-loop 的标准接法

import { useMemo, useCallback } from "react";
import { useExternalStoreRuntime, type AppendMessage, type AddToolResultOptions } from "@assistant-ui/react";
import type { ClientEvent } from "@lenovo/agent-protocol";
import { useAppStore } from "../store/useAppStore";
import { getRunConfig, flattenTarget } from "../store/slices/routingSlice";
import { buildThreadMessages, hasPendingAskUserQuestion } from "./buildThreadMessages";
import { useThreadListAdapter } from "./useThreadListAdapter";

export function useAuiRuntime(sendEvent: (event: ClientEvent) => void) {
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const sessions = useAppStore((s) => s.sessions);
  const resolvePermissionRequest = useAppStore((s) => s.resolvePermissionRequest);
  const appendToolResult = useAppStore((s) => s.appendToolResult);
  const threadList = useThreadListAdapter(sendEvent);

  const activeSession = activeSessionId ? sessions[activeSessionId] : undefined;
  const rawMessages = activeSession?.messages ?? [];
  const isError = activeSession?.status === "error";

  const messages = useMemo(() => buildThreadMessages(rawMessages, isError), [rawMessages, isError]);

  // 是否存在待回答的人机交互工具(AskUserQuestion 无 result)。判定与底部运行指示器共用
  // hasPendingAskUserQuestion，纯基于消息结构，不依赖 permissionRequests 旁路。
  const awaitingUserAnswer = useMemo(() => hasPendingAskUserQuestion(rawMessages), [rawMessages]);

  // 等待用户回答时实际是在等输入而非模型运行，把 isRunning 置 false，
  // 否则 assistant-ui 会持续 autoscroll，导致问题卡片无法滚动查看。
  const isRunning = activeSession?.status === "running" && !awaitingUserAnswer;

  // onNew 是 ExternalStoreRuntime 必填字段，但实际发送由 Composer 直接走 sendEvent
  const onNew = useCallback(async (_msg: AppendMessage) => {}, []);

  // onReload：ActionBar 的「继续」按钮触发。
  // 流式输出中断后 server 下发 error → 最后一条 assistant 消息标记 incomplete/error
  // → assistant-ui 显示按钮 → 这里发一条「继续」指令让 AI 从中断处接着执行。
  // 不重发原 prompt：后端是长驻 CLI 进程 + --resume，出错前已做的工作(改文件/跑命令)都还在，
  // 重发会让 agent 重做整轮、可能重复副作用；发「继续」则从中断点续跑，不丢进度。
  const onReload = useCallback(async (_parentId: string | null) => {
    const sid = useAppStore.getState().activeSessionId;
    if (!sid) return;
    // 重发前移除 CLI 网络错误生成的英文 assistant 气泡（"API Error: ..."），
    // 避免它残留在新一轮对话历史里。
    useAppStore.getState().removeErrorMessages(sid);
    // 继续指令跟随当前 UI 语种；CLI 会在已恢复的会话上下文中接着执行未完成的任务。
    const locale = useAppStore.getState().locale;
    const prompt = locale === "en"
      ? "Please continue the unfinished task from the previous turn."
      : "请继续上一轮未完成的任务。";
    // 带上当前会话的运行配置(model/endpointId 或 smartHybrid + permissionMode)，否则会丢 Plan/模型，回退 default。
    const runCfg = getRunConfig(useAppStore.getState(), sid);
    const wire = runCfg.target
      ? { ...flattenTarget(runCfg.target), permissionMode: runCfg.permissionMode }
      : { permissionMode: runCfg.permissionMode };
    sendEvent({
      type: "session.continue",
      payload: { sessionId: sid, prompt, ...wire },
    } as any);
  }, [sendEvent]);

  // 组件 addResult(result) → 这里把结果路由到后端。约定 result = PermissionResult
  // ({ behavior, updatedInput }) —— 直接作为 permission.response 的 result 字段。
  const onAddToolResult = useCallback((options: AddToolResultOptions) => {
    const sid = useAppStore.getState().activeSessionId;
    if (!sid) return;
    // 1) 送后端，解除 CLI 阻塞
    sendEvent({
      type: "permission.response",
      payload: { sessionId: sid, toolUseId: options.toolCallId, result: options.result },
    } as any);
    // 2) 乐观更新：立即给该 tool-call 写入结果，卡片即时切到已答态(不等后端回包)
    appendToolResult(sid, options.toolCallId, options.result);
    resolvePermissionRequest(sid, options.toolCallId);
  }, [sendEvent, appendToolResult, resolvePermissionRequest]);

  return useExternalStoreRuntime({
    messages,
    isRunning,
    convertMessage: (m) => m,
    onNew,
    onReload,
    onAddToolResult,
    adapters: { threadList },
  });
}
