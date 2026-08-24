import { describe, it, expect } from "vitest";
import {
  matchField,
  isValidCron,
  cronMatchesAt,
} from "../cron-match";

describe("matchField — 单字段语法", () => {
  it("通配 *", () => {
    expect(matchField("*", 0, 0)).toBe(true);
    expect(matchField("*", 59, 0)).toBe(true);
  });
  it("单值 / 枚举", () => {
    expect(matchField("5", 5, 0)).toBe(true);
    expect(matchField("5", 6, 0)).toBe(false);
    expect(matchField("1,3,5", 3, 0)).toBe(true);
    expect(matchField("1,3,5", 4, 0)).toBe(false);
  });
  it("范围 a-b（闭区间）", () => {
    // 周字段：1-5 = 周一到周五
    expect(matchField("1-5", 1, 4)).toBe(true);
    expect(matchField("1-5", 5, 4)).toBe(true);
    expect(matchField("1-5", 0, 4)).toBe(false); // 周日
    expect(matchField("1-5", 6, 4)).toBe(false); // 周六
  });
  it("步进 */n（从字段下界起）", () => {
    expect(matchField("*/15", 0, 0)).toBe(true);
    expect(matchField("*/15", 15, 0)).toBe(true);
    expect(matchField("*/15", 30, 0)).toBe(true);
    expect(matchField("*/15", 7, 0)).toBe(false);
  });
  it("范围步进 a-b/n", () => {
    expect(matchField("1-5/2", 1, 4)).toBe(true);
    expect(matchField("1-5/2", 3, 4)).toBe(true);
    expect(matchField("1-5/2", 5, 4)).toBe(true);
    expect(matchField("1-5/2", 2, 4)).toBe(false);
    expect(matchField("1-5/2", 6, 4)).toBe(false);
  });
  it("裸值步进 a/n（到字段上界）", () => {
    // 时字段 max=23：9/3 → 9,12,15,18,21
    expect(matchField("9/3", 9, 1)).toBe(true);
    expect(matchField("9/3", 12, 1)).toBe(true);
    expect(matchField("9/3", 21, 1)).toBe(true);
    expect(matchField("9/3", 10, 1)).toBe(false);
    expect(matchField("9/3", 8, 1)).toBe(false);
  });
  it("越界/非法 piece 不匹配且不抛", () => {
    expect(matchField("99", 99, 0)).toBe(false); // 超过 minute max
    expect(matchField("abc", 5, 0)).toBe(false);
    expect(matchField("5-1", 3, 0)).toBe(false); // lo>hi
  });
});

describe("isValidCron", () => {
  it("合法表达式", () => {
    expect(isValidCron("0 9 * * 1-5")).toBe(true);
    expect(isValidCron("*/15 * * * *")).toBe(true);
    expect(isValidCron("0 9,18 * * *")).toBe(true);
  });
  it("非法：段数 / 越界", () => {
    expect(isValidCron("0 9 * *")).toBe(false);
    expect(isValidCron("0 99 * * *")).toBe(false);
    expect(isValidCron("")).toBe(false);
  });
});

describe("cronMatchesAt", () => {
  it("工作日 9 点匹配", () => {
    // 2026-06-15 是周一
    const mon9 = new Date(2026, 5, 15, 9, 0);
    expect(cronMatchesAt("0 9 * * 1-5", mon9)).toBe(true);
    const sun9 = new Date(2026, 5, 14, 9, 0); // 周日
    expect(cronMatchesAt("0 9 * * 1-5", sun9)).toBe(false);
    const mon10 = new Date(2026, 5, 15, 10, 0);
    expect(cronMatchesAt("0 9 * * 1-5", mon10)).toBe(false);
  });
});
