import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { ProjectCapabilityService } from "../project-capability.service";

let root: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "projcap-svc-"));
  mkdirSync(join(root, ".claude", "commands"), { recursive: true });
  writeFileSync(join(root, ".claude", "commands", "build.md"), "---\ndescription: b\n---\nx");
});

afterAll(() => { rmSync(root, { recursive: true, force: true }); });

describe("ProjectCapabilityService.scan", () => {
  it("非绝对路径 / 不存在的 cwd 返回空聚合", () => {
    const svc = new ProjectCapabilityService();
    expect(svc.scan("relative/path").commands).toEqual([]);
    expect(svc.scan(join(root, "does-not-exist")).commands).toEqual([]);
  });

  it("扫出真实 .claude 命令，并带回 cwd", () => {
    const svc = new ProjectCapabilityService();
    const caps = svc.scan(root);
    expect(caps.cwd).toBe(root);
    expect(caps.commands.map((c) => c.name)).toEqual(["build"]);
  });

  it("同一 cwd 命中缓存返回同一引用", () => {
    const svc = new ProjectCapabilityService();
    const a = svc.scan(root);
    const b = svc.scan(root);
    expect(a).toBe(b);
  });
});
