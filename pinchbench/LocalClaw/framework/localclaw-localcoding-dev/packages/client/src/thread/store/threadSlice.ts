// Thread 域的状态切片（从 uiSlice/sessionSlice 抽出，S1）。
// 仍挂在全局 useAppStore 上，组件通过 useThreadStore selector 访问。
import type { Attachment } from "@lenovo/agent-protocol";
import type { ResolvedRunConfig } from "../../store/slices/routingSlice";

/** 一条排队消息。runConfig 在【入队时】快照，避免排队后切 model/mode 影响已排队消息。 */
export interface QueuedMessage {
  prompt: string;
  attachments?: Attachment[];
  runConfig: ResolvedRunConfig;
}

export interface ThreadSlice {
  // 输入框附件（临时态，发送后清空）
  attachments: Attachment[];
  // 会话启动中标识（发送第一条消息后、收到第一个响应前为 true）
  pendingStart: boolean;
  // 预填到输入框的草稿文本（如「自动化-通过聊天创建」跳转时注入），Composer 挂载时消费一次后清空
  composerDraft: string;
  // 未发送的输入框草稿：按【所属会话】分桶（新会话/空态用固定 key NEW_DRAFT_KEY）。
  // 提升到 store（而非 Composer 本地 state）以保证切换会话再切回时草稿不丢、也不串台。
  draftBySession: Record<string, string>;
  // 排队消息：上一轮还在跑时输入的消息按【所属会话】分桶暂存，FIFO。
  // 提升到 store（而非 Composer 本地 state）以保证切换会话时队列跟着会话走，
  // 不会被误发到当前激活会话。status running→非running 下降沿时由全局 hook 逐条 flush。
  queuedBySession: Record<string, QueuedMessage[]>;

  addAttachment: (attachment: Attachment) => void;
  removeAttachment: (index: number) => void;
  clearAttachments: () => void;
  setPendingStart: (pending: boolean) => void;
  setComposerDraft: (draft: string) => void;
  // 写指定会话的输入框草稿（空字符串表示清空该桶）
  setDraftForSession: (sessionId: string, draft: string) => void;
  // 入队一条消息到指定会话
  enqueueMessage: (sessionId: string, msg: QueuedMessage) => void;
  // 取出指定会话队首消息（返回该消息并从队列移除）；空队列返回 undefined
  dequeueMessage: (sessionId: string) => QueuedMessage | undefined;
  // 清空指定会话的队列
  clearQueue: (sessionId: string) => void;
}

export function createThreadSlice(set: any, get: any): ThreadSlice {
  return {
    attachments: [],
    pendingStart: false,
    composerDraft: "",
    draftBySession: {},
    queuedBySession: {},

    addAttachment: (attachment) =>
      set((s: any) => ({ attachments: [...s.attachments, attachment].slice(0, 4) })),
    removeAttachment: (index) =>
      set((s: any) => ({ attachments: s.attachments.filter((_: any, i: number) => i !== index) })),
    clearAttachments: () => set({ attachments: [] }),
    setPendingStart: (pendingStart) => set({ pendingStart }),
    setComposerDraft: (composerDraft) => set({ composerDraft }),

    setDraftForSession: (sessionId, draft) =>
      set((s: any) => {
        const next = { ...s.draftBySession };
        if (draft) next[sessionId] = draft;
        else delete next[sessionId];
        return { draftBySession: next };
      }),

    enqueueMessage: (sessionId, msg) =>
      set((s: any) => ({
        queuedBySession: {
          ...s.queuedBySession,
          [sessionId]: [...(s.queuedBySession[sessionId] ?? []), msg],
        },
      })),
    dequeueMessage: (sessionId) => {
      const queue = get().queuedBySession[sessionId] ?? [];
      if (queue.length === 0) return undefined;
      const [next, ...rest] = queue;
      set((s: any) => {
        const nextMap = { ...s.queuedBySession };
        if (rest.length > 0) nextMap[sessionId] = rest;
        else delete nextMap[sessionId];
        return { queuedBySession: nextMap };
      });
      return next;
    },
    clearQueue: (sessionId) =>
      set((s: any) => {
        if (!s.queuedBySession[sessionId]) return s;
        const nextMap = { ...s.queuedBySession };
        delete nextMap[sessionId];
        return { queuedBySession: nextMap };
      }),
  };
}
