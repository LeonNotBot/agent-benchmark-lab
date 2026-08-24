import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { configurePaths, __resetPathsForTest } from "../../../config/paths";
import { WorkspaceService } from "../workspace.service";

/**
 * WorkspaceService 单测(重 I/O,用 tmp 目录真实 fs)。
 *
 * 聚焦确定性方法:命令探测 / 目录列举(含安全护栏)/ 文件读取分支 / 打包过滤
 * (尤其 .env 密钥安全过滤)。createProjectInDocuments(写真实 homedir)与
 * serveFile(需 http res)不在此列。
 */

let dir: string;
let svc: WorkspaceService;

function write(rel: string, content = "x"): void {
  const full = join(dir, rel);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content);
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ws-test-"));
  configurePaths({ workspaceRoot: join(dir, "_workspace") });
  svc = new WorkspaceService();
});

afterEach(() => {
  __resetPathsForTest();
  rmSync(dir, { recursive: true, force: true });
});

describe("WorkspaceService — detectCommands", () => {
  it("package.json + pnpm-lock → pnpm run dev/start", () => {
    write("package.json", JSON.stringify({ scripts: { dev: "vite", start: "node ." } }));
    write("pnpm-lock.yaml", "");
    const cmds = svc.detectCommands(dir);
    expect(cmds.map((c) => c.command)).toContain("pnpm run dev");
    expect(cmds.map((c) => c.command)).toContain("pnpm run start");
  });

  it("无 lockfile 默认 npm", () => {
    write("package.json", JSON.stringify({ scripts: { dev: "vite" } }));
    expect(svc.detectCommands(dir)[0].command).toBe("npm run dev");
  });

  it("docker-compose / Makefile 被识别", () => {
    write("docker-compose.yml", "");
    write("Makefile", "all:");
    const cmds = svc.detectCommands(dir).map((c) => c.command);
    expect(cmds).toContain("docker-compose up");
    expect(cmds).toContain("make");
  });

  it("python manage.py → runserver", () => {
    write("manage.py", "");
    expect(svc.detectCommands(dir)[0].command).toBe("python manage.py runserver");
  });

  it("无框架但有 index.html → 兜底 open 命令", () => {
    write("index.html", "<html>");
    const cmds = svc.detectCommands(dir);
    expect(cmds[0].command).toContain("open:");
    expect(cmds[0].command).toContain("index.html");
  });
});

describe("WorkspaceService — listDir", () => {
  it("跳过 node_modules/.git 等;目录在前文件在后,各自按名排序", async () => {
    write("node_modules/x.js");
    write(".git/config");
    write("b.txt");
    write("a.txt");
    mkdirSync(join(dir, "zdir"));
    mkdirSync(join(dir, "adir"));
    const list = await svc.listDir(dir);
    const names = list.map((e) => e.name);
    expect(names).not.toContain("node_modules");
    expect(names).not.toContain(".git");
    // 目录在前(adir,zdir),再文件(a.txt,b.txt)
    expect(names).toEqual(["adir", "zdir", "a.txt", "b.txt"]);
    expect(list.find((e) => e.name === "a.txt")?.isDir).toBe(false);
  });

  it("不存在的目录返回空数组", async () => {
    expect(await svc.listDir(join(dir, "nope"))).toEqual([]);
  });

  it("命中系统黑名单路径返回空(安全护栏)", async () => {
    const blocked = process.platform === "win32" ? "C:\\Windows" : "/etc";
    expect(await svc.listDir(blocked)).toEqual([]);
  });
});

describe("WorkspaceService — readFileContent", () => {
  it("正常文本文件:utf8 + 正确 size", async () => {
    write("a.txt", "hello");
    const r = await svc.readFileContent(join(dir, "a.txt"));
    expect(r.content).toBe("hello");
    expect(r.encoding).toBe("utf8");
    expect(r.size).toBe(5);
  });

  it("不存在文件:占位提示", async () => {
    const r = await svc.readFileContent(join(dir, "nope.txt"));
    expect(r.content).toBe("文件不存在");
  });

  it("含 null byte 的二进制文件:encoding=binary,content 空", async () => {
    writeFileSync(join(dir, "b.bin"), Buffer.from([0x41, 0x00, 0x42]));
    const r = await svc.readFileContent(join(dir, "b.bin"));
    expect(r.encoding).toBe("binary");
    expect(r.content).toBe("");
  });

  it("相对路径基于 cwd 解析", async () => {
    write("sub/c.txt", "rel");
    const r = await svc.readFileContent("sub/c.txt", dir);
    expect(r.content).toBe("rel");
  });
});

describe("WorkspaceService — packDir 过滤(含 .env 安全过滤)", () => {
  it("打包剔除 node_modules/.env/可执行文件,保留源码,返回统计", async () => {
    write("index.html", "<html>");
    write("app.js", "code");
    write("node_modules/dep.js", "dep"); // 依赖目录 → skip
    write(".env", "SECRET=xyz"); // 密钥 → skip(安全)
    write(".env.example", "SECRET="); // 示例 → 保留
    write("tool.exe", "MZ"); // 可执行 → skip
    const res = await svc.packDir(dir);
    expect(res.fileCount).toBeGreaterThanOrEqual(3); // index.html + app.js + .env.example
    expect(res.skipped).toBeGreaterThanOrEqual(2); // .env + tool.exe(node_modules 作为目录另计)
    expect(res.hash).toMatch(/^[0-9a-f]{12}$/);
    // 校验 zip 内容确实不含 .env / node_modules
    const AdmZip = (await import("adm-zip")).default;
    const names = new AdmZip(res.zipPath).getEntries().map((e) => e.entryName);
    expect(names.some((n) => n === ".env")).toBe(false);
    expect(names.some((n) => n.includes("node_modules"))).toBe(false);
    expect(names.some((n) => n === ".env.example")).toBe(true);
  });

  it("不安全路径抛错", async () => {
    const blocked = process.platform === "win32" ? "C:\\Windows" : "/etc";
    await expect(svc.packDir(blocked)).rejects.toThrow(/禁止访问/);
  });
});

describe("WorkspaceService — ensureSessionDir 复用", () => {
  it("同 sessionId(前6位)二次调用复用已有目录,不新建", async () => {
    const sid = "abcdef0123456789";
    const d1 = await svc.ensureSessionDir(sid, "标题一");
    const d2 = await svc.ensureSessionDir(sid, "完全不同的标题");
    expect(d2).toBe(d1); // 按 _<shortId> 后缀匹配复用
  });
});
