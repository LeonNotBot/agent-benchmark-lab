import type { RoutingPreference, SmartHybridConfig, SelectedModel, DeviceCapabilities, EndpointInfo, PermissionMode, EscalationHistoryEntry } from "@lenovo/agent-protocol";
import { SK } from "../storageKeys";

/** 运行配置（模型 + 权限模式）。会话级配置存在 SessionView 上；这里只保留"新会话默认值"。
 * model+endpointId（单模型）与 smartHybrid（智能升级）互斥——写入点保证只存其一。 */
export type SessionRunConfig = {
  model?: string;
  endpointId?: string;
  smartHybrid?: SmartHybridConfig;
  permissionMode?: PermissionMode;
};

/**
 * 运行目标：单模型 XOR 智能升级。领域本质是判别联合（天然互斥、不可同时）。
 * 解析层把每层配置归约成一个完整 RunTarget（或 null），再整层竞争取值——
 * 避免「单模型字段」与「smartHybrid」跨层混成非法态（见 layerTarget）。
 */
export type RunTarget =
  | { kind: "single"; endpointId: string; model: string }
  | { kind: "hybrid"; config: SmartHybridConfig };

/** 已解析的运行配置（用于落 payload）。target 为 null = 未选任何模型/SH，发送应被拦截。 */
export type ResolvedRunConfig = {
  target: RunTarget | null;
  permissionMode: PermissionMode;
};

/** RunTarget → 扁平线格式。发送边界统一用它把内部联合转回 payload 字段。 */
export function flattenTarget(t: RunTarget): { model?: string; endpointId?: string; smartHybrid?: SmartHybridConfig } {
  return t.kind === "single"
    ? { model: t.model, endpointId: t.endpointId }
    : { smartHybrid: t.config };
}

/** 把单层配置归约成完整 RunTarget 或 null（不完整就当没有，不跨层混字段）。 */
function layerTarget(cfg: { model?: string; endpointId?: string; smartHybrid?: SmartHybridConfig } | undefined): RunTarget | null {
  if (!cfg) return null;
  if (cfg.smartHybrid) return { kind: "hybrid", config: cfg.smartHybrid };
  if (cfg.model && cfg.endpointId) return { kind: "single", model: cfg.model, endpointId: cfg.endpointId };
  return null;
}

/**
 * 纯函数：判定一个 (endpointId, model) 选择在当前可用 endpoint 表里是否仍有效。
 * 单一谓词，供 endpoint.list 三态校正（selectedModel / draft / 各会话）复用，
 * 避免「失效引用」判定逻辑散落多处又各自漂移（元根因 B：引用无统一校验）。
 * 可用 = endpoint 存在该 id + 该 endpoint 含此 model。空 endpointId/model 视为无效。
 */
export function isUsableSelection(
  usable: { id: string; models: { id: string }[] }[],
  endpointId: string | undefined,
  model: string | undefined,
): boolean {
  if (!endpointId || !model) return false;
  return usable.some((e) => e.id === endpointId && e.models.some((m) => m.id === model));
}

/**
 * 纯函数：按优先级原子解析运行目标。不碰 React/store，可单测。
 * 优先级：会话 > draft > 全局 selectedModel（各层先归约成完整 target 再整层竞争）。
 * 强约束：无兜底空串——三层都解析不出完整 target 时返回 { target: null }，发送被拦。
 * permissionMode 是正交轴，独立逐层回退，缺省 acceptEdits（自动执行，随 dev 权限模式改造）。
 */
export function resolveRunConfig(
  sessionCfg: SessionRunConfig | undefined,
  draft: SessionRunConfig | undefined,
  selected: { model?: string; endpointId?: string } | undefined,
): ResolvedRunConfig {
  const target =
    layerTarget(sessionCfg) ??
    layerTarget(draft) ??
    layerTarget(selected);
  const permissionMode = sessionCfg?.permissionMode ?? draft?.permissionMode ?? "acceptEdits";
  return { target, permissionMode };
}

/**
 * 薄 store helper：在【发送动作内】调用(非 render),取当前 store 快照解析运行配置。
 * 单一配置源——Composer 首发/续聊/队列、useAuiRuntime.onReload 都用它。
 * @param state useAppStore.getState() 快照
 * @param sessionId 目标会话；null/未创建时读 draft
 */
export function getRunConfig(state: any, sessionId: string | null): ResolvedRunConfig {
  const session = sessionId ? state.sessions?.[sessionId] : undefined;
  const sessionCfg: SessionRunConfig | undefined = session
    ? { model: session.model, endpointId: session.endpointId, smartHybrid: session.smartHybrid, permissionMode: session.permissionMode }
    : undefined;
  return resolveRunConfig(sessionCfg, state.draftRunConfig, state.selectedModel);
}

export interface RoutingSlice {
  routingPreference: RoutingPreference;
  selectedModelOverride: string | null;
  smartHybridConfig: SmartHybridConfig | null;
  selectedModel: SelectedModel;
  /** app 级升级日志（最多 50 条）。当前升级态是会话级的，见 SessionView.escalationModel。 */
  escalationHistory: EscalationHistoryEntry[];
  lastRoutingDecision: any | null;
  deviceCapabilities: DeviceCapabilities | null;
  routingStatus: string | null;
  endpoints: EndpointInfo[];
  /** 新会话默认运行配置（常驻）。会话创建时复制进 SessionView。 */
  draftRunConfig: SessionRunConfig;
  setRoutingPreference: (preference: RoutingPreference) => void;
  setSelectedModelOverride: (model: string | null) => void;
  setSmartHybridConfig: (config: SmartHybridConfig | null) => void;
  setSelectedModel: (model: SelectedModel) => void;
  setEndpoints: (endpoints: EndpointInfo[]) => void;
  /** 修改"新会话默认运行配置"。Composer 在无 activeSession 时写这里。 */
  setDraftRunConfig: (config: Partial<SessionRunConfig>) => void;
}

/**
 * 从 localStorage 读取路由偏好并做读时迁移。
 * 历史版本存过 "auto" / "cloud" / "local"（本地推理时代的遗留，早已等价）——统一归一化为
 * "standard"。只有 "smart-hybrid" 原样保留。非法/缺失值也回落 "standard"。
 * 纯读时归一化：不主动覆写 localStorage，用户下次改设置时自然落新值（迁移与交互解耦）。
 */
function loadRoutingPreference(): RoutingPreference {
  const stored = localStorage.getItem(SK.ROUTING_PREFERENCE);
  return stored === "smart-hybrid" ? "smart-hybrid" : "standard";
}

export function createRoutingSlice(set: any): RoutingSlice {
  return {
    routingPreference: loadRoutingPreference(),
    selectedModelOverride: localStorage.getItem(SK.MODEL_OVERRIDE) || null,
    smartHybridConfig: (() => {
      try {
        const v = localStorage.getItem(SK.SMART_HYBRID_CONFIG);
        if (!v) return null;
        const parsed = JSON.parse(v);
        if (!parsed) return null;
        if (parsed.defaultModel?.endpointId) return parsed;
        return {
          defaultModel: { endpointId: parsed.defaultModel?.provider || "", model: parsed.defaultModel?.model || "" },
          upgradeModel: { endpointId: parsed.upgradeModel?.provider || "", model: parsed.upgradeModel?.model || "" },
        };
      }
      catch { return null; }
    })(),
    selectedModel: (() => {
      try {
        const v = localStorage.getItem(SK.SELECTED_MODEL);
        // 不写死默认服务商/模型：未选过时留空，待 endpoint.list 到达后由 routingHandlers 回落到首个可用模型
        if (!v) return { endpointId: "", model: "" };
        const parsed = JSON.parse(v);
        if (parsed.endpointId) return parsed;
        return { endpointId: parsed.provider || "", model: parsed.model || "" };
      }
      catch { return { endpointId: "", model: "" }; }
    })(),
    escalationHistory: [],
    lastRoutingDecision: null,
    deviceCapabilities: null,
    routingStatus: null,
    endpoints: [],
    draftRunConfig: {},

    setRoutingPreference: (routingPreference) => {
      localStorage.setItem(SK.ROUTING_PREFERENCE, routingPreference);
      set({ routingPreference });
    },
    setSelectedModelOverride: (model: string | null) => {
      if (model) localStorage.setItem(SK.MODEL_OVERRIDE, model);
      else localStorage.removeItem(SK.MODEL_OVERRIDE);
      set({ selectedModelOverride: model });
    },
    setSmartHybridConfig: (config: SmartHybridConfig | null) => {
      if (config) localStorage.setItem(SK.SMART_HYBRID_CONFIG, JSON.stringify(config));
      else localStorage.removeItem(SK.SMART_HYBRID_CONFIG);
      set({ smartHybridConfig: config });
    },
    setSelectedModel: (model: SelectedModel) => {
      localStorage.setItem(SK.SELECTED_MODEL, JSON.stringify(model));
      set({ selectedModel: model });
    },
    setEndpoints: (endpoints) => set({ endpoints }),
    setDraftRunConfig: (config) => set((state: any) => ({
      draftRunConfig: { ...state.draftRunConfig, ...config },
    })),
  };
}
