import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { tmpdir } from "os";
import { join } from "path";
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "fs";

// 每个用例用独立临时目录，避免相互污染。getClaudeJsonPath 指向不存在的路径，
// 使 ensureClaudeJson 走空 MCP 分支，不干扰 CLAUDE.md 验证。
const TEST_DIR = join(tmpdir(), "localclaw-langconstraint-test");
vi.mock("../../../config/paths", () => ({
  getClaudeConfigDir: () => TEST_DIR,
  getClaudeJsonPath: () => join(TEST_DIR, "__nonexistent_global.json"),
}));

import { ensureClaudeConfigDir } from "../claude-config-dir";

const V2_MARK = "<!-- local-claw:language-constraint:v2 -->";
const claudeMd = () => join(TEST_DIR, "CLAUDE.md");
const read = () => readFileSync(claudeMd(), "utf8");
const markCount = (s: string) => (s.match(/local-claw:language-constraint:v\d+/g) ?? []).length;

describe("ensureLanguageConstraint", () => {
  beforeEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
    mkdirSync(TEST_DIR, { recursive: true });
  });
  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("CLAUDE.md 不存在时创建并写入 v2 块", () => {
    ensureClaudeConfigDir();
    expect(existsSync(claudeMd())).toBe(true);
    const c = read();
    expect(c).toContain(V2_MARK);
    expect(c).toContain("始终使用用户当前提问所用的语言");
    expect(markCount(c)).toBe(1);
  });

  it("已有 v1 旧中文块时原地升级为 v2，旧中文消失、用户内容保留", () => {
    const v1 = [
      "# 我的项目",
      "保留这段用户自定义内容。",
      "",
      "<!-- local-claw:language-constraint:v1 -->",
      "## 语言约束",
      "- 使用中文与用户交流。",
      "- 禁止在回复中出现英文，除非用户明确使用英文提问。",
      "<!-- /local-claw:language-constraint -->",
      "",
    ].join("\n");
    writeFileSync(claudeMd(), v1, "utf8");

    ensureClaudeConfigDir();
    const c = read();
    expect(c).toContain(V2_MARK);
    expect(c).not.toContain("禁止在回复中出现英文");
    expect(c).not.toContain("v1 -->");
    expect(c).toContain("保留这段用户自定义内容");
    expect(markCount(c)).toBe(1); // 不产生重复块
  });

  it("已是 v2 时幂等跳过，内容完全不变", () => {
    ensureClaudeConfigDir();
    const first = read();
    ensureClaudeConfigDir();
    expect(read()).toBe(first);
  });

  it("已有内容但无任何约束块时追加到末尾", () => {
    writeFileSync(claudeMd(), "# 纯净文件\n只有用户内容。\n", "utf8");
    ensureClaudeConfigDir();
    const c = read();
    expect(c).toContain("只有用户内容");
    expect(c).toContain(V2_MARK);
    expect(c.trimEnd().endsWith("<!-- /local-claw:language-constraint -->")).toBe(true);
    expect(markCount(c)).toBe(1);
  });
});
