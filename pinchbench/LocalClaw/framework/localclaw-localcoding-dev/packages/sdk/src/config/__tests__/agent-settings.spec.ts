import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  existsSync,
  readFileSync,
  readdirSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { configurePaths, __resetPathsForTest } from "../paths";
import {
  getAgentConfigDir,
  getAgentSettingsPath,
  readAgentSettings,
  writeAgentSettings,
  __resetCorruptBackupForTest,
} from "../agent-settings";

/**
 * agent-settings 公共函数单测。
 * 用 configurePaths 把配置根指向临时目录,走真实文件 I/O。
 */
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "sdk-settings-"));
  configurePaths({ agentHomeDir: dir });
});

afterEach(() => {
  __resetPathsForTest();
  __resetCorruptBackupForTest();
  rmSync(dir, { recursive: true, force: true });
});

describe("agent-settings 路径解析", () => {
  it("getAgentConfigDir 跟随 configurePaths 注入的 agentHomeDir", () => {
    expect(getAgentConfigDir()).toBe(dir);
  });

  it("getAgentSettingsPath = 配置根/settings.json", () => {
    expect(getAgentSettingsPath()).toBe(join(dir, "settings.json"));
  });
});

describe("readAgentSettings", () => {
  it("文件不存在时返回空对象", () => {
    expect(readAgentSettings()).toEqual({});
  });

  it("损坏 JSON 时降级返回空对象,不抛错", () => {
    writeFileSync(join(dir, "settings.json"), "{ not valid json", "utf8");
    expect(readAgentSettings()).toEqual({});
  });

  it("损坏 JSON 时把坏文件改名备份为 settings.corrupt-*.json,内容原样保留", () => {
    const bad = '{ "endpoints": [ , broken';
    writeFileSync(getAgentSettingsPath(), bad, "utf8");

    expect(readAgentSettings()).toEqual({});

    // 原文件已被改名挪走（不再原地存在）→ 下游 read-modify-write 不会盖回坏 {}
    expect(existsSync(getAgentSettingsPath())).toBe(false);

    const backups = readdirSync(dir).filter(
      (f) => f.startsWith("settings.corrupt-") && f.endsWith(".json"),
    );
    expect(backups).toHaveLength(1);
    // 备份内容 == 原始坏内容,现场完整保留供人工修复
    expect(readFileSync(join(dir, backups[0]), "utf8")).toBe(bad);
  });

  it("备份是 rename 而非读默认即覆盖:坏文件挪走后,再次读走「不存在→默认」分支,不重复堆备份", () => {
    writeFileSync(getAgentSettingsPath(), "{{{ broken", "utf8");

    readAgentSettings(); // 第一次:触发备份
    readAgentSettings(); // 第二次:文件已不存在,不应再产生备份
    readAgentSettings();

    const backups = readdirSync(dir).filter(
      (f) => f.startsWith("settings.corrupt-") && f.endsWith(".json"),
    );
    expect(backups).toHaveLength(1);
  });

  it("合法 JSON 不触发备份,正常返回", () => {
    writeFileSync(
      getAgentSettingsPath(),
      JSON.stringify({ env: { A: "1" } }),
      "utf8",
    );
    expect(readAgentSettings()).toEqual({ env: { A: "1" } });
    const backups = readdirSync(dir).filter((f) =>
      f.startsWith("settings.corrupt-"),
    );
    expect(backups).toHaveLength(0);
  });

  it("正常读取已存在配置", () => {
    writeFileSync(
      join(dir, "settings.json"),
      JSON.stringify({ techStack: { ready: true }, env: { A: "1" } }),
      "utf8",
    );
    const s = readAgentSettings();
    expect(s.techStack).toEqual({ ready: true });
    expect(s.env).toEqual({ A: "1" });
  });
});

describe("writeAgentSettings", () => {
  it("写入后可读回(往返一致)", () => {
    writeAgentSettings({ techStack: { ready: true }, mcpServers: { x: {} } });
    expect(existsSync(getAgentSettingsPath())).toBe(true);
    expect(readAgentSettings()).toMatchObject({
      techStack: { ready: true },
      mcpServers: { x: {} },
    });
  });

  it("目录不存在时自动创建父目录", () => {
    const nested = join(dir, "a", "b");
    configurePaths({ agentHomeDir: nested });
    writeAgentSettings({ env: { K: "v" } });
    expect(existsSync(join(nested, "settings.json"))).toBe(true);
  });

  it("写入内容为格式化 JSON(2 空格缩进)", () => {
    writeAgentSettings({ mcpServers: { x: {} } });
    const raw = readFileSync(getAgentSettingsPath(), "utf8");
    expect(raw).toContain('\n  "mcpServers"');
  });
});
