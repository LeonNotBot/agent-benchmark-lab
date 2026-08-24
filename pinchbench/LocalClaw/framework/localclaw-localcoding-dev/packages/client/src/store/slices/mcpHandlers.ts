// MCP server event handlers
type SetFn = (partial: any) => void;

export function handleMcpEvents(
  event: any,
  set: SetFn,
): boolean {
  const { type } = event;

  if (type === "mcp.server.list") {
    // 合并而非盲覆盖：list 是某一时刻的全量快照，可能晚于 WS 增量 status 事件到达
    // （AppShell 的 HTTP fetch 响应慢一拍）。若直接覆盖，会用快照里过期的 `starting`
    // 把已就绪（installed/error）的 server 倒退回「验证中」——这正是「只有先探完的那个
    // 显示已启用、其余卡验证中」的根因。
    // 规则：list 对「成员增删」权威；但单个 server 的状态，绝不用快照里的 transient
    // `starting` 覆盖 store 中已落定的终态。其余情况取快照值（它是新鲜全量）。
    const incoming = (event.payload.servers ?? []) as any[];
    set((state: any) => {
      const prevById = new Map(state.mcpServers.map((s: any) => [s.id, s]));
      const merged = incoming.map((next) => {
        const prev = prevById.get(next.id) as any;
        if (prev && next.status === "starting" && prev.status !== "starting") {
          // 保留已落定的状态/工具/错误，不被过期快照打回 starting
          return { ...next, status: prev.status, tools: prev.tools, errorMessage: prev.errorMessage };
        }
        return next;
      });
      return { mcpServers: merged };
    });
    return true;
  }

  if (type === "mcp.server.updated") {
    set((state: any) => {
      const server = event.payload.server;
      const exists = state.mcpServers.some((s: any) => s.id === server.id);
      if (exists) {
        return { mcpServers: state.mcpServers.map((s: any) => s.id === server.id ? server : s) };
      }
      return { mcpServers: [...state.mcpServers, server] };
    });
    return true;
  }

  if (type === "mcp.server.status") {
    const { serverId, status, error } = event.payload;
    set((state: any) => ({
      // 只改已知 server。status 是半条更新（无完整字段），若乱序早于 list/updated
      // 到达、对应 id 还不存在，则忽略——等带全量字段的事件补齐，避免造无名条目。
      mcpServers: state.mcpServers.map((s: any) =>
        s.id === serverId ? { ...s, status, errorMessage: error } : s,
      ),
    }));
    return true;
  }

  if (type === "mcp.server.deleted") {
    set((state: any) => ({
      mcpServers: state.mcpServers.filter((s: any) => s.id !== event.payload.serverId),
    }));
    return true;
  }

  return false;
}
