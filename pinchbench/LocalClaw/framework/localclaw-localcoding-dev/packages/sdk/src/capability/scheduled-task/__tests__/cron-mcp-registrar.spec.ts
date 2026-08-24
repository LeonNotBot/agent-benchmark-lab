import { describe, it, expect } from "vitest";
import { normalizeAsarPath } from "../cron-mcp-registrar.service";

describe("normalizeAsarPath", () => {
  it("把 Windows asar 路径重写为 unpacked（核心根因修复）", () => {
    const input = "C:\\app\\resources\\app.asar\\dist-server\\mcp-servers\\cron-tools.mjs";
    expect(normalizeAsarPath(input)).toBe(
      "C:\\app\\resources\\app.asar.unpacked\\dist-server\\mcp-servers\\cron-tools.mjs",
    );
  });

  it("把 POSIX asar 路径重写为 unpacked", () => {
    const input = "/opt/app/resources/app.asar/dist-server/node_modules";
    expect(normalizeAsarPath(input)).toBe(
      "/opt/app/resources/app.asar.unpacked/dist-server/node_modules",
    );
  });

  it("非 asar 路径（开发机）原样返回，行为不变", () => {
    const dev = "D:\\lenovo-code\\localclaw\\dist-server\\mcp-servers\\cron-tools.mjs";
    expect(normalizeAsarPath(dev)).toBe(dev);
  });

  it("已是 unpacked 路径时幂等，不重复替换", () => {
    const already = "/opt/app/resources/app.asar.unpacked/dist-server/node_modules";
    expect(normalizeAsarPath(already)).toBe(already);
  });

  it("只重写真正的 asar 段，不误伤同名子串", () => {
    // app.asar 作为目录名出现，必须带分隔符边界才替换
    const input = "/opt/app.asar/foo";
    expect(normalizeAsarPath(input)).toBe("/opt/app.asar.unpacked/foo");
  });
});
