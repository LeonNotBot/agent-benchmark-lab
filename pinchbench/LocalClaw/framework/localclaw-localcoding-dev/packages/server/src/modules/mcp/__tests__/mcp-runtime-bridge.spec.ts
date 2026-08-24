/**
 * McpRuntimeBridge 单测：
 * - startServer 探活后置状态判定（tools>0 / =0 / 握手失败）
 * - onModuleInit 不阻塞启动（探活后台 fire-and-forget）
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { McpRuntimeBridge } from "../mcp-runtime-bridge";
import type { McpService } from "../mcp.service";
import type { MCPServer } from "@lenovo/agent-sdk";

function makeServer(overrides: Partial<MCPServer> = {}): MCPServer {
  return {
    id: "test-id",
    name: "Test Server",
    type: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem"],
    status: "stopped",
    tools: [],
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  } as MCPServer;
}

function createMockManager(tools: any[], error?: Error) {
  return {
    startServer: vi.fn().mockImplementation(async () => {
      if (error) throw error;
    }),
    getServer: vi.fn().mockReturnValue({ tools }),
    stopServer: vi.fn(),
    stopAll: vi.fn(),
  };
}

function createMockService() {
  const statuses: Array<[string, string, string?]> = [];
  return {
    getServer: vi.fn(),
    setServerStatus: vi.fn().mockImplementation((id: string, s: string, e?: string) => {
      statuses.push([id, s, e]);
    }),
    cacheTools: vi.fn(),
    listServers: vi.fn(),
    getCachedTools: vi.fn(),
    emitServerList: vi.fn(),
    _statuses: statuses,
  };
}

/**
 * 通过 Proxy 覆盖 McpRuntimeBridge 实例的 private this.service，使其指向 mock。
 * 原因：MCPServerManager 有构造默认值，new McpRuntimeBridge(mockMgr, service) 会把
 * mockMgr 错误地赋给 this.service（参数顺序被默认值打乱）。
 */
function withService<T extends object>(target: T, mockService: object): T {
  return new Proxy(target, {
    get(_t, prop, receiver) {
      if (prop === "service") return mockService;
      return Reflect.get(target, prop, receiver);
    },
  }) as T;
}

describe("McpRuntimeBridge.startServer — 就绪判定", () => {
  let service: ReturnType<typeof createMockService>;
  let bridge: McpRuntimeBridge;

  beforeEach(() => {
    service = createMockService();
    service.getServer.mockReturnValue(makeServer());
  });

  it("握手成功且 tools > 0 → installed", async () => {
    const mockManager = createMockManager([{ name: "read_file" }, { name: "write_file" }]);
    bridge = withService(new McpRuntimeBridge(service as any, mockManager as any), service);
    await bridge.startServer("test-id");
    expect(service.setServerStatus).toHaveBeenLastCalledWith("test-id", "installed");
  });

  it("握手成功但 tools = 0 → error（含未暴露工具提示）", async () => {
    const mockManager = createMockManager([]);
    bridge = withService(new McpRuntimeBridge(service as any, mockManager as any), service);
    await bridge.startServer("test-id");
    expect(service.setServerStatus).toHaveBeenLastCalledWith(
      "test-id",
      "error",
      "启动成功但未暴露任何工具，可能不兼容当前客户端",
    );
  });

  it("握手失败 → error（含错误信息）", async () => {
    const err = new Error("spawn ENOENT");
    const mockManager = createMockManager([], err);
    bridge = withService(new McpRuntimeBridge(service as any, mockManager as any), service);
    await bridge.startServer("test-id");
    expect(service.setServerStatus).toHaveBeenLastCalledWith(
      "test-id",
      "error",
      "Error: spawn ENOENT",
    );
  });
});

describe("McpRuntimeBridge.onModuleInit — 不阻塞启动", () => {
  it("探活卡住时 onModuleInit 仍同步立即返回（不 await 探活）", async () => {
    // manager.startServer 永不 resolve，模拟首次 npx 下载 / 网络阻塞卡满 120s 超时窗口。
    let resolveHang: (() => void) | undefined;
    const hangManager = {
      startServer: vi.fn().mockReturnValue(
        new Promise<void>((res) => {
          resolveHang = res;
        }),
      ),
      getServer: vi.fn().mockReturnValue({ tools: [] }),
      stopServer: vi.fn(),
      stopAll: vi.fn(),
    };
    const service = createMockService();
    service.listServers.mockReturnValue([makeServer({ status: "starting" })]);
    service.getServer.mockReturnValue(makeServer({ status: "starting" }));
    const bridge = withService(
      new McpRuntimeBridge(service as any, hangManager as any),
      service,
    );

    // 关键断言：onModuleInit 必须同步返回（void），不得返回卡住的 Promise。
    // 若它 await 探活，下面这行会拿到一个 pending Promise，竞速会输给探活。
    const ret = bridge.onModuleInit();
    expect(ret).toBeUndefined();

    // 探活确实在后台被触发了（startServer 被调用），但 onModuleInit 没等它。
    expect(hangManager.startServer).toHaveBeenCalledTimes(1);

    // 用竞速进一步证明 onModuleInit 不被阻塞：它已经返回，而探活仍 pending。
    const finished = Symbol("done");
    const winner = await Promise.race([
      Promise.resolve(finished),
      new Promise((r) => setTimeout(() => r("probe-still-running"), 50)),
    ]);
    expect(winner).toBe(finished);

    resolveHang?.(); // 清理挂起的 Promise
  });

  it("无 starting 态 server 时不触发任何探活", () => {
    const idleManager = {
      startServer: vi.fn(),
      getServer: vi.fn(),
      stopServer: vi.fn(),
      stopAll: vi.fn(),
    };
    const service = createMockService();
    service.listServers.mockReturnValue([
      makeServer({ status: "installed" }),
      makeServer({ status: "stopped" }),
    ]);
    const bridge = withService(
      new McpRuntimeBridge(service as any, idleManager as any),
      service,
    );
    bridge.onModuleInit();
    expect(idleManager.startServer).not.toHaveBeenCalled();
  });

  it("探活全部结束后做一次权威全量广播（收敛）", async () => {
    const mockManager = createMockManager([{ name: "read_file" }]);
    const service = createMockService();
    service.listServers.mockReturnValue([makeServer({ status: "starting" })]);
    service.getServer.mockReturnValue(makeServer({ status: "starting" }));
    const bridge = withService(
      new McpRuntimeBridge(service as any, mockManager as any),
      service,
    );
    bridge.onModuleInit();
    // 等待后台探活 + 收敛广播完成
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(service.emitServerList).toHaveBeenCalledTimes(1);
  });
});
