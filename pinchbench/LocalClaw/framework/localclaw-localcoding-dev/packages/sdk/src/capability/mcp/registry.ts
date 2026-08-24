/**
 * MCP Tool Registry：全局工具索引。
 * @module @lenovo/agent-sdk / capability / mcp / registry
 * @internal
 */
import type { MCPTool } from "./types";

/**
 * Tool Registry：维护全局 Tool 索引，支持注册 / 搜索 / 解析。
 */
export class MCPToolRegistry {
  /** serverId → tools */
  private byServer = new Map<string, MCPTool[]>();
  /** 全局 toolName → tools[]（可能多 Server 重名） */
  private byName = new Map<string, MCPTool[]>();

  /** 注册某 Server 的全部 Tool（覆盖该 Server 旧索引） */
  register(serverId: string, tools: MCPTool[]): void {
    this.unregister(serverId);
    this.byServer.set(serverId, tools);
    for (const tool of tools) {
      const list = this.byName.get(tool.name) ?? [];
      list.push(tool);
      this.byName.set(tool.name, list);
    }
  }

  /** 注销某 Server 的全部 Tool */
  unregister(serverId: string): void {
    const tools = this.byServer.get(serverId);
    if (!tools) return;
    for (const tool of tools) {
      const list = this.byName.get(tool.name);
      if (!list) continue;
      const filtered = list.filter((t) => t.serverId !== serverId);
      if (filtered.length === 0) this.byName.delete(tool.name);
      else this.byName.set(tool.name, filtered);
    }
    this.byServer.delete(serverId);
  }

  /** 全量 Tool */
  all(): MCPTool[] {
    const out: MCPTool[] = [];
    for (const tools of this.byServer.values()) out.push(...tools);
    return out;
  }

  /** 按名称查找（可能多个） */
  resolve(toolName: string): MCPTool[] {
    return this.byName.get(toolName) ?? [];
  }

  /** 按 Server 查找 */
  byServerId(serverId: string): MCPTool[] {
    return this.byServer.get(serverId) ?? [];
  }

  /**
   * 模糊搜索：匹配 name / description（不区分大小写）。
   */
  search(query: string): MCPTool[] {
    const q = query.trim().toLowerCase();
    if (!q) return this.all();
    return this.all().filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q),
    );
  }

  /** 清空全部 */
  clear(): void {
    this.byServer.clear();
    this.byName.clear();
  }
}
