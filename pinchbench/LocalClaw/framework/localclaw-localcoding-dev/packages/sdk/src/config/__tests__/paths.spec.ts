import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { homedir } from "os";
import { join } from "path";
import {
  configurePaths,
  __resetPathsForTest,
  getProductName,
  getAgentHomeDir,
  getClaudeHomeDir,
  getClaudeJsonPath,
  getClaudeConfigDir,
  getWorkspaceRoot,
  getSkillsDir,
  getTemplatesDir,
  getProjectsDir,
  getChannelsDir,
  getScheduledTasksPath,
  getScheduledTaskHistoryPath,
} from "../paths";

/**
 * config/paths.ts —— SDK 路径唯一真相源(@public)。
 *
 * 核心契约:每个路径的解析优先级 configurePaths() > 环境变量 > homedir 默认值。
 * 这些是纯函数,但读 process.env —— 每个用例后必须还原 env + 清注入态,避免串味。
 */

// 涉及的所有 env key,beforeEach 全部清空,保证从「默认值」基线起测
const ENV_KEYS = [
  "AGENT_PRODUCT",
  "AGENT_CONFIG_DIR",
  "LOCALCLAW_CLAUDE_HOME",
  "CLAUDE_HOME_DIR",
  "CLAUDE_JSON_PATH",
  "AGENT_WORKSPACE_DIR",
];
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = {};
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  __resetPathsForTest();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  __resetPathsForTest();
});

describe("getProductName — 优先级", () => {
  it("默认值:localcoding", () => {
    expect(getProductName()).toBe("localcoding");
  });
  it("环境变量 AGENT_PRODUCT 覆盖默认值", () => {
    process.env.AGENT_PRODUCT = "teamai";
    expect(getProductName()).toBe("teamai");
  });
  it("configurePaths({product}) 优先级最高", () => {
    process.env.AGENT_PRODUCT = "teamai";
    configurePaths({ product: "localcoding" });
    expect(getProductName()).toBe("localcoding");
  });
});

describe("getAgentHomeDir — 优先级", () => {
  it("默认值按产品名派生:~/.localcoding", () => {
    expect(getAgentHomeDir()).toBe(join(homedir(), ".localcoding"));
  });
  it("configurePaths({product}) 改变 agentHome 派生目录", () => {
    configurePaths({ product: "teamai" });
    expect(getAgentHomeDir()).toBe(join(homedir(), ".teamai"));
  });
  it("环境变量 AGENT_CONFIG_DIR 覆盖默认值", () => {
    process.env.AGENT_CONFIG_DIR = "/env/agent";
    expect(getAgentHomeDir()).toBe("/env/agent");
  });
  it("兼容旧 env LOCALCLAW_CLAUDE_HOME(AGENT_CONFIG_DIR 优先于它)", () => {
    process.env.LOCALCLAW_CLAUDE_HOME = "/legacy";
    expect(getAgentHomeDir()).toBe("/legacy");
    process.env.AGENT_CONFIG_DIR = "/env/agent";
    expect(getAgentHomeDir()).toBe("/env/agent");
  });
  it("configurePaths 注入优先级最高,压过环境变量", () => {
    process.env.AGENT_CONFIG_DIR = "/env/agent";
    configurePaths({ agentHomeDir: "/injected" });
    expect(getAgentHomeDir()).toBe("/injected");
  });
});

describe("getClaudeHomeDir / getClaudeJsonPath — 优先级", () => {
  it("默认值:~/.claude 与 ~/.claude.json", () => {
    expect(getClaudeHomeDir()).toBe(join(homedir(), ".claude"));
    expect(getClaudeJsonPath()).toBe(join(homedir(), ".claude.json"));
  });
  it("环境变量覆盖", () => {
    process.env.CLAUDE_HOME_DIR = "/env/claude";
    process.env.CLAUDE_JSON_PATH = "/env/claude.json";
    expect(getClaudeHomeDir()).toBe("/env/claude");
    expect(getClaudeJsonPath()).toBe("/env/claude.json");
  });
  it("configurePaths 注入最高优先", () => {
    process.env.CLAUDE_HOME_DIR = "/env/claude";
    configurePaths({ claudeHomeDir: "/inj/claude", claudeJsonPath: "/inj/claude.json" });
    expect(getClaudeHomeDir()).toBe("/inj/claude");
    expect(getClaudeJsonPath()).toBe("/inj/claude.json");
  });
});

describe("getClaudeConfigDir — 回落到 agentHome", () => {
  it("未注入未设 env 时回落到 getAgentHomeDir()", () => {
    expect(getClaudeConfigDir()).toBe(getAgentHomeDir());
    configurePaths({ agentHomeDir: "/inj/agent" });
    expect(getClaudeConfigDir()).toBe("/inj/agent"); // 跟随 agentHome
  });
  it("LOCALCLAW_CLAUDE_HOME 优先于 agentHome 回落", () => {
    configurePaths({ agentHomeDir: "/inj/agent" });
    process.env.LOCALCLAW_CLAUDE_HOME = "/env/cli";
    expect(getClaudeConfigDir()).toBe("/env/cli");
  });
  it("claudeConfigDir 显式注入最高优先", () => {
    process.env.LOCALCLAW_CLAUDE_HOME = "/env/cli";
    configurePaths({ claudeConfigDir: "/inj/cli" });
    expect(getClaudeConfigDir()).toBe("/inj/cli");
  });
});

describe("getWorkspaceRoot 与派生路径", () => {
  it("workspace 默认值按产品名派生与 env 覆盖", () => {
    expect(getWorkspaceRoot()).toBe(join(homedir(), "localcoding-workspace"));
    process.env.AGENT_WORKSPACE_DIR = "/env/ws";
    expect(getWorkspaceRoot()).toBe("/env/ws");
  });
  it("定时任务派生路径跟随 agentHome 注入变化", () => {
    configurePaths({ agentHomeDir: "/inj/agent" });
    expect(getScheduledTasksPath()).toBe(join("/inj/agent", "scheduled_tasks.json"));
    expect(getScheduledTaskHistoryPath()).toBe(
      join("/inj/agent", "scheduled_task_history.json"),
    );
  });
});

describe("configurePaths — 累积合并", () => {
  it("多次调用只覆盖传入字段,其余保持", () => {
    configurePaths({ agentHomeDir: "/a" });
    configurePaths({ workspaceRoot: "/w" });
    expect(getAgentHomeDir()).toBe("/a"); // 第一次的仍在
    expect(getWorkspaceRoot()).toBe("/w");
  });
});

describe("派生目录 getter — 跟随 agentHome", () => {
  it("默认按产品名派生到 ~/.localcoding 下", () => {
    const home = join(homedir(), ".localcoding");
    expect(getSkillsDir()).toBe(join(home, "skills"));
    expect(getTemplatesDir()).toBe(join(home, "templates"));
    expect(getProjectsDir()).toBe(join(home, "projects"));
    expect(getChannelsDir()).toBe(join(home, "channels"));
  });
  it("跟随 configurePaths({product}) 派生", () => {
    configurePaths({ product: "teamai" });
    const home = join(homedir(), ".teamai");
    expect(getSkillsDir()).toBe(join(home, "skills"));
    expect(getChannelsDir()).toBe(join(home, "channels"));
  });
  it("跟随显式 agentHomeDir 注入（优先级高于产品名）", () => {
    configurePaths({ product: "teamai", agentHomeDir: "/inj/agent" });
    expect(getSkillsDir()).toBe(join("/inj/agent", "skills"));
    expect(getTemplatesDir()).toBe(join("/inj/agent", "templates"));
    expect(getProjectsDir()).toBe(join("/inj/agent", "projects"));
    expect(getChannelsDir()).toBe(join("/inj/agent", "channels"));
  });
});
