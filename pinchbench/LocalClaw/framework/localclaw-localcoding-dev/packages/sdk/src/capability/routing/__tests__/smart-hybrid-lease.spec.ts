/**
 * SmartHybridService CLAUDE.md 注入租约语义测试
 *
 * 核心不变式：
 *   acquire(cwd, sessionId) 幂等 — 同一 session 多次调用不重写文件。
 *   Set 语义 — 多 session 共享 cwd，最后一个释放才 cleanup。
 *   releaseIfHeld — SH→单模型切换，cleanup 并清空 Map。
 */
import { existsSync, mkdirSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SmartHybridService } from "../smart-hybrid.service";

const MARKER_START = "<!-- localclaw:critical-task-routing -->";
const MARKER_END = "<!-- /localclaw:critical-task-routing -->";

function makeService(): SmartHybridService {
  const svc = new SmartHybridService();
  svc.configure({
    defaultModel: { endpointId: "ep_base", model: "base-model" },
    upgradeModel: { endpointId: "ep_upgrade", model: "upgrade-model" },
  });
  return svc;
}

function hasBlock(dir: string): boolean {
  const p = join(dir, "CLAUDE.md");
  if (!existsSync(p)) return false;
  const content = readFileSync(p, "utf8");
  return content.includes(MARKER_START) && content.includes(MARKER_END);
}

let tmpDirs: string[] = [];

function makeTmpDir(): string {
  const dir = join(tmpdir(), `sh-lease-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const d of tmpDirs) {
    try { rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
  }
  tmpDirs = [];
});

describe("SmartHybridService 租约语义", () => {
  it("首次 acquire 写入注入块", () => {
    const svc = makeService();
    const cwd = makeTmpDir();
    svc.prepareSessionCwd(cwd, "sess-1");
    expect(hasBlock(cwd)).toBe(true);
  });

  it("同一 session 重复 acquire 不重写文件（消除 respawn churn）", () => {
    const svc = makeService();
    const cwd = makeTmpDir();

    svc.prepareSessionCwd(cwd, "sess-1");
    // 读取首次写入后的内容
    const contentAfterFirst = readFileSync(join(cwd, "CLAUDE.md"), "utf8");

    // 模拟 respawn：同 session 再次 acquire
    svc.prepareSessionCwd(cwd, "sess-1");
    const contentAfterSecond = readFileSync(join(cwd, "CLAUDE.md"), "utf8");

    expect(contentAfterSecond).toBe(contentAfterFirst); // 文件内容未变化
    expect(hasBlock(cwd)).toBe(true);
  });

  it("释放唯一 session 后 cleanup 注入块", () => {
    const svc = makeService();
    const cwd = makeTmpDir();

    svc.prepareSessionCwd(cwd, "sess-1");
    expect(hasBlock(cwd)).toBe(true);

    svc.releaseIfHeld("sess-1");
    expect(hasBlock(cwd)).toBe(false);
  });

  it("两 session 共享 cwd：前者释放不 cleanup，最后一个释放才 cleanup", () => {
    const svc = makeService();
    const cwd = makeTmpDir();

    svc.prepareSessionCwd(cwd, "sess-A");
    svc.prepareSessionCwd(cwd, "sess-B");
    expect(hasBlock(cwd)).toBe(true);

    svc.releaseIfHeld("sess-A");
    expect(hasBlock(cwd)).toBe(true); // B 还持有，不应 cleanup

    svc.releaseIfHeld("sess-B");
    expect(hasBlock(cwd)).toBe(false); // 最后一个释放，cleanup
  });

  it("releaseIfHeld 对未持有租约的 session 幂等（不报错）", () => {
    const svc = makeService();
    expect(() => svc.releaseIfHeld("ghost-session")).not.toThrow();
  });

  it("releaseAll 清理所有 cwd 的注入块", () => {
    const svc = makeService();
    const cwd1 = makeTmpDir();
    const cwd2 = makeTmpDir();

    svc.prepareSessionCwd(cwd1, "sess-X");
    svc.prepareSessionCwd(cwd2, "sess-Y");
    expect(hasBlock(cwd1)).toBe(true);
    expect(hasBlock(cwd2)).toBe(true);

    svc.releaseAll();
    expect(hasBlock(cwd1)).toBe(false);
    expect(hasBlock(cwd2)).toBe(false);
  });

  it("session 迁移 cwd：旧 cwd 被清理，新 cwd 被注入", () => {
    const svc = makeService();
    const cwdOld = makeTmpDir();
    const cwdNew = makeTmpDir();

    svc.prepareSessionCwd(cwdOld, "sess-1");
    expect(hasBlock(cwdOld)).toBe(true);

    // session 换目录
    svc.prepareSessionCwd(cwdNew, "sess-1");
    expect(hasBlock(cwdOld)).toBe(false); // 旧 cwd 被释放
    expect(hasBlock(cwdNew)).toBe(true);  // 新 cwd 被注入
  });
});
