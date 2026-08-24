/**
 * Tool 浏览器：展示 Tool 列表，支持搜索过滤。
 */
import { useState } from "react";
import type { MCPTool } from "@lenovo/agent-protocol";
import { useLocale } from "../i18n";

const RISK_STYLES: Record<string, string> = {
  read: "bg-green-500/10 text-green-600 border-green-500/20",
  write: "bg-yellow-500/10 text-yellow-600 border-yellow-500/20",
  danger: "bg-red-500/10 text-red-500 border-red-500/20",
};

const RISK_LABEL_KEYS: Record<string, string> = {
  read: "connector.risk.read",
  write: "connector.risk.write",
  danger: "connector.risk.danger",
};

export function ToolExplorer({ tools }: { tools: MCPTool[] }) {
  const { t } = useLocale();
  const [search, setSearch] = useState("");
  const [filterRisk, setFilterRisk] = useState<string | null>(null);

  const filtered = tools.filter((t) => {
    if (filterRisk && t.risk !== filterRisk) return false;
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      t.name.toLowerCase().includes(q) ||
      t.description.toLowerCase().includes(q) ||
      t.serverName.toLowerCase().includes(q)
    );
  });

  return (
    <div>
      {/* 搜索 + 过滤栏 */}
      <div className="mb-3 flex gap-2">
        <div className="relative flex-1">
          <svg
            viewBox="0 0 24 24"
            className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-400"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4.3-4.3" />
          </svg>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("connector.searchTool")}
            className="w-full rounded-lg border border-border bg-bg-100 py-1.5 pl-8 pr-3 text-xs text-text-100 placeholder-text-400 focus:border-accent-brand focus:outline-none"
          />
        </div>
        <div className="flex gap-1">
          {(["read", "write", "danger"] as const).map((r) => (
            <button
              key={r}
              onClick={() => setFilterRisk(filterRisk === r ? null : r)}
              className={`rounded-md border px-2 py-1 text-xs transition-colors ${
                filterRisk === r
                  ? RISK_STYLES[r]
                  : "border-border text-text-400 hover:border-text-400"
              }`}
            >
              {t(RISK_LABEL_KEYS[r])}
            </button>
          ))}
        </div>
      </div>

      {/* 列表 */}
      <div className="flex flex-col gap-1">
        {filtered.length === 0 ? (
          <div className="py-4 text-center text-xs text-text-400">{t("connector.noMatchTool")}</div>
        ) : (
          filtered.map((tool) => (
            <ToolRow key={`${tool.serverId}:${tool.name}`} tool={tool} />
          ))
        )}
      </div>
    </div>
  );
}

function ToolRow({ tool }: { tool: MCPTool }) {
  const { t } = useLocale();
  const riskStyle = RISK_STYLES[tool.risk] ?? "bg-text-500/10 text-text-400 border-text-500/20";
  const riskLabel = RISK_LABEL_KEYS[tool.risk] ? t(RISK_LABEL_KEYS[tool.risk]) : tool.risk;

  return (
    <div className="group rounded-lg border border-transparent bg-bg-100 px-3 py-2 transition-colors hover:border-border">
      <div className="flex items-center gap-2">
        <code className="text-xs font-medium text-text-100">{tool.name}</code>
        <span className={`rounded border px-1.5 py-0.5 text-[10px] ${riskStyle}`}>
          {riskLabel}
        </span>
        {tool.serverName && (
          <span className="ml-auto text-[10px] text-text-400">{tool.serverName}</span>
        )}
      </div>
      {tool.description && (
        <p className="mt-0.5 text-[11px] leading-relaxed text-text-400">{tool.description}</p>
      )}
    </div>
  );
}
