// Session event handlers — imported and called from useAppStore.ts
import type { TodoItem } from "./types";
import { createSession, loadSessionRunConfigs, persistSessionRunConfig, clearSessionRunConfig } from "./sessionSlice";
import { reconcileModelSelections } from "./routingHandlers";
import { tryAutoPreview } from "../../utils/autoPreview";

const SESSION_MODES_KEY = "lc:sessionModes";
function getStoredSessionModes(): Record<string, "daily" | "code"> {
  try { return JSON.parse(localStorage.getItem(SESSION_MODES_KEY) || "{}"); } catch { return {}; }
}

type SetFn = (partial: any) => void;
type GetFn = () => any;

// 拉取会话变更文件并回填 store。session.history 与 session.usage 两条路径共用，
// 避免重复的 fetch + set 逻辑漂移。失败静默（变更文件非关键路径）。
function fetchChangedFiles(sessionId: string, set: SetFn): void {
  fetch(`/api/sessions/${sessionId}/changed-files`)
    .then((r) => r.json())
    .then(({ files }: any) => {
      if (!Array.isArray(files)) return;
      set((state: any) => {
        const s = state.sessions[sessionId];
        if (!s) return state;
        return { sessions: { ...state.sessions, [sessionId]: { ...s, changedFiles: files, changedFilesLoaded: true } } };
      });
    })
    .catch(() => {});
}

// 从 session.status 的 error 文案中解析 cwd 缺失：命中返回缺失路径，否则 undefined。
// spawn 层约定格式 "CWD_MISSING: <path>"。
function parseCwdMissing(error?: string): string | undefined {
  if (typeof error !== "string" || !error.startsWith("CWD_MISSING:")) return undefined;
  return error.slice("CWD_MISSING:".length).trim() || undefined;
}

// 把后端任务快照项（subject/critical/...）映射成前端 TodoItem。
// tasks.snapshot（实时）与 session.history（刷新恢复）两条路径共用，避免逻辑漂移。
function mapSnapshotTask(t: any): TodoItem {
  return {
    id: t.id,
    content: t.subject,
    status: t.status,
    priority: t.critical ? "high" : "medium",
    ...(t.critical ? { critical: true } : {}),
    ...(t.activeForm ? { activeForm: t.activeForm } : {}),
  };
}

// 收集 messages 中所有 tool_result 的 tool_use_id
function collectToolResultIds(messages: any[]): Set<string> {
  const ids = new Set<string>();
  for (const m of messages ?? []) {
    const content = m?.message?.content;
    if (m?.type === "user" && Array.isArray(content)) {
      for (const c of content) if (c?.type === "tool_result" && c.tool_use_id) ids.add(c.tool_use_id);
    }
  }
  return ids;
}

// session.history 用后端 messages 整体替换时，AskUserQuestion 的 tool_result 是前端乐观写入的
// (它走 control_response、不入后端消息流)，直接替换会丢失。这里把后端缺失、但对应 tool_use
// 仍存在于后端 messages 里的乐观 tool_result 补回去。
function preserveOptimisticToolResults(prev: any[], next: any[]): any[] {
  if (!Array.isArray(prev) || prev.length === 0) return next;
  const nextResultIds = collectToolResultIds(next);
  // 后端 messages 里出现的 tool_use id（仅给这些补结果，避免补到已不存在的工具）
  const nextToolUseIds = new Set<string>();
  for (const m of next) {
    const content = m?.message?.content;
    if (m?.type === "assistant" && Array.isArray(content)) {
      for (const c of content) if (c?.type === "tool_use" && c.id) nextToolUseIds.add(c.id);
    }
  }
  const toAppend: any[] = [];
  for (const m of prev) {
    const content = m?.message?.content;
    if (m?.type === "user" && Array.isArray(content)) {
      for (const c of content) {
        if (c?.type === "tool_result" && c.tool_use_id
          && !nextResultIds.has(c.tool_use_id)
          && nextToolUseIds.has(c.tool_use_id)) {
          toAppend.push({ type: "user", message: { role: "user", content: [c] } });
        }
      }
    }
  }
  return toAppend.length ? [...next, ...toAppend] : next;
}

// 取会话中最后一条 assistant 消息的纯文本（拼接所有 text block），用于自动预览地址提取。
function lastAssistantText(messages: any[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.type !== "assistant") continue;
    const content = m.message?.content;
    if (!Array.isArray(content)) continue;
    const text = content
      .filter((b: any) => b?.type === "text" && typeof b.text === "string")
      .map((b: any) => b.text)
      .join("\n");
    if (text) return text;
  }
  return "";
}

// completed 时尝试自动预览：提取本地地址→探测就绪→打开内置浏览器，每会话仅一次。
// 守卫：仅对当前活跃会话生效。否则在会话 A 后台运行、用户已切到会话 B 时，A 完成会
// 强制弹开全局右面板并加载 A 的产物，让用户误以为是 B 的结果（右面板是全局单例，无 session 维度）。
// 非活跃会话不弹、且不置 previewOpened，使用户之后切回 A 时仍能首次自动预览。
function maybeAutoPreview(sessionId: string, set: SetFn, get: GetFn): void {
  if (sessionId !== get().activeSessionId) return;
  const session = get().sessions?.[sessionId];
  if (!session || session.previewOpened) return;
  const text = lastAssistantText(session.messages ?? []);
  if (!text) return;
  const openInBrowser = get().openInBrowser;
  if (typeof openInBrowser !== "function") return;
  // 端口探测期间（最长约 8s）用户可能切走，故在真正打开前再校验一次仍是活跃会话。
  tryAutoPreview(text, openInBrowser, session.cwd, () => get().activeSessionId === sessionId)
    .then((url) => {
      if (!url) return;
      set((state: any) => {
        const existing = state.sessions[sessionId];
        if (!existing) return state;
        return { sessions: { ...state.sessions, [sessionId]: { ...existing, previewOpened: true } } };
      });
    })
    .catch(() => {});
}

export function handleSessionEvents(
  event: any,
  set: SetFn,
  get: GetFn,
): boolean {
  const { type } = event;

  if (type === "session.list") {
    const payload = event.payload;
    const storedModes = getStoredSessionModes();
    const storedRunConfigs = loadSessionRunConfigs();
    set((state: any) => {
      const nextSessions: Record<string, any> = {};
      for (const session of payload.sessions) {
        // cron(定时任务)与 chat 一同展示在左栏；channel 等其它类型仍过滤。
        if (session.kind && session.kind !== "chat" && session.kind !== "cron") continue;
        const existing = state.sessions[session.id] ?? createSession(session.id);
        const storedMode = storedModes[session.id];
        // 持久化的运行配置（model/endpointId）：仅当内存里该字段还没值时回灌，
        // 不覆盖本次运行已选过的值。刷新/重启后这是恢复会话所选模型的唯一来源。
        const storedCfg = storedRunConfigs[session.id];
        nextSessions[session.id] = {
          ...existing,
          status: session.status,
          title: session.title,
          cwd: session.cwd,
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
          type: (session as any).type,
          kind: session.kind ?? "chat",
          ...(storedMode ? { mode: storedMode } : existing.mode ? { mode: existing.mode } : {}),
          ...(existing.model === undefined && storedCfg?.model !== undefined ? { model: storedCfg.model } : {}),
          ...(existing.endpointId === undefined && storedCfg?.endpointId !== undefined ? { endpointId: storedCfg.endpointId } : {}),
          ...(existing.smartHybrid === undefined && storedCfg?.smartHybrid !== undefined ? { smartHybrid: storedCfg.smartHybrid } : {}),
        };
      }
      const activeId = state.activeSessionId;
      const sessionsArr = payload.sessions as any[];
      const hasSessions = sessionsArr.length > 0;
      let newActiveId: string | null | undefined = undefined;  // ← undefined 表示"不改变"
      // 无激活会话 + 列表非空 → 自动激活最新的
      if (!activeId && hasSessions) {
        const sorted = [...sessionsArr].sort((a: any, b: any) => (a.updatedAt ?? a.createdAt ?? 0) - (b.updatedAt ?? b.createdAt ?? 0));
        newActiveId = sorted[sorted.length - 1]?.id ?? null;
      }
      // 已有激活会话但不在列表里 → 保守策略：保留激活状态，不主动清空。
      // 理由：running 会话在服务端可能未持久化；断连重连时 session.list 不含临时会话是正常的。
      // 真正删除由 session.deleted 事件处理（见 line 185）。
      return {
        sessions: nextSessions,
        sessionsLoaded: true,
        activeSessionId: newActiveId !== undefined ? newActiveId : activeId,
      };
    });
    // 会话回灌后校正失效引用：若 endpoint.list 已先到（endpoints 在 store 中），这里补做
    // 会话级校正（endpoint.list 当时 sessions 还空、漏掉了）。endpoints 未到则内部空表守卫
    // 跳过，待 endpoint.list 到达时再校正。两处都调，与到达顺序无关。
    reconcileModelSelections(set, get);
    return true;
  }

  if (type === "session.history") {
    const { sessionId, messages, status, diffs, tasks: snapshotTasks } = event.payload as any;
    // 刷新恢复：history REST 顺带返回的任务快照（会话进程已退出时从磁盘读），映射成 TodoItem
    const restoredTasks: TodoItem[] | undefined = Array.isArray(snapshotTasks)
      ? snapshotTasks.map(mapSnapshotTask)
      : undefined;
    set((state: any) => {
      const existing = state.sessions[sessionId] ?? createSession(sessionId);
      // 保留前端乐观写入、但后端消息流不含的 AskUserQuestion tool_result，
      // 避免 session.history 覆盖后答案丢失（AskUserQuestion 走 control_response，不入后端消息流）
      const mergedMessages = preserveOptimisticToolResults(existing.messages, messages);
      // 健壮性：若 history 早于 session.list 到达（会话对象刚 createSession，无 model），
      // 从持久化 map 回灌所选模型，避免短暂回退到全局默认。仅在内存还没值时补。
      const storedCfg = existing.model === undefined || existing.endpointId === undefined || existing.smartHybrid === undefined
        ? loadSessionRunConfigs()[sessionId]
        : undefined;
      return {
        sessions: {
          ...state.sessions,
          [sessionId]: {
            ...existing,
            status,
            messages: mergedMessages,
            hydrated: true,
            loadingHistory: false,
            ...(existing.model === undefined && storedCfg?.model !== undefined ? { model: storedCfg.model } : {}),
            ...(existing.endpointId === undefined && storedCfg?.endpointId !== undefined ? { endpointId: storedCfg.endpointId } : {}),
            ...(existing.smartHybrid === undefined && storedCfg?.smartHybrid !== undefined ? { smartHybrid: storedCfg.smartHybrid } : {}),
            ...(restoredTasks && restoredTasks.length > 0 ? { tasks: restoredTasks } : {}),
            ...(Array.isArray(diffs) && diffs.length > 0 ? { diffs, diffStatus: "pending" as const } : {}),
          },
        },
      };
    });
    if (status === "completed" || status === "error") {
      fetch(`/api/sessions/${sessionId}/usage`)
        .then((r) => r.json())
        .then(({ summary }: any) => {
          if (!summary) return;
          set((state: any) => {
            const existing = state.sessions[sessionId];
            if (!existing) return state;
            return { sessions: { ...state.sessions, [sessionId]: { ...existing, usageSummary: summary } } };
          });
        }).catch(() => {});
      fetchChangedFiles(sessionId, set);
    }
    return true;
  }

  if (type === "session.status") {
    const { sessionId, status, title, cwd, kind, error } = event.payload as any;
    // cron(定时任务)与 chat 一同入 store；channel 等其它类型仍过滤。
    if (kind && kind !== "chat" && kind !== "cron") return true;
    const cwdMissing = parseCwdMissing(error);
    set((state: any) => {
      // Remap: 乐观渲染创建的临时 session(clientId)迁移到 server 返回的真实 sessionId。
      // 把临时对象的 messages/title 等全部带过去,用户消息不丢、不闪。
      if (state.pendingClientSessionId && state.sessions[state.pendingClientSessionId] && !state.sessions[sessionId]) {
        const temp = state.sessions[state.pendingClientSessionId];
        const { [state.pendingClientSessionId]: _, ...restSessions } = state.sessions;
        const draft = state.draftRunConfig ?? {};
        // 若临时会话上挂着排队消息，迁移到真实 sessionId（防丢）。
        let queuedPatch: any = {};
        const tempQueue = state.queuedBySession?.[state.pendingClientSessionId];
        if (tempQueue) {
          const nextQueued = { ...state.queuedBySession };
          delete nextQueued[state.pendingClientSessionId];
          nextQueued[sessionId] = [...(nextQueued[sessionId] ?? []), ...tempQueue];
          queuedPatch = { queuedBySession: nextQueued };
        }
        // 真实 sessionId 落定：把 draft 的运行配置持久化到这个 id，刷新后可恢复。
        if (draft.model !== undefined || draft.endpointId !== undefined || draft.smartHybrid !== undefined) {
          persistSessionRunConfig(sessionId, { model: draft.model, endpointId: draft.endpointId, smartHybrid: draft.smartHybrid });
        }
        return {
          sessions: {
            ...restSessions,
            [sessionId]: {
              ...temp,
              id: sessionId,
              status,
              // 显式清升级态：remap 后是全新真实会话，不应继承临时会话可能携带的 escalationModel。
              // 当前临时会话通常不带此字段（escalation 用真实 sessionId），显式写 undefined 使意图明确、
              // 防御未来有人往临时 clientId 写 escalation 导致串带。
              escalationModel: undefined,
              title: title || temp.title,
              cwd: cwd || temp.cwd,
              cwdMissing: cwdMissing ?? (status === "running" ? undefined : temp.cwdMissing),
              updatedAt: Date.now(),
              model: draft.model,
              endpointId: draft.endpointId,
              smartHybrid: draft.smartHybrid,
              permissionMode: draft.permissionMode,
            },
          },
          activeSessionId: sessionId,
          pendingClientSessionId: undefined,
          pendingStart: false,
          ...queuedPatch,
        };
      }

      const existing = state.sessions[sessionId] ?? createSession(sessionId);
      const needsModeApply = state.pendingSessionMode && !existing.mode;
      const storedModes = needsModeApply ? getStoredSessionModes() : null;
      // 新会话(pendingStart 触发)：把"新会话默认运行配置"原子复制进 SessionView。
      // 仅当该会话尚无 model 时注入（避免覆盖已存在会话的配置）。
      const draft = state.draftRunConfig ?? {};
      const needsConfigApply = state.pendingStart && existing.model === undefined;
      // 新会话首次落 model/endpointId/smartHybrid 时也持久化，保证刷新后恢复（即便用户没再动过 chip）。
      if (needsConfigApply && (draft.model !== undefined || draft.endpointId !== undefined || draft.smartHybrid !== undefined)) {
        persistSessionRunConfig(sessionId, { model: draft.model, endpointId: draft.endpointId, smartHybrid: draft.smartHybrid });
      }
      return {
        sessions: {
          ...state.sessions,
          [sessionId]: {
            ...existing,
            status,
            title: title || existing.title,
            cwd: cwd || existing.cwd,
            kind: kind ?? existing.kind ?? "chat",
            cwdMissing: cwdMissing ?? (status === "running" ? undefined : existing.cwdMissing),
            updatedAt: Date.now(),
            // 会话离开 running（completed/error/aborted）→ 清升级态。CLI 在 abort/error 时
            // 不保证补发 escalation.status active=false，靠这里的终态清理兜底，避免徽章卡死。
            ...(status !== "running" ? { escalationModel: undefined } : {}),
            ...(needsModeApply && storedModes ? { mode: storedModes[sessionId] ?? state.pendingSessionMode } : {}),
            ...(needsConfigApply ? { model: draft.model, endpointId: draft.endpointId, smartHybrid: draft.smartHybrid, permissionMode: draft.permissionMode } : {}),
          },
        },
        ...(state.pendingStart ? { pendingStart: false, activeSessionId: sessionId } : {}),
        ...(needsModeApply ? { pendingSessionMode: null } : {}),
      };
    });
    // 渠道会话实时归组：事件带 channelId 时把会话 upsert 进 channelSessions[channelId]，
    // 使新建渠道的首条 IM 会话当次即落入 CHANNELS 分组，无需等重启后重拉。幂等。
    const channelId = (event.payload as any).channelId as string | undefined;
    if (channelId) {
      set((state: any) => {
        const list = state.channelSessions[channelId] ?? [];
        const sess = state.sessions[sessionId];
        const entry = {
          id: sessionId,
          title: sess?.title || title || "(未命名)",
          status: sess?.status ?? status,
          updatedAt: sess?.updatedAt ?? Date.now(),
        };
        const idx = list.findIndex((s: any) => s.id === sessionId);
        const next = idx >= 0
          ? list.map((s: any, i: number) => (i === idx ? { ...s, ...entry } : s))
          : [entry, ...list];
        return { channelSessions: { ...state.channelSessions, [channelId]: next } };
      });
    }
    // 任务完成：尝试自动打开预览（异步探测端口就绪，每会话仅一次）。
    if (status === "completed") maybeAutoPreview(sessionId, set, get);
    return true;
  }

  if (type === "session.deleted") {
    const { sessionId } = event.payload;
    clearSessionRunConfig(sessionId);
    set((state: any) => {
      if (!state.sessions[sessionId]) return state;
      const nextSessions = { ...state.sessions };
      delete nextSessions[sessionId];
      const remaining = Object.values(nextSessions) as any[];
      remaining.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
      const newActiveId = state.activeSessionId === sessionId ? (remaining[0]?.id ?? null) : state.activeSessionId;
      // 顺带清理该会话的排队消息，避免队列泄漏。
      const patch: any = { sessions: nextSessions, activeSessionId: newActiveId };
      if (state.queuedBySession?.[sessionId]) {
        const nextQueued = { ...state.queuedBySession };
        delete nextQueued[sessionId];
        patch.queuedBySession = nextQueued;
      }
      return patch;
    });
    return true;
  }

  if (type === "session.usage") {
    const { sessionId, summary } = event.payload;
    set((state: any) => {
      const existing = state.sessions[sessionId];
      if (!existing) return state;
      return { sessions: { ...state.sessions, [sessionId]: { ...existing, usageSummary: summary } } };
    });
    fetchChangedFiles(sessionId, set);
    return true;
  }

  if (type === "session.diff") {
    const { sessionId, diffs } = event.payload;
    set((state: any) => {
      const s = state.sessions[sessionId];
      if (!s) return state;
      return { sessions: { ...state.sessions, [sessionId]: { ...s, diffs, diffStatus: "pending" } } };
    });
    return true;
  }

  if (type === "session.files") {
    const { sessionId, sessionWorkDir, files } = event.payload;
    set((state: any) => {
      const s = state.sessions[sessionId];
      if (!s) return state;
      return { sessions: { ...state.sessions, [sessionId]: { ...s, generatedFiles: files, generatedFilesDir: sessionWorkDir } } };
    });
    return true;
  }

  // 任务快照：由 server 监听 CLI 任务目录后推送的全量结构化任务列表。
  // 这是任务清单的唯一数据源（取代旧的“解析 tool_result 文本”方案）。
  if (type === "tasks.snapshot") {
    const { sessionId, tasks } = event.payload as {
      sessionId: string;
      tasks: Array<{ id: string; subject: string; status: TodoItem["status"]; activeForm?: string; critical?: boolean }>;
    };
    set((state: any) => {
      const existing = state.sessions[sessionId];
      if (!existing) return state; // 未知会话，忽略
      const mapped: TodoItem[] = tasks.map(mapSnapshotTask);
      // 仅写入数据。步骤展示已迁至 composer 上方的 StepStatusLine（按 tasks 有无自显隐），
      // 不再自动弹右面板——进度条常驻提示已足够，避免双重打扰。
      return { sessions: { ...state.sessions, [sessionId]: { ...existing, tasks: mapped } } };
    });
    return true;
  }

  if (type === "stream.message") {
    const { sessionId, message } = event.payload;
    const toolCounts: Record<string, number> = {};

    if (message.type === "assistant" && Array.isArray((message as any).message?.content)) {
      for (const block of (message as any).message.content) {
        if (block.type === "tool_use" && block.name) {
          toolCounts[block.name] = (toolCounts[block.name] || 0) + 1;
        }
      }
    }

    set((state: any) => {
      const existing = state.sessions[sessionId] ?? createSession(sessionId);
      const enriched = Object.assign({}, message, { _routingDecision: existing.routingDecision, _timestamp: Date.now() });

      const hasToolCounts = Object.keys(toolCounts).length > 0;

      // 只需要追加消息时：只替换 session 对象，避免无用的 spread 开销
      if (!hasToolCounts) {
        return {
          sessions: {
            ...state.sessions,
            [sessionId]: {
              ...existing,
              messages: existing.messages.concat(enriched),
            },
          },
        };
      }

      const merged: Record<string, number> = { ...existing.realtimeToolCounts };
      for (const [k, v] of Object.entries(toolCounts)) merged[k] = (merged[k] || 0) + v;

      return {
        sessions: {
          ...state.sessions,
          [sessionId]: {
            ...existing,
            realtimeToolCounts: merged,
            messages: existing.messages.concat(enriched),
          },
        },
      };
    });
    return true;
  }

  if (type === "stream.user_prompt") {
    const { sessionId, prompt, attachments, source } = event.payload;
    set((state: any) => {
      const existing = state.sessions[sessionId] ?? createSession(sessionId);
      // 去重：乐观渲染已在 Composer 里立即添加了同一条 user_prompt，
      // server 回传时跳过避免重复。比对末尾消息的 prompt 文本即可。
      const last = existing.messages[existing.messages.length - 1];
      if (last?.type === "user_prompt" && last.prompt === prompt) {
        return state;
      }
      return { sessions: { ...state.sessions, [sessionId]: { ...existing, messages: [...existing.messages, { type: "user_prompt", prompt, attachments, source }] } } };
    });
    return true;
  }

  if (type === "permission.request") {
    const { sessionId, toolUseId, toolName, input } = event.payload;
    set((state: any) => {
      const existing = state.sessions[sessionId] ?? createSession(sessionId);
      return {
        sessions: { ...state.sessions, [sessionId]: { ...existing, permissionRequests: [...existing.permissionRequests, { toolUseId, toolName, input }] } },
      };
    });
    return true;
  }

  if (type === "runner.error") {
    set({ globalError: event.payload.message });
    return true;
  }

  return false;
}
