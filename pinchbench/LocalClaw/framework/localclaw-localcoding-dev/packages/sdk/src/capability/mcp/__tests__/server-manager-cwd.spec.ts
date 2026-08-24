/**
 * MCPServerManager spawn cwd 单测：验证启动 stdio MCP Server 时传入干净 cwd
 * （getAgentHomeDir），而非 pnpm monorepo 根 process.cwd()，以规避 npx arborist 崩溃。
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { MCPServerManager } from "../server-manager";
import { StdioTransport } from "../transport/stdio";
import { getAgentHomeDir } from "../../../config/paths";
import type { MCPServerConfig } from "../types";

function makeConfig(): MCPServerConfig {
  return {
    id: "srv-1",
    name: "test-server",
    type: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-github"],
    createdAt: 0,
    updatedAt: 0,
  };
}

describe("MCPServerManager spawn cwd", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("startServer 传入 getAgentHomeDir 作为 cwd，且不等于 process.cwd()", async () => {
    let capturedCwd: string | undefined;
    // spawn 不真正启动进程：捕获 opts 后直接 resolve
    vi.spyOn(StdioTransport.prototype, "spawn").mockImplementation(async function (
      this: StdioTransport,
      opts,
    ) {
      capturedCwd = opts.cwd;
    });
    // tools/list 经 send 拉取，mock 返回空 tools 避免后续真实 IO
    vi.spyOn(StdioTransport.prototype, "send").mockResolvedValue({
      jsonrpc: "2.0",
      id: 1,
      result: { tools: [] },
    });

    const manager = new MCPServerManager();
    await manager.startServer(makeConfig());

    expect(capturedCwd).toBe(getAgentHomeDir());
    expect(capturedCwd).not.toBe(process.cwd());
  });

  it("启动失败（error 态）后再次 startServer 能重新 spawn 重试", async () => {
    const spawnSpy = vi
      .spyOn(StdioTransport.prototype, "spawn")
      .mockRejectedValueOnce(new Error("boom")) // 首次启动失败
      .mockResolvedValueOnce(undefined); // 重试成功
    vi.spyOn(StdioTransport.prototype, "send").mockResolvedValue({
      jsonrpc: "2.0",
      id: 1,
      result: { tools: [] },
    });
    vi.spyOn(StdioTransport.prototype, "close").mockImplementation(() => {});

    const manager = new MCPServerManager();
    const config = makeConfig();

    // 首次：失败 → instance 状态 error 且残留在 map
    await expect(manager.startServer(config)).rejects.toThrow("boom");
    expect(manager.getServer(config.id)?.status).toBe("error");

    // 重试：清理旧 instance 后重新 spawn，不被 has(id) 短路
    await manager.startServer(config);
    expect(spawnSpy).toHaveBeenCalledTimes(2);
    expect(manager.getServer(config.id)?.status).toBe("running");
  });
});
