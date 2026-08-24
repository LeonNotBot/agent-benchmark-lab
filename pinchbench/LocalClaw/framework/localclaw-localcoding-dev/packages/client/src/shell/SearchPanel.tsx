// 搜索面板：在 PanelSurface 圆角壳内渲染。
// 目前提供会话标题的前端本地搜索，点击结果可直接跳转到对应会话。
import { useMemo, useState } from "react";
import { useAppStore } from "../store/useAppStore";
import { useLocale } from "../i18n";

export function SearchPanel() {
  const sessions = useAppStore((s) => s.sessions);
  const setActiveSessionId = useAppStore((s) => s.setActiveSessionId);
  const [query, setQuery] = useState("");
  const { t } = useLocale();

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = Object.values(sessions) as any[];
    if (!q) return [];
    return list
      .filter((s) => (s.title || "").toLowerCase().includes(q) || (s.lastPrompt || "").toLowerCase().includes(q))
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  }, [sessions, query]);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header */}
      <div className="shrink-0 px-8 pt-7 pb-5">
        <h1 className="text-xl font-bold text-text-100">{t("search.title")}</h1>
        <p className="mt-1 text-xs text-text-400">{t("search.subtitle")}</p>
        <div className="mt-4 flex items-center gap-2 rounded-lg border border-border-300 bg-bg-000 px-3 py-2">
          <svg className="h-4 w-4 shrink-0 text-text-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("search.placeholder")}
            className="w-full border-none bg-transparent text-sm text-text-100 outline-none placeholder:text-text-400"
          />
          {query && (
            <button onClick={() => setQuery("")} className="text-sm text-text-400 hover:text-text-200">✕</button>
          )}
        </div>
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto px-8 pb-8">
        {!query.trim() ? (
          <p className="py-16 text-center text-sm text-text-400">{t("search.empty")}</p>
        ) : results.length === 0 ? (
          <p className="py-16 text-center text-sm text-text-400">{t("search.noMatch")}</p>
        ) : (
          <div className="flex flex-col gap-1">
            {results.map((s) => (
              <button
                key={s.id}
                onClick={() => setActiveSessionId(s.id)}
                className="flex flex-col gap-0.5 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-bg-200"
              >
                <span className="truncate text-sm font-medium text-text-100">{s.title || t("search.untitled")}</span>
                {s.lastPrompt && <span className="truncate text-xs text-text-400">{s.lastPrompt}</span>}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
