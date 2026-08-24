import { describe, it, expect } from "vitest";
import type { ChannelConfig, ChannelEngine } from "@lenovo/agent-protocol";

describe("ChannelConfig 扩展字段", () => {
  it("engine 字段应支持 golembot/legacy", () => {
    const a: ChannelEngine = "golembot";
    const b: ChannelEngine = "legacy";
    expect([a, b]).toEqual(["golembot", "legacy"]);
  });

  it("ChannelConfig 应允许 engine 与 workspaceDir", () => {
    const cfg: ChannelConfig = {
      id: "x", type: "feishu", name: "n", enabled: true,
      credentials: {}, status: "disconnected",
      createdAt: 0, updatedAt: 0,
      engine: "golembot", workspaceDir: "/work",
    };
    expect(cfg.engine).toBe("golembot");
    expect(cfg.workspaceDir).toBe("/work");
  });
});
