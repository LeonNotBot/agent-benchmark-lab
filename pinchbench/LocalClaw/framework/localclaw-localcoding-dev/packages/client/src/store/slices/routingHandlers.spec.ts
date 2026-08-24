import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleRoutingEvents } from "./routingHandlers";

// jsdom 不一定提供 localStorage（vitest 默认 node 环境），用内存桩，
// 供 sessionSlice 的 clearSessionRunConfig（读写 lc:sessionRunConfigs）使用。
function installLocalStorage(seed: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(seed));
  (globalThis as any).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  };
  return store;
}

const ENDPOINTS = [
  { id: "sky", enabled: true, apiType: "anthropic", baseUrl: "https://sky/v1", hasApiKey: true, models: [{ id: "claude-sonnet-4-6" }] },
];

/** 构造一个最小 store 桩：set 合并 patch，get 返回当前快照 + action spies。 */
function makeStore(initial: any) {
  let state: any = { ...initial };
  const setSelectedModel = vi.fn((m: any) => { state.selectedModel = m; });
  const setDraftRunConfig = vi.fn((c: any) => { state.draftRunConfig = { ...state.draftRunConfig, ...c }; });
  state.setSelectedModel = setSelectedModel;
  state.setDraftRunConfig = setDraftRunConfig;
  const set = (partial: any) => { state = { ...state, ...(typeof partial === "function" ? partial(state) : partial) }; };
  const get = () => state;
  return { set, get, getState: () => state, spies: { setSelectedModel, setDraftRunConfig } };
}

describe("endpoint.list 三态校正失效引用", () => {
  beforeEach(() => installLocalStorage());

  it("selectedModel 失效 → 落首个可用模型", () => {
    const { set, get, spies } = makeStore({
      selectedModel: { endpointId: "gone", model: "x" },
      draftRunConfig: {},
      sessions: {},
    });
    handleRoutingEvents({ type: "endpoint.list", payload: { endpoints: ENDPOINTS } }, set, get);
    expect(spies.setSelectedModel).toHaveBeenCalledWith({ endpointId: "sky", model: "claude-sonnet-4-6" });
  });

  it("selectedModel 仍有效 → 不动", () => {
    const { set, get, spies } = makeStore({
      selectedModel: { endpointId: "sky", model: "claude-sonnet-4-6" },
      draftRunConfig: {},
      sessions: {},
    });
    handleRoutingEvents({ type: "endpoint.list", payload: { endpoints: ENDPOINTS } }, set, get);
    expect(spies.setSelectedModel).not.toHaveBeenCalled();
  });

  it("draftRunConfig 失效 → 清空", () => {
    const { set, get, spies } = makeStore({
      selectedModel: { endpointId: "sky", model: "claude-sonnet-4-6" },
      draftRunConfig: { endpointId: "gone", model: "dead" },
      sessions: {},
    });
    handleRoutingEvents({ type: "endpoint.list", payload: { endpoints: ENDPOINTS } }, set, get);
    expect(spies.setDraftRunConfig).toHaveBeenCalledWith({ model: undefined, endpointId: undefined });
  });

  it("失效会话被清空（内存 + 落盘）；有效会话保留", () => {
    const ls = installLocalStorage({
      "lc:sessionRunConfigs": JSON.stringify({
        s1: { endpointId: "gone", model: "dead" },
        s2: { endpointId: "sky", model: "claude-sonnet-4-6" },
      }),
    });
    const { set, get, getState } = makeStore({
      selectedModel: { endpointId: "sky", model: "claude-sonnet-4-6" },
      draftRunConfig: {},
      sessions: {
        s1: { id: "s1", endpointId: "gone", model: "dead" },
        s2: { id: "s2", endpointId: "sky", model: "claude-sonnet-4-6" },
      },
    });
    handleRoutingEvents({ type: "endpoint.list", payload: { endpoints: ENDPOINTS } }, set, get);

    const st = getState();
    expect(st.sessions.s1.model).toBeUndefined();
    expect(st.sessions.s1.endpointId).toBeUndefined();
    expect(st.sessions.s2.model).toBe("claude-sonnet-4-6");

    const persisted = JSON.parse(ls.get("lc:sessionRunConfigs")!);
    expect(persisted.s1).toBeUndefined();          // 落盘陈旧项被删
    expect(persisted.s2).toEqual({ endpointId: "sky", model: "claude-sonnet-4-6" });
  });

  it("空表（无可用 endpoint）→ 整体跳过，绝不删持久化配置", () => {
    const ls = installLocalStorage({
      "lc:sessionRunConfigs": JSON.stringify({ s1: { endpointId: "sky", model: "claude-sonnet-4-6" } }),
    });
    const { set, get, getState, spies } = makeStore({
      selectedModel: { endpointId: "sky", model: "claude-sonnet-4-6" },
      draftRunConfig: { endpointId: "sky", model: "claude-sonnet-4-6" },
      sessions: { s1: { id: "s1", endpointId: "sky", model: "claude-sonnet-4-6" } },
    });
    // 瞬时空表（重启窗口 / 删改中间态）：不能因此把用户配置抹掉。
    handleRoutingEvents({ type: "endpoint.list", payload: { endpoints: [] } }, set, get);

    expect(spies.setSelectedModel).not.toHaveBeenCalled();
    expect(spies.setDraftRunConfig).not.toHaveBeenCalled();
    expect(getState().sessions.s1.model).toBe("claude-sonnet-4-6");
    expect(JSON.parse(ls.get("lc:sessionRunConfigs")!).s1).toBeDefined();
  });

  it("本地 127.0.0.1 无 key endpoint → 视为可用，不被判失效", () => {
    const LOCAL = [
      { id: "local", enabled: true, apiType: "openai-compatible", baseUrl: "http://127.0.0.1:11434/v1", hasApiKey: false, models: [{ id: "qwen" }] },
    ];
    const { set, get, spies } = makeStore({
      selectedModel: { endpointId: "local", model: "qwen" },
      draftRunConfig: {},
      sessions: {},
    });
    handleRoutingEvents({ type: "endpoint.list", payload: { endpoints: LOCAL } }, set, get);
    expect(spies.setSelectedModel).not.toHaveBeenCalled(); // 本地无 key 仍算可用 → 不校正
  });
});
