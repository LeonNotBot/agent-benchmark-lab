import { describe, it, expect } from "vitest";
import { handleMcpEvents } from "./mcpHandlers";

/** 最小 store 桩：set 合并 patch（支持函数式），返回当前快照。 */
function makeStore(initial: any) {
  let state: any = { ...initial };
  const set = (partial: any) => {
    state = { ...state, ...(typeof partial === "function" ? partial(state) : partial) };
  };
  return { set, getState: () => state };
}

function server(id: string, status = "starting", extra: Record<string, unknown> = {}) {
  return { id, name: id, type: "stdio", status, tools: [], createdAt: 0, updatedAt: 0, ...extra };
}

describe("handleMcpEvents", () => {
  it("mcp.server.list 全量覆盖", () => {
    const { set, getState } = makeStore({ mcpServers: [server("old")] });
    const handled = handleMcpEvents(
      { type: "mcp.server.list", payload: { servers: [server("a"), server("b")] } },
      set,
    );
    expect(handled).toBe(true);
    expect(getState().mcpServers.map((s: any) => s.id)).toEqual(["a", "b"]);
  });

  it("mcp.server.list 空 payload 归零", () => {
    const { set, getState } = makeStore({ mcpServers: [server("a")] });
    handleMcpEvents({ type: "mcp.server.list", payload: {} }, set);
    expect(getState().mcpServers).toEqual([]);
  });

  it("mcp.server.list 晚到的过期快照不把已落定状态打回 starting（竞态核心）", () => {
    // store 中 a 已 installed（先到的 WS status 事件已应用），
    // 晚到的 list 快照里 a 仍是 starting → 必须保留 installed，不倒退。
    const { set, getState } = makeStore({
      mcpServers: [server("a", "installed", { tools: [{ name: "t1" }] })],
    });
    handleMcpEvents(
      { type: "mcp.server.list", payload: { servers: [server("a", "starting"), server("b", "starting")] } },
      set,
    );
    const a = getState().mcpServers.find((s: any) => s.id === "a");
    expect(a.status).toBe("installed");
    expect(a.tools).toEqual([{ name: "t1" }]);
    // 新成员 b 按快照值进入
    expect(getState().mcpServers.find((s: any) => s.id === "b").status).toBe("starting");
  });

  it("mcp.server.list 快照里的非 starting 状态正常采用（如真的变 error）", () => {
    const { set, getState } = makeStore({ mcpServers: [server("a", "installed")] });
    handleMcpEvents(
      { type: "mcp.server.list", payload: { servers: [server("a", "error")] } },
      set,
    );
    expect(getState().mcpServers[0].status).toBe("error");
  });

  it("mcp.server.updated upsert：已存在替换", () => {
    const { set, getState } = makeStore({ mcpServers: [server("a", "starting")] });
    handleMcpEvents(
      { type: "mcp.server.updated", payload: { server: server("a", "installed") } },
      set,
    );
    expect(getState().mcpServers).toHaveLength(1);
    expect(getState().mcpServers[0].status).toBe("installed");
  });

  it("mcp.server.updated upsert：不存在则追加", () => {
    const { set, getState } = makeStore({ mcpServers: [server("a")] });
    handleMcpEvents({ type: "mcp.server.updated", payload: { server: server("b") } }, set);
    expect(getState().mcpServers.map((s: any) => s.id)).toEqual(["a", "b"]);
  });

  it("mcp.server.status 改已知 server 的 status + errorMessage", () => {
    const { set, getState } = makeStore({ mcpServers: [server("a", "starting")] });
    handleMcpEvents(
      { type: "mcp.server.status", payload: { serverId: "a", status: "error", error: "boom" } },
      set,
    );
    expect(getState().mcpServers[0].status).toBe("error");
    expect(getState().mcpServers[0].errorMessage).toBe("boom");
  });

  it("mcp.server.status 乱序早到：未知 id 被忽略，不造无名条目", () => {
    const { set, getState } = makeStore({ mcpServers: [] });
    const handled = handleMcpEvents(
      { type: "mcp.server.status", payload: { serverId: "ghost", status: "error" } },
      set,
    );
    expect(handled).toBe(true);
    expect(getState().mcpServers).toEqual([]);
  });

  it("mcp.server.deleted 过滤移除", () => {
    const { set, getState } = makeStore({ mcpServers: [server("a"), server("b")] });
    handleMcpEvents({ type: "mcp.server.deleted", payload: { serverId: "a" } }, set);
    expect(getState().mcpServers.map((s: any) => s.id)).toEqual(["b"]);
  });

  it("非 mcp 事件返回 false", () => {
    const { set } = makeStore({ mcpServers: [] });
    expect(handleMcpEvents({ type: "channel.list", payload: {} }, set)).toBe(false);
  });
});
