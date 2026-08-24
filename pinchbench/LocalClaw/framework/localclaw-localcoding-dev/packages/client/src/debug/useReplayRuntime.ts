// 回放专用 assistant-ui runtime：useAuiRuntime 的只读裁剪版。
// 数据源是「当前回放到的 messages 数组」，经真实 buildThreadMessages 转换后喂给
// useExternalStoreRuntime —— 复用与主界面完全相同的转换 + 渲染管线，像素级重现。
// 不接全局 store、不发任何事件，纯只读。
import { useMemo, useCallback } from "react";
import { useExternalStoreRuntime, type AppendMessage } from "@assistant-ui/react";
import { buildThreadMessages } from "../runtime/buildThreadMessages";

/**
 * @param rawMessages 当前回放帧的原始消息数组（StreamMessage[]）
 * @param isError 该帧会话是否处于 error 态（影响最后一条 assistant 的中断样式）
 */
export function useReplayRuntime(rawMessages: any[], isError = false) {
  const messages = useMemo(() => {
    const built = buildThreadMessages(rawMessages ?? [], isError);
    // 关键：回放每帧都重新 buildThreadMessages，而源消息里 user_prompt 等无 uuid/id，
    // buildThreadMessages 会给它们分配随机 id（rnd()）。随机 id 每帧都变，
    // useExternalStoreRuntime 靠 id 做 diff → 认为整个对话被替换 → 渲染异常/不更新。
    // 这里用「稳定索引 id」覆盖：同一逻辑消息在回放中始终处于同一索引位（消息累积增长），
    // 索引 id 天然稳定，runtime 得以正确 diff、逐帧增量更新。
    return built.map((m, i) => ({ ...m, id: `replay-${i}` }));
  }, [rawMessages, isError]);

  // onNew 是 ExternalStoreRuntime 必填字段；回放只读，空实现。
  const onNew = useCallback(async (_msg: AppendMessage) => {}, []);

  return useExternalStoreRuntime({
    messages,
    isRunning: false,
    convertMessage: (m) => m,
    onNew,
  });
}
