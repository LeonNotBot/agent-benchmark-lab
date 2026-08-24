import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { configurePaths, __resetPathsForTest } from "../../../config/paths";
import {
  parseAllowedTools,
  isToolAllowedBySkill,
  resolveSkillAllowlist,
  META_TOOLS_ALWAYS_ALLOWED,
} from "../skill-allowlist";

describe("parseAllowedTools", () => {
  it("解析流式数组写法 [Bash, Read, Write]", () => {
    const md = `---\nname: x\nallowed-tools: [Bash, Read, Write]\n---\nbody`;
    expect(parseAllowedTools(md)).toEqual(["Bash", "Read", "Write"]);
  });

  it("解析逗号分隔字符串写法", () => {
    const md = `---\nallowed-tools: Bash, Read\n---\n`;
    expect(parseAllowedTools(md)).toEqual(["Bash", "Read"]);
  });

  it("去除引号", () => {
    const md = `---\nallowed-tools: ["Bash", 'Read']\n---\n`;
    expect(parseAllowedTools(md)).toEqual(["Bash", "Read"]);
  });

  it("缺失 allowed-tools → 空数组", () => {
    expect(parseAllowedTools(`---\nname: x\n---\nbody`)).toEqual([]);
  });

  it("无 frontmatter → 空数组", () => {
    expect(parseAllowedTools(`just body, no frontmatter`)).toEqual([]);
  });

  it("空白名单 [] → 空数组", () => {
    expect(parseAllowedTools(`---\nallowed-tools: []\n---\n`)).toEqual([]);
  });
});

describe("isToolAllowedBySkill", () => {
  it("无白名单（null/空）→ 放行一切", () => {
    expect(isToolAllowedBySkill(null, "Bash")).toBe(true);
    expect(isToolAllowedBySkill([], "Bash")).toBe(true);
    expect(isToolAllowedBySkill(undefined, "Bash")).toBe(true);
  });

  it("命中白名单 → 放行", () => {
    expect(isToolAllowedBySkill(["Read"], "Read")).toBe(true);
  });

  it("未命中白名单 → 拒绝", () => {
    expect(isToolAllowedBySkill(["Read"], "Bash")).toBe(false);
    expect(isToolAllowedBySkill(["Read"], "Write")).toBe(false);
  });

  it("元工具永久豁免（即便不在白名单内）", () => {
    for (const t of META_TOOLS_ALWAYS_ALLOWED) {
      expect(isToolAllowedBySkill(["Read"], t)).toBe(true);
    }
  });
});

describe("resolveSkillAllowlist", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "skill-allowlist-"));
    configurePaths({ agentHomeDir: dir });
  });

  afterEach(() => {
    __resetPathsForTest();
    rmSync(dir, { recursive: true, force: true });
  });

  function writeSkill(name: string, frontmatter: string): void {
    const sdir = join(dir, "skills", name);
    mkdirSync(sdir, { recursive: true });
    writeFileSync(join(sdir, "SKILL.md"), `---\n${frontmatter}\n---\nbody`, "utf-8");
  }

  it("声明 allowed-tools → 返回白名单", () => {
    writeSkill("limited", "name: limited\nallowed-tools: [Read]");
    expect(resolveSkillAllowlist("limited")).toEqual(["Read"]);
  });

  it("未声明 allowed-tools → null（不约束）", () => {
    writeSkill("open", "name: open\ndescription: d");
    expect(resolveSkillAllowlist("open")).toBeNull();
  });

  it("空白名单 → null（不约束）", () => {
    writeSkill("empty", "name: empty\nallowed-tools: []");
    expect(resolveSkillAllowlist("empty")).toBeNull();
  });

  it("skill 不存在 → null", () => {
    expect(resolveSkillAllowlist("nope")).toBeNull();
  });

  it("拒绝路径穿越的 skill 名 → null", () => {
    expect(resolveSkillAllowlist("../etc")).toBeNull();
    expect(resolveSkillAllowlist("a/b")).toBeNull();
  });

  it("空名 → null", () => {
    expect(resolveSkillAllowlist("")).toBeNull();
  });
});
