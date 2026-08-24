import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, existsSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { PluginService } from "../plugin.service";
import { resolvePluginRoot } from "../plugin.scanners";

let svc: PluginService;
let proj: string;

beforeEach(() => {
  svc = new PluginService();
  proj = mkdtempSync(join(tmpdir(), "scaffold-"));
});
afterEach(() => { rmSync(proj, { recursive: true, force: true }); });

describe("PluginService.scaffold", () => {
  it("生成五类目录 + 示例 + plugin.json + README", () => {
    const r = svc.scaffold({ cwd: proj });
    expect(r.ok).toBe(true);
    expect(r.created).toContain(".claude-plugin/plugin.json");
    expect(r.created).toContain("commands/example.md");
    expect(existsSync(join(proj, ".claude", "skills", "example-skill", "SKILL.md"))).toBe(true);
    expect(existsSync(join(proj, ".claude", "README.md"))).toBe(true);
  });

  it("includeExamples=false 只生成 plugin.json + README + 空目录", () => {
    const r = svc.scaffold({ cwd: proj, includeExamples: false });
    expect(r.created).toContain("README.md");
    expect(r.created).not.toContain("commands/example.md");
    expect(existsSync(join(proj, ".claude", "commands"))).toBe(true); // 空目录仍建
  });

  it("二次 scaffold 跳过已存在文件、不覆盖", () => {
    svc.scaffold({ cwd: proj });
    const r2 = svc.scaffold({ cwd: proj });
    expect(r2.skipped).toContain(".claude-plugin/plugin.json");
    expect(r2.created).toEqual([]);
  });

  it("非法 cwd 返回错误", () => {
    expect(svc.scaffold({ cwd: "relative" }).ok).toBe(false);
  });
});

describe("PluginService.exportProject 往返自洽", () => {
  it("scaffold 后导出的 zip 能被 preflight 重新识别", () => {
    svc.scaffold({ cwd: proj });
    const { zipBuffer, fileName } = svc.exportProject(proj);
    expect(fileName.endsWith(".zip")).toBe(true);
    // 导入到另一个空项目
    const proj2 = mkdtempSync(join(tmpdir(), "reimport-"));
    try {
      const pf = svc.preflight(zipBuffer, "project", proj2);
      expect(pf.counts.commands).toBeGreaterThan(0);
      expect(pf.counts.skills).toBeGreaterThan(0);
      const r = svc.install(zipBuffer, "project", proj2, { overwrite: false });
      expect(r.ok).toBe(true);
      expect(existsSync(join(proj2, ".claude", "commands", "example.md"))).toBe(true);
    } finally { rmSync(proj2, { recursive: true, force: true }); }
  });

  it("无 .claude 时导出抛错", () => {
    const empty = mkdtempSync(join(tmpdir(), "no-claude-"));
    try {
      expect(() => svc.exportProject(empty)).toThrow();
    } finally { rmSync(empty, { recursive: true, force: true }); }
  });
});
