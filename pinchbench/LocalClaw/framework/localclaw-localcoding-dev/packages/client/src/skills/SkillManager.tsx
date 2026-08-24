import { useState, useEffect, useRef, useDeferredValue } from "react";
import { useAppStore } from "../store/useAppStore";
import type { ClientEvent, SkillMeta, MarketSkill } from "@lenovo/agent-protocol";
import { useLocale } from "../i18n";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import * as Dialog from "@radix-ui/react-dialog";
import { showToast } from "../components/Toast";
import MDContent from "../render/markdown";
import { filterAndSortSkills, type SkillSort } from "./skillFilter";
import { useSkillIcon } from "./useSkillIcon";
import { getSkillIconInfo, CATEGORY_CONFIG } from "./skillIconMap";
import { Sparkles, Zap, Loader2 } from "lucide-react";
import {
  apiListSkills, apiDeleteSkill, apiGetSkill, apiImportSkillZip,
  apiListMarketSkills, apiInstallMarketSkill, apiSetSkillDisabled,
} from "../api/skill";
import { PluginImportDialog } from "../plugins/PluginImportDialog";

type Tab = "market" | "my";

export function SkillManager({
  sendEvent,
  onCreateSkill,
  onEditSkill,
  onExportSkill,
  onImportSkill,
  onCloneSkill,
  embedded,
}: {
  sendEvent: (e: ClientEvent) => void;
  onCreateSkill: () => void;
  onEditSkill: (name: string) => void;
  onExportSkill: (name: string) => void;
  onImportSkill: () => void;
  onCloneSkill: (data: SkillMeta & { content?: string }) => void;
  embedded?: boolean;
}) {
  const open = useAppStore((s) => s.skillManagerOpen);
  const setOpen = useAppStore((s) => s.setSkillManagerOpen);
  const skills = useAppStore((s) => s.skills);
  const disabledSkills = useAppStore((s) => s.disabledSkills);
  const [tab, setTab] = useState<Tab>("market");
  const [marketSkills, setMarketSkills] = useState<MarketSkill[]>([]);

  // Search（输入即时，请求防抖）
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);

  // Filters
  const [sourceFilter, setSourceFilter] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [sort, setSort] = useState("推荐");
  const SORTS = ["推荐", "最新", "热门"];

  // UI states
  const [loading, setLoading] = useState(false);
  const [detailSkill, setDetailSkill] = useState<SkillMeta | MarketSkill | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [pluginImportOpen, setPluginImportOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [autoScan, setAutoScan] = useState(false);
  const [skillMenuOpen, setSkillMenuOpen] = useState<string | null>(null);
  const [busyNames, setBusyNames] = useState<Set<string>>(new Set());

  const catRef = useRef<HTMLDivElement>(null);
  const sortRef = useRef<HTMLDivElement>(null);
  const [catOpen, setCatOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);

  const { t } = useLocale();
  const sortLabel = (s: string) =>
    s === "推荐" ? t("skill.sortRecommend") : s === "最新" ? t("skill.sortNewest") : t("skill.sortHot");

  // Tab 切换时重置过滤器，避免"我的技能"仍受市场页残留过滤条件影响
  const handleTabChange = (nextTab: Tab) => {
    if (nextTab !== tab) {
      setSearch("");
      setSourceFilter(null);
      setCategoryFilter(null);
      setSort("推荐");
    }
    setTab(nextTab);
  };

  // 为详情弹窗计算的图标信息
  const detailIconInfo = useSkillIcon(detailSkill || {});

  useEffect(() => {
    if (open) {
      apiListSkills()
        .then((s) => useAppStore.getState().setSkills(s))
        .catch((err) => {
          console.error("Failed to load skills:", err);
          showToast("error", t("skill.loadFailed"));
        });
    }
  }, [open]);

  useEffect(() => {
    if (open && tab === "market") {
      setLoading(true);
      apiListMarketSkills(deferredSearch || undefined)
        .then(setMarketSkills)
        .catch((err) => {
          console.error("Failed to load market skills:", err);
          showToast("error", t("skill.marketLoadFailed"));
        })
        .finally(() => setLoading(false));
    }
  }, [open, tab, deferredSearch]);

  // Close dropdowns / card menu on outside click — 只在 open 时监听
  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      const target = e.target as Node;
      if (catRef.current && !catRef.current.contains(target)) setCatOpen(false);
      if (sortRef.current && !sortRef.current.contains(target)) setSortOpen(false);
      if (skillMenuOpen) {
        const menu = document.querySelector(`[data-skill-menu="${skillMenuOpen}"]`);
        const trigger = document.querySelector(`[data-skill-menu-trigger="${skillMenuOpen}"]`);
        if (menu && !menu.contains(target) && trigger && !trigger.contains(target)) {
          setSkillMenuOpen(null);
        }
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open, skillMenuOpen]);

  // Keyboard shortcuts: Esc 关闭 / Ctrl+N 新建 / Ctrl+F 搜索
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        if (detailSkill) { setDetailSkill(null); return; }
        if (uploadOpen) { setUploadOpen(false); return; }
        if (skillMenuOpen) { setSkillMenuOpen(null); return; }
        if (searchOpen) { setSearchOpen(false); setSearch(""); return; }
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === "n" || e.key === "N")) {
        e.preventDefault();
        onCreateSkill();
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === "f" || e.key === "F")) {
        e.preventDefault();
        setSearchOpen(true);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, detailSkill, uploadOpen, skillMenuOpen, searchOpen, onCreateSkill]);

  const setBusy = (name: string, busy: boolean) => {
    setBusyNames((prev) => {
      const next = new Set(prev);
      if (busy) next.add(name);
      else next.delete(name);
      return next;
    });
  };

  const handleInstall = async (skill: MarketSkill) => {
    if (busyNames.has(skill.name)) return;
    setBusy(skill.name, true);
    try {
      const res = await apiInstallMarketSkill(skill.name);
      if (!res.success) {
        // 安装失败：根据 reason 显示更有针对性的提示
        const reason = (res as any).reason || "";
        const detail = res.message || "";
        let hint = "";
        if (reason === "download_failed" || reason === "registry_empty") {
          hint = "\n请检查网络连接后重试";
        } else if (reason === "validation_failed") {
          hint = "\n该技能格式存在问题，请联系作者反馈";
        }
        showToast("error", `"${skill.displayName || skill.name}" 安装失败${detail ? `: ${detail}` : ""}${hint}`);
        return;
      }
      // 安装成功
      setMarketSkills((prev) =>
        prev.map((s) => (s.name === skill.name ? { ...s, installed: true } : s))
      );
      showToast("success", `"${skill.displayName || skill.name}" ${t("skill.toastInstalled")}`);
      const list = await apiListSkills();
      useAppStore.getState().setSkills(list);
    } catch (err) {
      console.error("Failed to install skill:", err);
      showToast("error", `"${skill.displayName || skill.name}" ${t("skill.installFailed")}`);
    } finally {
      setBusy(skill.name, false);
    }
  };

  const handleRemove = async (skill: SkillMeta | MarketSkill) => {
    if (busyNames.has(skill.name)) return;
    setBusy(skill.name, true);
    try {
      await apiDeleteSkill(skill.name);
      if (!("source" in skill)) {
        // market skill (uninstall)：同步市场列表的安装状态
        setMarketSkills((prev) =>
          prev.map((s) => (s.name === skill.name ? { ...s, installed: false } : s))
        );
      }
      useAppStore.getState().setSkills(skills.filter((s) => s.name !== skill.name));
      showToast("success", `"${skill.displayName || skill.name}" ${t("skill.toastRemoved")}`);
    } catch (err) {
      console.error("Failed to remove skill:", err);
      showToast("error", `"${skill.displayName || skill.name}" ${t("skill.removeFailed")}`);
    } finally {
      setSkillMenuOpen(null);
      setBusy(skill.name, false);
    }
  };

  const handleClone = async (name: string) => {
    setSkillMenuOpen(null);
    try {
      const detail = await apiGetSkill(name);
      if (!detail) throw new Error("not found");
      onCloneSkill({
        ...detail,
        name: `${detail.name}-copy`,
        displayName: detail.displayName ? `${detail.displayName} Copy` : undefined,
      });
    } catch (err) {
      console.error("Failed to clone skill:", err);
      showToast("error", t("skill.cloneFailed"));
    }
  };

  const getList = (): (SkillMeta | MarketSkill)[] =>
    filterAndSortSkills({
      list: tab === "my" ? skills : marketSkills,
      search,
      sourceFilter,
      categoryFilter,
      sort: sort as SkillSort,
      installedNames,
    });

  const installedNames = new Set(skills.map((s) => s.name));
  const filtered = getList();

  const categories = [...new Set(marketSkills.filter((m) => m.tags?.length).flatMap((m) => m.tags ?? []))];

  const isPaused = (item: SkillMeta | MarketSkill) => {
    if (tab !== "my") return false;
    return disabledSkills.includes(item.name);
  };

  if (!open) return null;

  const rootCls = embedded
    ? "flex flex-1 flex-col overflow-hidden min-w-0"
    : "fixed top-10 bottom-0 right-0 left-0 lg:left-[280px] z-40 bg-surface flex flex-col";

  return (
    <div className={rootCls}>
      {/* Header */}
      <div className="shrink-0 px-8 pt-7 pb-5">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-text-100">{t("sidebar.skills")}</h1>
            <p className="text-xs text-text-400 mt-1">{t("skill.subtitle")}</p>
          </div>
          <div className="flex items-center gap-2">
            {searchOpen ? (
              <div className="flex items-center gap-2 bg-bg-000 border border-border-300 rounded-lg px-3 py-1.5 w-56">
                <svg className="w-4 h-4 text-text-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                <input
                  autoFocus
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder={t("skill.searchPlaceholder")}
                  className="bg-transparent border-none outline-none text-sm text-text-100 w-full"
                />
                <button onClick={() => { setSearchOpen(false); setSearch(""); }} className="text-text-400 hover:text-text-200 text-sm">✕</button>
              </div>
            ) : (
              <button
                onClick={() => setSearchOpen(true)}
                className="w-10 h-10 rounded-lg border border-border-300 bg-bg-000 flex items-center justify-center text-text-400 hover:text-text-200 hover:border-border-200/40 transition-colors"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              </button>
            )}

            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <button className="rounded-lg bg-accent-brand text-white text-sm font-semibold px-4 py-2 hover:bg-accent-hover shadow-soft flex items-center gap-1 cursor-pointer">
                  ＋ {t("skill.addSkill")}
                </button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content
                  className="min-w-45 bg-bg-000 rounded-xl border border-border-300 shadow-lg z-50 p-1"
                  sideOffset={6}
                  align="end"
                >
                  <DropdownMenu.Item
                    className="flex items-center gap-3 px-4 py-2.5 text-sm text-text-400 rounded-lg hover:bg-bg-200 cursor-pointer outline-none"
                    onSelect={(e) => { e.preventDefault(); showToast("warning", t("skill.aiCreateComingSoon")); }}
                  >
                    <span className="text-base">⧉</span>
                    <span>{t("skill.aiCreate")}</span>
                    <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-yellow-50 text-yellow-600 dark:bg-yellow-900/30 dark:text-yellow-400 font-semibold">{t("skill.comingSoon")}</span>
                  </DropdownMenu.Item>
                  <DropdownMenu.Item
                    className="flex items-center gap-3 px-4 py-2.5 text-sm text-text-100 rounded-lg hover:bg-bg-200 cursor-pointer outline-none"
                    onSelect={onCreateSkill}
                  >
                    <span className="text-base">⊞</span>
                    <span>{t("skill.writeSkill")}</span>
                  </DropdownMenu.Item>
                  <DropdownMenu.Item
                    className="flex items-center gap-3 px-4 py-2.5 text-sm text-text-100 rounded-lg hover:bg-bg-200 cursor-pointer outline-none"
                    onSelect={() => setUploadOpen(true)}
                  >
                    <span className="text-base">⇧</span>
                    <span>{t("skill.uploadSkill")}</span>
                  </DropdownMenu.Item>
                  <DropdownMenu.Item
                    className="flex items-center gap-3 px-4 py-2.5 text-sm text-text-100 rounded-lg hover:bg-bg-200 cursor-pointer outline-none"
                    onSelect={() => setPluginImportOpen(true)}
                  >
                    <span className="text-base">⧈</span>
                    <span>{t("plugin.importScenePack")}</span>
                  </DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          </div>
        </div>
      </div>

      {/* Tabs + Filters */}
      <div className="shrink-0 px-8 pb-4 flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-6">
          {[
            { key: "market" as Tab, label: t("skill.market") },
            { key: "my" as Tab, label: t("skill.mySkills"), count: skills.length },
          ].map(tItem => (
            <button
              key={tItem.key}
              onClick={() => handleTabChange(tItem.key)}
              className={`text-[15px] pb-1.5 border-b-2 bg-transparent border-none cursor-pointer flex items-center gap-1 transition-colors ${
                tab === tItem.key
                  ? "font-bold text-text-100 border-text-100"
                  : "font-normal text-text-400 border-transparent hover:text-text-200"
              }`}
            >
              {tItem.label}
              {tItem.count !== undefined && <span className="text-[11px] text-text-400 font-normal">{tItem.count}</span>}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setSourceFilter(sourceFilter === "official" ? null : "official")}
            className={`px-4 py-1.5 rounded-full text-xs font-medium cursor-pointer border transition-colors ${
              sourceFilter === "official"
                ? "border-accent-brand bg-accent-brand/10 text-accent-text"
                : "border-border-300 bg-bg-000 text-text-400 hover:border-border-200/40"
            }`}
          >
            {t("skill.official")}
          </button>

          <div ref={catRef} className="relative">
            <button
              onClick={() => setCatOpen(!catOpen)}
              className={`px-4 py-1.5 rounded-full text-xs font-medium cursor-pointer border flex items-center gap-1 transition-colors ${
                categoryFilter
                  ? "border-accent-brand bg-accent-brand/10 text-accent-text"
                  : "border-border-300 bg-bg-000 text-text-400 hover:border-border-200/40"
              }`}
            >
              {categoryFilter || t("skill.category")} <span className="text-[10px]">▾</span>
            </button>
            {catOpen && (
              <div className="absolute top-full right-0 mt-1 bg-bg-000 border border-border-300 rounded-xl shadow-lg z-20 min-w-30 overflow-hidden py-1">
                <button
                  onClick={() => { setCategoryFilter(null); setCatOpen(false); }}
                  className={`w-full text-left px-4 py-2 text-xs cursor-pointer hover:bg-bg-200 ${!categoryFilter ? "text-accent-text bg-accent-brand/10" : "text-text-100"}`}
                >
                  {t("skill.allCategories")}
                </button>
                {categories.map(c => (
                  <button
                    key={c}
                    onClick={() => { setCategoryFilter(c); setCatOpen(false); }}
                    className={`w-full text-left px-4 py-2 text-xs cursor-pointer hover:bg-bg-200 ${categoryFilter === c ? "text-accent-text bg-accent-brand/10" : "text-text-100"}`}
                  >
                    {c}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div ref={sortRef} className="relative">
            <button
              onClick={() => setSortOpen(!sortOpen)}
              className="px-4 py-1.5 rounded-full text-xs font-medium cursor-pointer border border-border-300 bg-bg-000 text-text-400 hover:border-border-200/40 flex items-center gap-1 transition-colors"
            >
              {sortLabel(sort)} <span className="text-[10px]">▾</span>
            </button>
            {sortOpen && (
              <div className="absolute top-full right-0 mt-1 bg-bg-000 border border-border-300 rounded-xl shadow-lg z-20 min-w-25 overflow-hidden py-1">
                {SORTS.map(s => (
                  <button
                    key={s}
                    onClick={() => { setSort(s); setSortOpen(false); }}
                    className={`w-full text-left px-4 py-2 text-xs cursor-pointer hover:bg-bg-200 ${sort === s ? "text-accent-text bg-accent-brand/10" : "text-text-100"}`}
                  >
                    {s === "推荐" ? t("skill.sortRecommend") : s === "最新" ? t("skill.sortNewest") : t("skill.sortHot")}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-8 pb-8 pt-2">
        {loading && tab === "market" ? (
          <div className="flex flex-col items-center justify-center h-64 gap-3">
            <div className="w-7 h-7 rounded-full border-2 border-accent-brand border-t-transparent animate-spin" />
            <span className="text-sm text-text-400">{t("skill.loading")}</span>
          </div>
        ) : filtered.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {filtered.map(item => {
              const isMy = tab === "my";
              const added = installedNames.has(item.name);
              const paused = isPaused(item);
              const isMarket = !("source" in item);
              const iconInfo = getSkillIconInfo(item);
              const Icon = iconInfo.icon;
              return (
                <div
                  key={item.name}
                  onClick={() => setDetailSkill(item)}
                  className={`relative rounded-xl border p-4 cursor-pointer transition-all duration-200 hover:shadow-xl hover:-translate-y-0.5 select-none group ${
                    skillMenuOpen === item.name ? "z-30" : ""
                  } ${
                    paused
                      ? "bg-bg-000 border-border-300 opacity-60 hover:opacity-100"
                      : "bg-bg-000 border-border-300 hover:border-accent-brand/40"
                  }`}
                >
                  {/* 顶部高光线条 */}
                  <div className={`absolute top-0 left-3 right-3 h-px bg-gradient-to-r from-transparent ${iconInfo.config.gradient} to-transparent opacity-0 group-hover:opacity-60 transition-opacity duration-200`} />
                  <div className="flex items-start gap-3 mb-2.5">
                    <div className={`w-11 h-11 rounded-xl bg-gradient-to-br ${iconInfo.config.gradient} shadow-lg flex items-center justify-center shrink-0 border border-white/10`}>
                      <Icon className="w-5 h-5 text-white drop-shadow-sm" />
                    </div>
                    <div className="flex-1 min-w-0 text-[13px] font-semibold text-text-100 truncate flex items-center gap-1.5">
                      <span className="truncate">{item.displayName || item.name}</span>
                      {paused && (
                        <span className="shrink-0 text-[9px] px-1.5 py-0.5 rounded-full bg-bg-200 text-text-400 border border-border-300 font-normal">
                          {t("skill.disabled")}
                        </span>
                      )}
                    </div>
                    {!isMy && (
                      <button
                        disabled={busyNames.has(item.name)}
                        onClick={e => { e.stopPropagation(); added ? handleRemove(item) : handleInstall(item as MarketSkill); }}
                        className={`w-7 h-7 rounded-md border flex items-center justify-center text-sm cursor-pointer transition-colors shrink-0 disabled:cursor-wait disabled:opacity-70 ${
                          added
                            ? "border-accent-brand bg-accent-brand/10 text-accent-text"
                            : "border-border-300 text-text-400 hover:text-text-100"
                        }`}
                      >
                        {busyNames.has(item.name) ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : added ? "✓" : "+"}
                      </button>
                    )}
                  </div>
                  <div className="text-[11px] text-text-400 leading-relaxed line-clamp-2 mb-2.5 select-text">
                    {item.description}
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex gap-1.5">
                      {(isMarket ? "market" : item.source) && (
                        <span className="text-[9px] px-2 py-0.5 rounded-full border border-accent-brand text-accent-brand bg-bg-000">
                          {isMarket ? t("skill.market") : t(`skill.src${item.source.charAt(0).toUpperCase() + item.source.slice(1)}` as any)}
                        </span>
                      )}
                      {(item as MarketSkill).tags?.[0] && (
                        <span className="text-[9px] px-2 py-0.5 rounded-full border border-border-300 text-text-400 bg-bg-000">
                          {(item as MarketSkill).tags![0]}
                        </span>
                      )}
                    </div>
                    {isMy && (
                      <button
                        data-skill-menu-trigger={item.name}
                        onClick={e => { e.stopPropagation(); setSkillMenuOpen(skillMenuOpen === item.name ? null : item.name); }}
                        className="text-lg text-text-400 hover:text-text-100 cursor-pointer px-1 leading-none"
                      >
                        ⋯
                      </button>
                    )}
                  </div>

                  {/* Context menu for my skills */}
                  {isMy && skillMenuOpen === item.name && (
                    <div
                      data-skill-menu={item.name}
                      onClick={e => e.stopPropagation()}
                      className="absolute right-4 top-full mt-1 bg-bg-000 rounded-xl shadow-xl border border-border-300 min-w-30 z-20 py-1.5 overflow-hidden"
                    >
                      <button
                        onClick={async () => {
                          const willDisable = !disabledSkills.includes(item.name);
                          setSkillMenuOpen(null);
                          setBusyNames((prev) => new Set([...prev, item.name]));
                          try {
                            await apiSetSkillDisabled(item.name, willDisable);
                            const skill = skills.find((s) => s.name === item.name);
                            if (skill) {
                              useAppStore.getState().setSkills(
                                skills.map((s) =>
                                  s.name === item.name ? { ...s, disabled: willDisable } : s,
                                ),
                              );
                            }
                            showToast("success", willDisable ? t("skill.disabled") : t("skill.enabled"));
                          } catch (e) {
                            console.error("Toggle skill disabled failed:", e);
                            showToast("error", t("skill.toggleFailed"));
                          } finally {
                            setBusyNames((prev) => {
                              const next = new Set(prev);
                              next.delete(item.name);
                              return next;
                            });
                          }
                        }}
                        className="w-full px-4.5 py-2.5 text-left text-[13px] text-text-100 bg-transparent border-none cursor-pointer hover:bg-bg-200 transition-colors"
                      >
                        {disabledSkills.includes(item.name) ? t("skill.enable") : t("skill.disable")}
                      </button>
                      <div className="h-px bg-border-300 mx-2" />
                      <button
                        onClick={() => { onEditSkill(item.name); setSkillMenuOpen(null); }}
                        className="w-full px-4.5 py-2.5 text-left text-[13px] text-text-100 bg-transparent border-none cursor-pointer hover:bg-bg-200 transition-colors"
                      >
                        {t("skill.edit")}
                      </button>
                      <button
                        onClick={() => handleClone(item.name)}
                        className="w-full px-4.5 py-2.5 text-left text-[13px] text-text-100 bg-transparent border-none cursor-pointer hover:bg-bg-200 transition-colors"
                      >
                        {t("skill.clone")}
                      </button>
                      <button
                        onClick={() => { onExportSkill(item.name); setSkillMenuOpen(null); }}
                        className="w-full px-4.5 py-2.5 text-left text-[13px] text-text-100 bg-transparent border-none cursor-pointer hover:bg-bg-200 transition-colors"
                      >
                        {t("skill.export")}
                      </button>
                      <div className="h-px bg-border-300 mx-2" />
                      <button
                        onClick={() => handleRemove(item)}
                        className="w-full px-4.5 py-2.5 text-left text-[13px] text-red-600 dark:text-red-400 bg-transparent border-none cursor-pointer hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors"
                      >
                        {t("skill.remove")}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-64 text-center">
            <div className={`w-16 h-16 rounded-2xl bg-gradient-to-br ${CATEGORY_CONFIG.default.gradient} shadow-lg flex items-center justify-center mb-4 border border-white/10`}>
              {tab === "market"
                ? <Sparkles className="w-7 h-7 text-white drop-shadow-sm" />
                : <Zap className="w-7 h-7 text-white drop-shadow-sm" />}
            </div>
            <p className="text-sm font-medium text-text-100 mb-1">
              {tab === "market" ? t("skill.marketEmptyTitle") : t("skill.mySkillsEmptyTitle")}
            </p>
            <p className="text-xs text-text-400 max-w-xs">
              {tab === "market" ? t("skill.marketEmptyHint") : t("skill.mySkillsEmptyHint")}
            </p>
            {tab === "my" && (
              <button
                onClick={onCreateSkill}
                className="mt-4 px-4 py-2 rounded-lg bg-accent-brand text-white text-sm font-medium hover:bg-accent-hover shadow-soft cursor-pointer"
              >
                ＋ {t("skill.writeSkill")}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Detail Modal */}
      <Dialog.Root open={!!detailSkill} onOpenChange={(v) => !v && setDetailSkill(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/35 backdrop-blur-sm z-50" />
          <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-125 max-w-[92vw] max-h-[80vh] bg-bg-000/92 backdrop-blur-xl rounded-2xl border border-border-200/60 shadow-xl z-50 flex flex-col overflow-hidden">
            {detailSkill && (
              <>
                <div className="px-6 pt-6 pb-4 border-b border-border-300">
                  <div className="flex items-start gap-3.5 mb-2.5">
                    <div className={`w-14 h-14 rounded-xl bg-gradient-to-br ${detailIconInfo.config.gradient} shadow-lg flex items-center justify-center shrink-0 border border-white/10`}>
                      <detailIconInfo.icon className="w-7 h-7 text-white drop-shadow-sm" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[17px] font-bold text-text-100 leading-tight">{detailSkill.displayName || detailSkill.name}</div>
                      <div className="text-[11px] text-text-400 mt-1">
                        {"source" in detailSkill ? `@${detailSkill.source}` : `@${detailSkill.author || "Team AI"}`} &nbsp;|&nbsp; {t("skill.detailUpdated")}
                      </div>
                    </div>
                    <Dialog.Close asChild>
                      <button className="text-lg text-text-400 hover:text-text-100 hover:bg-bg-200 rounded-md p-1 shrink-0 cursor-pointer transition-colors">×</button>
                    </Dialog.Close>
                  </div>
                  <p className="text-[13px] text-text-400 leading-relaxed">{detailSkill.description}</p>
                </div>
                <div className="flex-1 overflow-y-auto px-6 py-4 bg-bg-100">
                  <div className="bg-bg-000 rounded-lg border border-border-300 p-5 text-[13px] leading-relaxed">
                    <MDContent text={(detailSkill as MarketSkill).readme || (detailSkill as SkillMeta & { content?: string }).content || detailSkill.description || "..."} />
                  </div>
                </div>
                <div className="px-6 py-3.5 border-t border-border-300 flex justify-end bg-bg-000">
                  <button
                    onClick={() => {
                      const installed = installedNames.has(detailSkill.name);
                      if (installed) {
                        handleRemove(detailSkill);
                      } else {
                        handleInstall(detailSkill as MarketSkill);
                      }
                      setDetailSkill(null);
                    }}
                    className={`px-7 py-2.5 rounded-lg text-sm font-semibold cursor-pointer transition-colors ${
                      installedNames.has(detailSkill.name)
                        ? "bg-bg-000 text-text-400 shadow-[inset_0_0_0_1px_hsl(var(--border-300))] hover:bg-bg-200"
                        : "bg-accent-brand text-white hover:bg-accent-hover"
                    }`}
                  >
                    {installedNames.has(detailSkill.name) ? t("skill.remove") : t("skill.install")}
                  </button>
                </div>
              </>
            )}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Upload Modal */}
      <Dialog.Root open={uploadOpen} onOpenChange={(v) => { if (!v) setUploadOpen(false); }}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/35 backdrop-blur-sm z-50" onClick={() => setUploadOpen(false)} />
          <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-120 bg-bg-000/92 backdrop-blur-xl rounded-2xl border border-border-200/60 shadow-xl z-50 overflow-hidden">
            <div className="px-7 pt-6 pb-5 flex items-center justify-between border-b border-border-300">
              <div className="text-lg font-bold text-text-100">{t("skill.uploadTitle")}</div>
              <Dialog.Close asChild>
                <button className="text-lg text-text-400 hover:text-text-100 hover:bg-bg-200 rounded-md p-1 cursor-pointer transition-colors">×</button>
              </Dialog.Close>
            </div>
            <div className="px-7 pt-6 pb-7">
              <div
                className={`border-[1.5px] border-dashed rounded-xl py-12 px-7 flex flex-col items-center gap-3.5 cursor-pointer transition-colors ${
                  dragOver ? "border-accent-brand bg-accent-brand/10" : "border-border-300 hover:bg-bg-200"
                }`}
                onClick={() => { setUploadOpen(false); onImportSkill(); }}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={(e) => { e.preventDefault(); setDragOver(false); }}
                onDrop={async (e) => {
                  e.preventDefault();
                  setDragOver(false);
                  const files = Array.from(e.dataTransfer.files).filter((f) => f.name.toLowerCase().endsWith(".zip"));
                  if (files.length === 0) return;
                  setUploadOpen(false);
                  setSearch(""); // 上传成功后清空搜索词，避免新技能被过滤条件隐藏
                  for (const file of files) {
                    try {
                      const buffer = await file.arrayBuffer();
                      const res = await apiImportSkillZip(buffer);
                      showToast(res.warnings.length ? "warning" : "success",
                        t("toast.importSuccess", { name: res.name }) +
                        (res.warnings.length ? "\n" + res.warnings.map((w) => `· ${w}`).join("\n") : ""));
                    } catch (err) {
                      console.error("Import failed:", err);
                      showToast("error", t("toast.importFail", { file: file.name }));
                    }
                  }
                  apiListSkills().then((s) => useAppStore.getState().setSkills(s)).catch(() => {});
                }}
              >
                <div className="w-13 h-13 rounded-lg border-[1.5px] border-border-300 flex items-center justify-center text-2xl text-text-400">⇧</div>
                <div className="text-[15px] text-text-100 font-medium">{t("skill.dragOrClick")}</div>
                <div className="text-xs text-text-400">{t("skill.supportedFormats")}</div>
              </div>
              <label className="flex items-center gap-2.5 mt-4 cursor-pointer">
                <div className={`w-4.5 h-4.5 rounded border-[1.5px] flex items-center justify-center shrink-0 transition-colors ${autoScan ? "bg-accent-brand border-accent-brand" : "border-border-300 bg-bg-000"}`}>
                  {autoScan && <span className="text-white text-[11px]">✓</span>}
                </div>
                <input type="checkbox" className="hidden" checked={autoScan} onChange={e => setAutoScan(e.target.checked)} />
                <span className="text-[13px] text-text-400">{t("skill.riskScan")}</span>
              </label>
              <div className="mt-5">
                <div className="text-sm font-bold text-text-100 mb-2.5">{t("skill.fileRequirements")}</div>
                <ul className="list-disc pl-5 flex flex-col gap-2">
                  <li className="text-[13px] text-text-400 leading-relaxed">{t("skill.fileReq1")}</li>
                  <li className="text-[13px] text-text-400 leading-relaxed">{t("skill.fileReq2")}</li>
                </ul>
              </div>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <PluginImportDialog open={pluginImportOpen} onOpenChange={setPluginImportOpen} />
    </div>
  );
}
