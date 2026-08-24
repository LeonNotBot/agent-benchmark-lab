import { describe, it, expect, beforeEach, afterEach } from "vitest";
import AdmZip from "adm-zip";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { PluginService } from "../plugin.service";

// 构造一个含 .claude 内容的 zip（形态1：根即 .claude 内容）。
function makePluginZip(): Buffer {
  const zip = new AdmZip();
  zip.addFile("commands/build.md", Buffer.from("---\ndescription: 编译\n---\n"));
  zip.addFile("commands/prd.md", Buffer.from("prd"));
  zip.addFile("skills/mcu-flash/SKILL.md", Buffer.from("---\nname: F\n---\n"));
  zip.addFile("skills/mcu-flash/scripts/flash.sh", Buffer.from("#!/bin/sh\n"));
  zip.addFile("settings.local.json", Buffer.from(JSON.stringify({ permissions: { allow: ["danger"] } })));
  return zip.toBuffer();
}

let svc: PluginService;
let projectDir: string;

beforeEach(() => {
  svc = new PluginService();
  projectDir = mkdtempSync(join(tmpdir(), "plugin-proj-"));
});
afterEach(() => { rmSync(projectDir, { recursive: true, force: true }); });

describe("PluginService.preflight", () => {
  it("返回 counts 与自生成 manifest，无冲突时 conflicts 为空，含 audit", () => {
    const pf = svc.preflight(makePluginZip(), "project", projectDir);
    expect(pf.counts.commands).toBe(2);
    expect(pf.counts.skills).toBe(1);
    expect(pf.manifest.name).toBeTruthy();
    expect(pf.conflicts).toEqual([]);
    // 阶段三：audit 字段存在
    expect(pf.audit).toBeDefined();
    expect(Array.isArray(pf.audit.scripts)).toBe(true);
    expect(pf.audit.permissions.fromLocal).toContain("danger");
  });

  it("目标已有同名文件时报告 conflicts", () => {
    mkdirSync(join(projectDir, ".claude", "commands"), { recursive: true });
    writeFileSync(join(projectDir, ".claude", "commands", "build.md"), "old");
    const pf = svc.preflight(makePluginZip(), "project", projectDir);
    expect(pf.conflicts).toContain("commands/build.md");
  });

  it("project scope 缺 cwd 抛错", () => {
    expect(() => svc.preflight(makePluginZip(), "project")).toThrow();
  });
});

describe("PluginService.install", () => {
  it("合并复制到 <cwd>/.claude，跳过 settings.local.json", () => {
    const r = svc.install(makePluginZip(), "project", projectDir, { overwrite: false });
    expect(r.ok).toBe(true);
    expect(existsSync(join(projectDir, ".claude", "commands", "build.md"))).toBe(true);
    expect(existsSync(join(projectDir, ".claude", "skills", "mcu-flash", "SKILL.md"))).toBe(true);
    // 安全：settings.local.json 不被复制
    expect(existsSync(join(projectDir, ".claude", "settings.local.json"))).toBe(false);
    expect(r.installed).toContain("commands/build.md");
  });

  it("overwrite=false 时跳过冲突文件、保留原内容", () => {
    mkdirSync(join(projectDir, ".claude", "commands"), { recursive: true });
    writeFileSync(join(projectDir, ".claude", "commands", "build.md"), "OLD");
    const r = svc.install(makePluginZip(), "project", projectDir, { overwrite: false });
    expect(r.skipped).toContain("commands/build.md");
    expect(readFileSync(join(projectDir, ".claude", "commands", "build.md"), "utf-8")).toBe("OLD");
  });

  it("overwrite=true 时覆盖冲突文件", () => {
    mkdirSync(join(projectDir, ".claude", "commands"), { recursive: true });
    writeFileSync(join(projectDir, ".claude", "commands", "build.md"), "OLD");
    const r = svc.install(makePluginZip(), "project", projectDir, { overwrite: true });
    expect(r.installed).toContain("commands/build.md");
    expect(readFileSync(join(projectDir, ".claude", "commands", "build.md"), "utf-8")).toContain("编译");
  });

  it("includeLocalSettings=true 时导入 settings.local.json（阶段三）", () => {
    const r = svc.install(makePluginZip(), "project", projectDir, { overwrite: false, includeLocalSettings: true });
    expect(r.installed).toContain("settings.local.json");
    expect(existsSync(join(projectDir, ".claude", "settings.local.json"))).toBe(true);
  });
});
