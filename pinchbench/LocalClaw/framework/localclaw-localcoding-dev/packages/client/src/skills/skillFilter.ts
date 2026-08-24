import type { SkillMeta, MarketSkill } from "@lenovo/agent-protocol";

export type SkillItem = SkillMeta | MarketSkill;
export type SkillSort = "推荐" | "最新" | "热门";

/** 是否为市场项（没有 source 字段） */
export function isMarketItem(item: SkillItem): item is MarketSkill {
  return !("source" in item);
}

const downloadsOf = (i: SkillItem) => (i as MarketSkill).downloads ?? 0;
const tsOf = (i: SkillItem) => (i as SkillMeta).installedAt ?? 0;
const isOfficial = (i: SkillItem) =>
  (i as MarketSkill).author === "Team AI" || (i as SkillMeta).source === "builtin";

export type FilterArgs = {
  list: SkillItem[];
  search?: string;
  sourceFilter?: string | null;
  categoryFilter?: string | null;
  sort?: SkillSort;
  installedNames?: Set<string>;
};

/**
 * 纯函数：对技能列表执行 搜索 → 来源过滤 → 分类过滤 → 排序。
 * 不修改入参（内部浅拷贝），便于在组件外做单元测试。
 */
export function filterAndSortSkills({
  list,
  search,
  sourceFilter,
  categoryFilter,
  sort = "推荐",
  installedNames = new Set<string>(),
}: FilterArgs): SkillItem[] {
  let out = [...list];

  if (search) {
    const q = search.toLowerCase();
    out = out.filter(
      (i) =>
        (i.displayName || i.name).toLowerCase().includes(q) ||
        (i.description ?? "").toLowerCase().includes(q)
    );
  }
  if (sourceFilter) {
    out = out.filter((i) => (isMarketItem(i) ? "market" : i.source) === sourceFilter);
  }
  if (categoryFilter) {
    out = out.filter((i) => (i as MarketSkill).tags?.includes(categoryFilter));
  }

  if (sort === "最新") {
    out.sort((a, b) => tsOf(b) - tsOf(a) || downloadsOf(b) - downloadsOf(a));
  } else if (sort === "热门") {
    out.sort((a, b) => downloadsOf(b) - downloadsOf(a));
  } else {
    // 推荐：官方优先 → 已安装优先 → 下载量
    out.sort((a, b) => {
      const oa = isOfficial(a) ? 1 : 0;
      const ob = isOfficial(b) ? 1 : 0;
      if (oa !== ob) return ob - oa;
      const ia = installedNames.has(a.name) ? 1 : 0;
      const ib = installedNames.has(b.name) ? 1 : 0;
      if (ia !== ib) return ib - ia;
      return downloadsOf(b) - downloadsOf(a);
    });
  }
  return out;
}
