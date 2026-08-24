/**
 * McpAgentRegistrarService 单测：用临时目录隔离 .claude.json，
 * 验证配置映射、托管键增删改、保留非托管键（cron-tools）、跨重启清理、
 * 以及清理历史误写入 settings.json 的托管键。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, writeFileSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { EventEmitter } from "events";
import type { MCPServer } from "@lenovo/agent-sdk";
import { McpAgentRegistrarService } from "../mcp-agent-registrar.service";
import type { McpService } from "../mcp.service";
import type { McpGatewayBridge } from "../mcp-bridge";

function makeServer(p: Partial<MCPServer> & Pick<MCPServer, "id" | "name" | "type">): MCPServer {
  return {
    description: undefined,
    status: "stopped",
    tools: [],
    createdAt: 0,
    updatedAt: 0,
    ...p,
  } as MCPServer;
}

describe("McpAgentRegistrarService", () => {
  let dir: string;
  let prevEnv: string | undefined;
  let servers: MCPServer[];
  let service: McpService;
  let bridge: McpGatewayBridge;
  let registrar: McpAgentRegistrarService;

  function readSettings(): Record<string, unknown> {
    const p = join(dir, ".claude.json");
    return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : {};
  }

  function readRawSettings(): Record<string, unknown> {
    const p = join(dir, "settings.json");
    return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : {};
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "mcp-agent-reg-"));
    prevEnv = process.env.AGENT_CONFIG_DIR;
    process.env.AGENT_CONFIG_DIR = dir;
    servers = [];
    service = { listServers: () => servers } as unknown as McpService;
    bridge = new EventEmitter() as unknown as McpGatewayBridge;
    registrar = new McpAgentRegistrarService(service, bridge);
  });

  afterEach(() => {
    if (prevEnv === undefined) delete process.env.AGENT_CONFIG_DIR;
    else process.env.AGENT_CONFIG_DIR = prevEnv;
    rmSync(dir, { recursive: true, force: true });
  });

  it("映射 stdio server（含 args/env）", () => {
    servers = [
      makeServer({
        id: "a1b2c3d4",
        name: "filesystem",
        type: "stdio",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-filesystem"],
        env: { ROOT: "/tmp" },
      }),
    ];
    registrar.syncAll();
    const s = readSettings();
    expect((s.mcpServers as Record<string, unknown>).filesystem).toEqual({
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem"],
      env: { ROOT: "/tmp" },
    });
    expect(s.mcpServersManaged).toEqual(["filesystem"]);
  });

  it("映射 sse / streamable_http server", () => {
    servers = [
      makeServer({ id: "s1", name: "sse-srv", type: "sse", url: "https://x/sse", headers: { A: "1" } }),
      makeServer({ id: "h1", name: "http-srv", type: "streamable_http", url: "https://x/mcp" }),
    ];
    registrar.syncAll();
    const m = readSettings().mcpServers as Record<string, unknown>;
    expect(m["sse-srv"]).toEqual({ type: "sse", url: "https://x/sse", headers: { A: "1" } });
    expect(m["http-srv"]).toEqual({ type: "http", url: "https://x/mcp" });
  });

  it("跳过缺必需字段的 server", () => {
    servers = [
      makeServer({ id: "bad1", name: "no-cmd", type: "stdio" }),
      makeServer({ id: "bad2", name: "no-url", type: "sse" }),
    ];
    registrar.syncAll();
    const s = readSettings();
    expect(s.mcpServers).toEqual({});
    expect(s.mcpServersManaged).toEqual([]);
  });

  it("保留非托管键（cron-tools）", () => {
    writeFileSync(
      join(dir, ".claude.json"),
      JSON.stringify({ mcpServers: { "cron-tools": { command: "node", args: ["x.mjs"] } } }),
    );
    servers = [makeServer({ id: "g1", name: "github", type: "stdio", command: "npx" })];
    registrar.syncAll();
    const m = readSettings().mcpServers as Record<string, unknown>;
    expect(m["cron-tools"]).toEqual({ command: "node", args: ["x.mjs"] });
    expect(m.github).toEqual({ command: "npx" });
  });

  it("删除 server 后清理对应托管键（保留 cron-tools）", () => {
    writeFileSync(
      join(dir, ".claude.json"),
      JSON.stringify({ mcpServers: { "cron-tools": { command: "node" } } }),
    );
    servers = [makeServer({ id: "g1", name: "github", type: "stdio", command: "npx" })];
    registrar.syncAll();
    expect((readSettings().mcpServers as Record<string, unknown>).github).toBeDefined();

    servers = [];
    registrar.syncAll();
    const s = readSettings();
    expect((s.mcpServers as Record<string, unknown>).github).toBeUndefined();
    expect((s.mcpServers as Record<string, unknown>)["cron-tools"]).toEqual({ command: "node" });
    expect(s.mcpServersManaged).toEqual([]);
  });

  it("重命名 server 不残留旧键", () => {
    servers = [makeServer({ id: "g1", name: "old-name", type: "stdio", command: "npx" })];
    registrar.syncAll();
    servers = [makeServer({ id: "g1", name: "new-name", type: "stdio", command: "npx" })];
    registrar.syncAll();
    const m = readSettings().mcpServers as Record<string, unknown>;
    expect(m["old-name"]).toBeUndefined();
    expect(m["new-name"]).toEqual({ command: "npx" });
  });

  it("sanitize 名称中的非法字符", () => {
    servers = [makeServer({ id: "x1", name: "My Server!@#", type: "stdio", command: "npx" })];
    registrar.syncAll();
    const m = readSettings().mcpServers as Record<string, unknown>;
    expect(Object.keys(m)).toEqual(["My_Server___"]);
  });

  it("名称冲突时追加 id 片段去重", () => {
    servers = [
      makeServer({ id: "aaaaaa11", name: "dup", type: "stdio", command: "a" }),
      makeServer({ id: "bbbbbb22", name: "dup", type: "stdio", command: "b" }),
    ];
    registrar.syncAll();
    const m = readSettings().mcpServers as Record<string, unknown>;
    expect(m.dup).toEqual({ command: "a" });
    expect(m["dup-bbbbbb"]).toEqual({ command: "b" });
  });

  it("onModuleInit 订阅事件，事件触发重同步", () => {
    registrar.onModuleInit();
    expect(readSettings().mcpServersManaged).toEqual([]);
    servers = [makeServer({ id: "g1", name: "github", type: "stdio", command: "npx" })];
    (bridge as unknown as EventEmitter).emit("mcp.server.updated", {});
    expect((readSettings().mcpServers as Record<string, unknown>).github).toBeDefined();
    registrar.onModuleDestroy();
  });

  it("清理历史误写入 settings.json 的托管键（保留其它字段）", () => {
    // 模拟旧版本：MCP 托管键残留在 settings.json
    writeFileSync(
      join(dir, "settings.json"),
      JSON.stringify({
        env: { FOO: "bar" },
        mcpServers: { github: { command: "npx" }, "cron-tools": { command: "node" } },
        mcpServersManaged: ["github"],
      }),
    );
    servers = [makeServer({ id: "g1", name: "github", type: "stdio", command: "npx" })];
    registrar.syncAll();

    // .claude.json 是配置真源
    expect((readSettings().mcpServers as Record<string, unknown>).github).toEqual({ command: "npx" });
    expect(readSettings().mcpServersManaged).toEqual(["github"]);

    // settings.json：旧托管键 github 被清理，mcpServersManaged 移除，其它字段与非托管键保留
    const raw = readRawSettings();
    expect((raw.mcpServers as Record<string, unknown>).github).toBeUndefined();
    expect((raw.mcpServers as Record<string, unknown>)["cron-tools"]).toEqual({ command: "node" });
    expect(raw.mcpServersManaged).toBeUndefined();
    expect(raw.env).toEqual({ FOO: "bar" });
  });
});
