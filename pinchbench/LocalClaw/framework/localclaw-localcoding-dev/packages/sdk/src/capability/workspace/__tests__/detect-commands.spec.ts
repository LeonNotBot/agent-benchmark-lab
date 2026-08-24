import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { WorkspaceService } from "../workspace.service";

/**
 * WorkspaceService.detectCommands 单测：在临时目录里搭出真实项目结构
 * （package.json / lockfile / docker-compose 等），验证命令探测逻辑，无需 mock fs。
 */
let dir: string;
let svc: WorkspaceService;

function writeJson(rel: string, obj: unknown) {
  writeFileSync(join(dir, rel), JSON.stringify(obj), "utf8");
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ws-detect-"));
  svc = new WorkspaceService();
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("WorkspaceService.detectCommands", () => {
  it("空目录返回空数组", () => {
    expect(svc.detectCommands(dir)).toEqual([]);
  });

  it("识别 package.json 的 dev/start 脚本", () => {
    writeJson("package.json", { scripts: { dev: "vite", build: "tsc" } });
    const cmds = svc.detectCommands(dir);
    expect(cmds.some((c) => c.command.endsWith("run dev"))).toBe(true);
    // build 不在 preferred 列表，不应被列出
    expect(cmds.some((c) => c.command.endsWith("run build"))).toBe(false);
  });

  it("有 pnpm-lock.yaml 时用 pnpm 前缀", () => {
    writeJson("package.json", { scripts: { dev: "vite" } });
    writeFileSync(join(dir, "pnpm-lock.yaml"), "", "utf8");
    expect(svc.detectCommands(dir).some((c) => c.command === "pnpm run dev")).toBe(true);
  });

  it("有 yarn.lock 时用 yarn 前缀", () => {
    writeJson("package.json", { scripts: { start: "node ." } });
    writeFileSync(join(dir, "yarn.lock"), "", "utf8");
    expect(svc.detectCommands(dir).some((c) => c.command === "yarn run start")).toBe(true);
  });

  it("无 lockfile 默认 npm 前缀", () => {
    writeJson("package.json", { scripts: { dev: "x" } });
    expect(svc.detectCommands(dir).some((c) => c.command === "npm run dev")).toBe(true);
  });

  it("package.json 损坏时不抛错", () => {
    writeFileSync(join(dir, "package.json"), "{ not json", "utf8");
    expect(() => svc.detectCommands(dir)).not.toThrow();
  });

  it("跳过 node_modules 等忽略目录里的 package.json", () => {
    mkdirSync(join(dir, "node_modules", "pkg"), { recursive: true });
    writeJson("node_modules/pkg/package.json", { scripts: { dev: "x" } });
    expect(svc.detectCommands(dir)).toEqual([]);
  });
});
