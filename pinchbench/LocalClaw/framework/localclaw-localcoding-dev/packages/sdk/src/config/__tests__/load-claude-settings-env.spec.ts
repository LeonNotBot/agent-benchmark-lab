import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { configurePaths, __resetPathsForTest } from "../paths";
import { loadClaudeSettingsEnv } from "../claude-settings";
import { readAgentSettings } from "../agent-settings";

/**
 * loadClaudeSettingsEnv 单测。
 *
 * 有副作用(向 process.env 注入),需隔离:
 * tmp 目录作配置根 + 每个用例后还原本测涉及的 env 键。
 */

const TOUCHED = [
  "API_TIMEOUT_MS",
];
let dir: string;
let saved: Record<string, string | undefined>;

function writeSettings(obj: unknown): void {
  writeFileSync(join(dir, "settings.json"), JSON.stringify(obj), "utf8");
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "claude-env-"));
  configurePaths({ agentHomeDir: dir });
  saved = {};
  for (const k of TOUCHED) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  __resetPathsForTest();
  for (const k of TOUCHED) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  rmSync(dir, { recursive: true, force: true });
});

describe("loadClaudeSettingsEnv", () => {
  it("无配置文件时返回 11 个键的空字符串 snapshot,不抛错", () => {
    const env = loadClaudeSettingsEnv();
    expect(env.ANTHROPIC_MODEL).toBe("");
    expect(env.API_TIMEOUT_MS).toBe("");
  });

  it("把 settings.env 注入 process.env 并反映到返回 snapshot", () => {
    writeSettings({ env: { API_TIMEOUT_MS: "3000" } });
    const env = loadClaudeSettingsEnv();
    expect(process.env.API_TIMEOUT_MS).toBe("3000");
    expect(env.API_TIMEOUT_MS).toBe("3000");
  });

  it("不覆盖已存在的 process.env(已有值优先)", () => {
    process.env.API_TIMEOUT_MS = "9999";
    writeSettings({ env: { API_TIMEOUT_MS: "3000" } });
    loadClaudeSettingsEnv();
    expect(process.env.API_TIMEOUT_MS).toBe("9999"); // 不被配置覆盖
  });
});
