import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  resolvePluginRoot, readManifest, countResources, autoManifest, walkClaudeFiles,
  scanScripts, readPermissions,
} from "../plugin.scanners";

let base: string;
let bareRoot: string;   // 形态1：直接是 .claude 内容
let nestedRoot: string; // 形态3：<name>/.claude/...

function makeClaude(root: string) {
  mkdirSync(join(root, "commands"), { recursive: true });
  writeFileSync(join(root, "commands", "build.md"), "---\ndescription: b\n---\n");
  writeFileSync(join(root, "commands", "prd.md"), "x");
  mkdirSync(join(root, "agents"), { recursive: true });
  writeFileSync(join(root, "agents", "fw-build.md"), "a");
  mkdirSync(join(root, "skills", "mcu-flash"), { recursive: true });
  writeFileSync(join(root, "skills", "mcu-flash", "SKILL.md"), "---\nname: F\n---\n");
  mkdirSync(join(root, "rules"), { recursive: true });
  writeFileSync(join(root, "rules", "coding.md"), "# rule");
  mkdirSync(join(root, "memories"), { recursive: true });
  writeFileSync(join(root, "memories", "chip.yaml"), "a: 1");
}

beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), "plugin-scan-"));
  bareRoot = join(base, "bare");
  makeClaude(bareRoot);
  writeFileSync(join(bareRoot, ".DS_Store"), "junk");
  mkdirSync(join(bareRoot, "node_modules"), { recursive: true });
  writeFileSync(join(bareRoot, "node_modules", "x.js"), "1");
  writeFileSync(join(bareRoot, "settings.local.json"),
    JSON.stringify({ permissions: { allow: ["Bash(git commit:*)", "Bash(python:*)"] } }));
  writeFileSync(join(bareRoot, "settings.json"),
    JSON.stringify({ permissions: { allow: ["Bash(make:*)"] } }));
  // 脚本：技能内 + 顶层
  mkdirSync(join(bareRoot, "skills", "mcu-flash", "scripts"), { recursive: true });
  writeFileSync(join(bareRoot, "skills", "mcu-flash", "scripts", "flash.sh"), "#!/bin/sh");
  writeFileSync(join(bareRoot, "skills", "mcu-flash", "scripts", "gen.py"), "print(1)");
  // 形态3：pkg/<name>/.claude
  nestedRoot = join(base, "nested");
  makeClaude(join(nestedRoot, "fw-agent", ".claude"));
});

afterAll(() => { rmSync(base, { recursive: true, force: true }); });

describe("resolvePluginRoot", () => {
  it("形态1：目录本身是 .claude 内容", () => {
    expect(resolvePluginRoot(bareRoot)).toBe(bareRoot);
  });
  it("形态3：唯一顶层目录下的 .claude", () => {
    expect(resolvePluginRoot(nestedRoot)).toBe(join(nestedRoot, "fw-agent", ".claude"));
  });
  it("非场景包目录返回 null", () => {
    const empty = join(base, "empty");
    mkdirSync(empty, { recursive: true });
    expect(resolvePluginRoot(empty)).toBeNull();
  });
});

describe("countResources / autoManifest", () => {
  it("统计五类数量", () => {
    const c = countResources(bareRoot);
    expect(c).toEqual({ commands: 2, agents: 1, skills: 1, rules: 1, memories: 1 });
  });
  it("无 manifest 自生成名字与摘要", () => {
    const m = autoManifest("my-pack", countResources(bareRoot));
    expect(m.name).toBe("my-pack");
    expect(m.description).toContain("命令");
  });
});

describe("readManifest", () => {
  it("读 .claude-plugin/plugin.json", () => {
    mkdirSync(join(bareRoot, ".claude-plugin"), { recursive: true });
    writeFileSync(join(bareRoot, ".claude-plugin", "plugin.json"),
      JSON.stringify({ name: "FW", description: "d", version: "1.0" }));
    expect(readManifest(bareRoot)).toMatchObject({ name: "FW", version: "1.0" });
  });
});

describe("walkClaudeFiles", () => {
  it("默认列出文件、跳过 node_modules/.DS_Store/settings.local.json", () => {
    const files = walkClaudeFiles(bareRoot);
    expect(files).toContain("commands/build.md");
    expect(files).toContain("skills/mcu-flash/SKILL.md");
    expect(files.some((f) => f.includes("node_modules"))).toBe(false);
    expect(files).not.toContain(".DS_Store");
    expect(files).not.toContain("settings.local.json");
  });
  it("includeLocalSettings=true 时纳入 settings.local.json", () => {
    const files = walkClaudeFiles(bareRoot, true);
    expect(files).toContain("settings.local.json");
  });
});

describe("scanScripts", () => {
  it("扫出 .sh/.py 脚本并归类、标注所属技能", () => {
    const scripts = scanScripts(bareRoot);
    const byPath = Object.fromEntries(scripts.map((s) => [s.path, s]));
    expect(byPath["skills/mcu-flash/scripts/flash.sh"]).toMatchObject({ type: "sh", skill: "mcu-flash" });
    expect(byPath["skills/mcu-flash/scripts/gen.py"]).toMatchObject({ type: "py", skill: "mcu-flash" });
  });
});

describe("readPermissions", () => {
  it("分别读 settings.json 与 settings.local.json 的 permissions.allow", () => {
    const perms = readPermissions(bareRoot);
    expect(perms.fromSettings).toEqual(["Bash(make:*)"]);
    expect(perms.fromLocal).toContain("Bash(python:*)");
  });
  it("无 settings 时返回空数组", () => {
    expect(readPermissions(join(nestedRoot, "fw-agent", ".claude"))).toEqual({ fromSettings: [], fromLocal: [] });
  });
});
