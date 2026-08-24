import type { SessionView } from "./types";
import { SK } from "../storageKeys";

export interface SessionSlice {
  sessions: Record<string, SessionView>;
  activeSessionId: string | null;
  globalError: string | null;
  sessionsLoaded: boolean;
  historyRequested: Set<string>;
  setGlobalError: (error: string | null) => void;
  setActiveSessionId: (id: string | null) => void;
  markHistoryRequested: (sessionId: string) => void;
  resolvePermissionRequest: (sessionId: string, toolUseId: string) => void;
  // 乐观更新：给指定 tool-call 追加一条 tool_result，使其 UI 立即切到“已完成”
  appendToolResult: (sessionId: string, toolUseId: string, result: unknown) => void;
  setSessionDiffs: (sessionId: string, diffs: any[]) => void;
  setSessionFiles: (sessionId: string, dir: string, files: any[]) => void;
  setDiffStatus: (sessionId: string, status: "pending" | "applied" | "discarded") => void;
  setSelectedPreviewFile: (sessionId: string, path: string | null) => void;
  setSessionLoadingHistory: (sessionId: string, loading: boolean) => void;
  /** 移除会话中 CLI 网络错误标记的 assistant 消息（error 字段），用于重发前清理 */
  removeErrorMessages: (sessionId: string) => void;
  /** 更新某会话的运行配置（model/endpointId/permissionMode）。chip 在有 activeSession 时写这里。 */
  setSessionRunConfig: (sessionId: string, config: { model?: string; endpointId?: string; smartHybrid?: import("@lenovo/agent-protocol").SmartHybridConfig; permissionMode?: import("@lenovo/agent-protocol").PermissionMode }) => void;
}

const LAST_SESSION_KEY = SK.LAST_SESSION_ID;

/** 会话级运行配置（model/endpointId/smartHybrid）的持久化 map：{ [sessionId]: {...} }。
 * 与内存 SessionView 解耦，刷新/重启后由 session.list 重建会话时回灌（见 sessionHandlers）。
 * 持久化 model/endpointId 或 smartHybrid（二选一，运行目标）——permissionMode 安全相关，
 * 刷新后回落 default 是有意行为。 */
export type PersistedRunConfig = { model?: string; endpointId?: string; smartHybrid?: import("@lenovo/agent-protocol").SmartHybridConfig };

export function loadSessionRunConfigs(): Record<string, PersistedRunConfig> {
  try { return JSON.parse(localStorage.getItem(SK.SESSION_RUN_CONFIGS) || "{}"); }
  catch { return {}; }
}

function saveSessionRunConfigs(map: Record<string, PersistedRunConfig>): void {
  localStorage.setItem(SK.SESSION_RUN_CONFIGS, JSON.stringify(map));
}

/** 合并写入单个会话的持久化运行配置（只覆盖传入字段）。 */
export function persistSessionRunConfig(sessionId: string, config: PersistedRunConfig): void {
  const map = loadSessionRunConfigs();
  const next = { ...map[sessionId], ...config };
  // 清掉 undefined 字段，避免存进 "model": undefined 这类噪声
  if (next.model === undefined) delete next.model;
  if (next.endpointId === undefined) delete next.endpointId;
  if (next.smartHybrid === undefined) delete next.smartHybrid;
  map[sessionId] = next;
  saveSessionRunConfigs(map);
}

/** 删除某会话的持久化运行配置（会话删除时清理，防泄漏）。 */
export function clearSessionRunConfig(sessionId: string): void {
  const map = loadSessionRunConfigs();
  if (!(sessionId in map)) return;
  delete map[sessionId];
  saveSessionRunConfigs(map);
}

/** 批量删除多个会话的持久化运行配置（失效引用校正时用），一次性读改写整张 map。 */
export function clearSessionRunConfigs(sessionIds: string[]): void {
  if (sessionIds.length === 0) return;
  const map = loadSessionRunConfigs();
  let changed = false;
  for (const id of sessionIds) {
    if (id in map) { delete map[id]; changed = true; }
  }
  if (changed) saveSessionRunConfigs(map);
}

export function createSession(id: string, mode?: "daily" | "code"): SessionView {
  return { id, title: "", status: "idle", messages: [], permissionRequests: [], hydrated: false, loadingHistory: false, ...(mode ? { mode } : {}) };
}

export function createSessionSlice(set: any, get: any): SessionSlice {
  return {
    sessions: {},
    activeSessionId: null,
    globalError: null,
    sessionsLoaded: false,
    historyRequested: new Set(),

    setGlobalError: (globalError) => set({ globalError }),
    setActiveSessionId: (id) => {
      set({ activeSessionId: id, globalError: null });
      if (id) localStorage.setItem(LAST_SESSION_KEY, id);
      else localStorage.removeItem(LAST_SESSION_KEY);
    },
    markHistoryRequested: (sessionId) => {
      set((state: any) => {
        const next = new Set(state.historyRequested);
        next.add(sessionId);
        return { historyRequested: next };
      });
    },
    resolvePermissionRequest: (sessionId, toolUseId) => {
      set((state: any) => {
        const existing = state.sessions[sessionId];
        if (!existing) return {};
        return {
          sessions: {
            ...state.sessions,
            [sessionId]: {
              ...existing,
              permissionRequests: existing.permissionRequests.filter((r: any) => r.toolUseId !== toolUseId),
            },
          },
        };
      });
    },
    appendToolResult: (sessionId, toolUseId, result) => {
      set((state: any) => {
        const existing = state.sessions[sessionId];
        if (!existing) return {};
        // 已存在该 tool_use 的结果则不重复追加（避免与后端真实回包叠加）
        const already = existing.messages.some(
          (m: any) =>
            m?.type === "user" &&
            Array.isArray(m?.message?.content) &&
            m.message.content.some((c: any) => c?.type === "tool_result" && c.tool_use_id === toolUseId),
        );
        if (already) return {};
        const resultMsg = {
          type: "user",
          message: { role: "user", content: [{ type: "tool_result", tool_use_id: toolUseId, content: result }] },
        };
        return {
          sessions: {
            ...state.sessions,
            [sessionId]: { ...existing, messages: [...existing.messages, resultMsg] },
          },
        };
      });
    },
    setSessionDiffs: (sessionId, diffs) =>
      set((state: any) => {
        const s = state.sessions[sessionId];
        if (!s) return state;
        return { sessions: { ...state.sessions, [sessionId]: { ...s, diffs, diffStatus: "pending" as const } } };
      }),
    setSessionFiles: (sessionId, dir, files) =>
      set((state: any) => {
        const s = state.sessions[sessionId];
        if (!s) return state;
        return { sessions: { ...state.sessions, [sessionId]: { ...s, generatedFiles: files, generatedFilesDir: dir } } };
      }),
    setDiffStatus: (sessionId, status) =>
      set((state: any) => {
        const s = state.sessions[sessionId];
        if (!s) return state;
        return { sessions: { ...state.sessions, [sessionId]: { ...s, diffStatus: status } } };
      }),
    setSelectedPreviewFile: (sessionId, path) =>
      set((state: any) => {
        const s = state.sessions[sessionId];
        if (!s) return state;
        return { sessions: { ...state.sessions, [sessionId]: { ...s, selectedPreviewFile: path } } };
      }),
    setSessionLoadingHistory: (sessionId, loading) =>
      set((state: any) => {
        const s = state.sessions[sessionId];
        if (!s) return state;
        return { sessions: { ...state.sessions, [sessionId]: { ...s, loadingHistory: loading } } };
      }),
    removeErrorMessages: (sessionId) =>
      set((state: any) => {
        const s = state.sessions[sessionId];
        if (!s) return state;
        const filtered = s.messages.filter(
          (m: any) => !(m?.type === "assistant" && m?.error != null),
        );
        if (filtered.length === s.messages.length) return state;
        return { sessions: { ...state.sessions, [sessionId]: { ...s, messages: filtered } } };
      }),
    setSessionRunConfig: (sessionId, config) =>
      set((state: any) => {
        const s = state.sessions[sessionId];
        if (!s) return state;
        // 同步落盘（model/endpointId/smartHybrid），刷新/重启后由 session.list 回灌。
        if ("model" in config || "endpointId" in config || "smartHybrid" in config) {
          persistSessionRunConfig(sessionId, { model: config.model, endpointId: config.endpointId, smartHybrid: config.smartHybrid });
        }
        return { sessions: { ...state.sessions, [sessionId]: { ...s, ...config } } };
      }),
  };
}
