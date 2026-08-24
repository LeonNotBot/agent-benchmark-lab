// Routing event handlers
import { isUsableSelection } from "./routingSlice";
import { clearSessionRunConfigs } from "./sessionSlice";
import { isEndpointUsable } from "../../utils/endpointUsable";

type SetFn = (partial: any) => void;

type Usable = { id: string; models: { id: string }[] }[];

/**
 * hybrid 配置是否仍有效：default 与 upgrade 两槽都必须命中可用 endpoint+model。
 * 任一槽失效则整个 hybrid 判失效（升级链断了，不能半残跑）。
 */
function isHybridUsable(usable: Usable, sh: any): boolean {
  if (!sh?.defaultModel || !sh?.upgradeModel) return false;
  return (
    isUsableSelection(usable, sh.defaultModel.endpointId, sh.defaultModel.model) &&
    isUsableSelection(usable, sh.upgradeModel.endpointId, sh.upgradeModel.model)
  );
}

/**
 * 三态校正失效引用（治 #17）：endpoint 被删/改名后，散在三处的「当前模型」引用都可能悬空。
 * 统一用 isUsableSelection 校验，失效则校正，避免把死引用发到后端（后端档位模糊匹配会
 * 静默误路由）。从 endpoint.list 与 session.list 两处调用——谁后到谁触发完整校正，使校正
 * 与「endpoints 已加载 + sessions 已回灌」的到达顺序无关（治竞态：endpoint.list 先到时
 * sessions 还空，会话校正漏掉；session.list 后到时再调一次即可补上）。
 *
 * 关键安全：usable 为空（全新安装 / 重启窗口 / 删改中间态，getPublicList 零 endpoint 即返回 []）
 * 时**整体跳过**，绝不校正——否则一次瞬时空表会把所有会话的持久化配置不可逆删除。
 * 宁可短暂显示失效，也不动用户落盘数据。
 */
export function reconcileModelSelections(set: SetFn, get: () => any): void {
  const state = get();
  const endpoints = state.endpoints || [];
  // 可用判定的唯一真源见 utils/endpointUsable（与 ModelChip / 后端 isUsable 同口径）。
  const usable = endpoints.filter(isEndpointUsable);
  // 空表兜底：无任何可用 endpoint 时不校正（不删持久化），避免瞬时空表误删用户配置。
  if (usable.length === 0) return;

  // 1) 全局默认 selectedModel：失效 → 落首个可用模型（保留原自愈行为）。
  const sel = state.selectedModel;
  if (!isUsableSelection(usable, sel?.endpointId, sel?.model)) {
    const ep = usable[0];
    state.setSelectedModel({ endpointId: ep.id, model: ep.models[0].id });
  }

  // 2) draftRunConfig（新会话默认）：单模型失效 → 清 model/endpointId；hybrid 双槽失效 → 清 smartHybrid。
  const draft = state.draftRunConfig;
  if (draft?.smartHybrid && !isHybridUsable(usable, draft.smartHybrid)) {
    state.setDraftRunConfig({ smartHybrid: undefined });
  } else if (draft?.model && !isUsableSelection(usable, draft.endpointId, draft.model)) {
    state.setDraftRunConfig({ model: undefined, endpointId: undefined });
  }

  // 3) 各会话级运行目标：单模型失效清 model/endpointId；hybrid 双槽失效清 smartHybrid。
  //    落盘项一次性批量删除（避免逐个读改写整张 map）。
  const sessions = state.sessions || {};
  const deadSessionIds: string[] = [];
  const nextSessions = { ...sessions };
  for (const [sid, s] of Object.entries<any>(sessions)) {
    if (s?.smartHybrid && !isHybridUsable(usable, s.smartHybrid)) {
      deadSessionIds.push(sid);
      nextSessions[sid] = { ...s, smartHybrid: undefined };
    } else if (s?.model && !isUsableSelection(usable, s.endpointId, s.model)) {
      deadSessionIds.push(sid);
      nextSessions[sid] = { ...s, model: undefined, endpointId: undefined };
    }
  }
  if (deadSessionIds.length > 0) {
    clearSessionRunConfigs(deadSessionIds);
    set({ sessions: nextSessions });
  }
}

export function handleRoutingEvents(
  event: any,
  set: SetFn,
  get: () => any,
): boolean {
  const { type } = event;

  if (type === "routing.decision") {
    const { sessionId, decision } = event.payload;
    set((state: any) => {
      const existing = state.sessions[sessionId];
      if (!existing) return { lastRoutingDecision: decision, routingStatus: null };
      return {
        lastRoutingDecision: decision,
        routingStatus: null,
        sessions: { ...state.sessions, [sessionId]: { ...existing, routingDecision: decision } },
      };
    });
    return true;
  }

  if (type === "routing.status") {
    set({ routingStatus: event.payload.status });
    return true;
  }

  if (type === "escalation.status") {
    const { active, model, sessionId } = event.payload as any;
    set((state: any) => {
      // escalation 是会话级事实：写进具体会话，不写全局布尔。
      // 有值 = 升级中（跑升级模型），无值 = 用默认模型。
      //
      // session 尚未到达（连接竞态：escalation.status 早于 session.list）时，
      // 有意静默跳过 per-session 写入——这种 race 窗口极窄且影响仅为徽章暂不显示（无数据丢失）。
      // escalationHistory 全局记录仍会写入，不影响设置面板的历史回溯。
      const existing = state.sessions?.[sessionId];
      const nextSessions = existing
        ? {
            sessions: {
              ...state.sessions,
              [sessionId]: {
                ...existing,
                escalationModel: active ? (model || undefined) : undefined,
              },
            },
          }
        : {};
      // escalationHistory 是 app 级日志（最多 50 条），保留全局——供设置面板回溯。
      return {
        ...nextSessions,
        escalationHistory: [
          { timestamp: Date.now(), model: model || "", active, sessionId },
          ...state.escalationHistory,
        ].slice(0, 50),
      };
    });
    return true;
  }

  if (type === "device.capabilities") {
    set({ deviceCapabilities: event.payload });
    return true;
  }

  if (type === "endpoint.list") {
    const endpoints = event.payload.endpoints || [];
    set({ endpoints });
    // endpoints 到达后校正失效引用。与 session.list 的到达顺序无关：两处都调，
    // 谁后到谁补全（见 reconcileModelSelections 注释）。
    reconcileModelSelections(set, get);
    return true;
  }

  return false;
}
