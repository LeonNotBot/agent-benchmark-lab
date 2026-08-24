import { describe, it, expect } from "vitest";
import type { SkillMeta, MarketSkill } from "@lenovo/agent-protocol";
import { filterAndSortSkills, isMarketItem } from "./skillFilter";

function market(p: Partial<MarketSkill> & { name: string }): MarketSkill {
  return {
    displayName: p.displayName ?? p.name,
    description: p.description ?? "",
    installed: p.installed ?? false,
    ...p,
  } as MarketSkill;
}

function mine(p: Partial<SkillMeta> & { name: string }): SkillMeta {
  return {
    description: p.description ?? "",
    allowedTools: p.allowedTools ?? [],
    userInvocable: p.userInvocable ?? true,
    source: p.source ?? "user",
    ...p,
  } as SkillMeta;
}

describe("isMarketItem", () => {
  it("区分市场项与本地项", () => {
    expect(isMarketItem(market({ name: "a" }))).toBe(true);
    expect(isMarketItem(mine({ name: "b" }))).toBe(false);
  });
});

describe("filterAndSortSkills - 搜索", () => {
  const list = [
    market({ name: "git-helper", displayName: "Git Helper", description: "manage commits" }),
    market({ name: "pdf-tool", displayName: "PDF Tool", description: "read pdf files" }),
  ];

  it("按名称匹配（大小写不敏感）", () => {
    const r = filterAndSortSkills({ list, search: "GIT" });
    expect(r.map((s) => s.name)).toEqual(["git-helper"]);
  });

  it("按描述匹配", () => {
    const r = filterAndSortSkills({ list, search: "pdf" });
    expect(r.map((s) => s.name)).toEqual(["pdf-tool"]);
  });

  it("无匹配返回空", () => {
    expect(filterAndSortSkills({ list, search: "zzz" })).toHaveLength(0);
  });

  it("不修改入参原数组", () => {
    const copy = [...list];
    filterAndSortSkills({ list, search: "git", sort: "热门" });
    expect(list).toEqual(copy);
  });
});

describe("filterAndSortSkills - 分类/来源过滤", () => {
  it("按 tag 分类过滤", () => {
    const list = [
      market({ name: "a", tags: ["dev"] }),
      market({ name: "b", tags: ["writing"] }),
    ];
    const r = filterAndSortSkills({ list, categoryFilter: "writing" });
    expect(r.map((s) => s.name)).toEqual(["b"]);
  });

  it("按来源过滤本地技能", () => {
    const list = [mine({ name: "a", source: "user" }), mine({ name: "b", source: "builtin" })];
    const r = filterAndSortSkills({ list, sourceFilter: "builtin" });
    expect(r.map((s) => s.name)).toEqual(["b"]);
  });
});

describe("filterAndSortSkills - 排序", () => {
  it("热门：按下载量降序", () => {
    const list = [
      market({ name: "a", downloads: 10 }),
      market({ name: "b", downloads: 99 }),
      market({ name: "c", downloads: 50 }),
    ];
    const r = filterAndSortSkills({ list, sort: "热门" });
    expect(r.map((s) => s.name)).toEqual(["b", "c", "a"]);
  });

  it("最新：按 installedAt 降序", () => {
    const list = [
      mine({ name: "a", installedAt: 100 }),
      mine({ name: "b", installedAt: 300 }),
      mine({ name: "c", installedAt: 200 }),
    ];
    const r = filterAndSortSkills({ list, sort: "最新" });
    expect(r.map((s) => s.name)).toEqual(["b", "c", "a"]);
  });

  it("推荐：官方优先，其次已安装，再按下载量", () => {
    const list = [
      market({ name: "plain", downloads: 5 }),
      market({ name: "official", author: "Team AI", downloads: 1 }),
      market({ name: "installed", downloads: 2 }),
    ];
    const r = filterAndSortSkills({
      list,
      sort: "推荐",
      installedNames: new Set(["installed"]),
    });
    expect(r.map((s) => s.name)).toEqual(["official", "installed", "plain"]);
  });
});
