/**
 * Server 详情面板：基本信息 + Tool 列表 + 操作按钮。
 */
import type { MCPServer } from "@lenovo/agent-protocol";
import { ToolExplorer } from "./ToolExplorer";
import { useLocale } from "../i18n";

interface Props {
  server: MCPServer;
  onPreview: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

const STATUS_META: Record<string, { key: string; color: string }> = {
  installed: { key: "connector.status.installed", color: "text-blue-500" },
  starting: { key: "connector.status.starting", color: "text-yellow-500" },
  running: { key: "connector.status.installed", color: "text-blue-500" },
  error: { key: "connector.status.error", color: "text-red-500" },
  stopped: { key: "connector.status.stopped", color: "text-text-400" },
};

export function ServerDetail({ server, onPreview, onEdit, onDelete }: Props) {
  const { t } = useLocale();
  const status = STATUS_META[server.status] ?? STATUS_META.installed;
  const isStarting = server.status === "starting";
  const isError = server.status === "error";
  // 预览仅在「不会被加载」(stopped) 时不可用；其余状态均可点预览拉取工具。
  const canPreview = server.status !== "stopped";

  return (
    <div className="py-2">
      {/* 基本信息 */}
      <div className="mb-6">
        <h2 className="mb-1 text-lg font-semibold text-text-100">{server.name}</h2>
        {server.description && (
          <p className="mb-3 text-sm text-text-400">{server.description}</p>
        )}
        <div className="flex flex-wrap gap-4 text-xs text-text-300">
          <span>
            {t("connector.fieldType")}：<span className="font-mono text-text-200">{server.type}</span>
          </span>
          <span>
            {t("connector.fieldStatus")}：<span className={`${status.color} font-medium`}>{t(status.key)}</span>
          </span>
          <span>
            Tools：<span className="text-text-200">{server.tools.length}</span>
          </span>
        </div>

        {server.errorMessage && (
          <div className="mt-2 rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2 text-xs text-red-400">
            {t("connector.fieldError")}：{server.errorMessage}
          </div>
        )}

        {/* stdio 信息 */}
        {server.type === "stdio" && server.command && (
          <div className="mt-2">
            <p className="text-xs text-text-400">{t("connector.fieldCommand")}</p>
            <code className="mt-0.5 block rounded bg-bg-300 px-2 py-1 text-xs text-text-200">
              {server.command}{server.args ? " " + server.args.join(" ") : ""}
            </code>
          </div>
        )}

        {server.type !== "stdio" && server.url && (
          <div className="mt-2">
            <p className="text-xs text-text-400">URL</p>
            <code className="mt-0.5 block rounded bg-bg-300 px-2 py-1 text-xs text-text-200">
              {server.url}
            </code>
          </div>
        )}
      </div>

      {/* 操作按钮 */}
      <div className="mb-6 flex gap-2">
        <button
          onClick={onPreview}
          disabled={isStarting || !canPreview}
          className="flex items-center gap-1.5 rounded-lg border border-border px-4 py-2 text-sm text-text-200 transition-colors hover:bg-bg-300 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M23 4v6h-6M1 20v-6h6" />
            <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
          </svg>
          {isStarting ? t("connector.refreshingTools") : isError ? t("connector.retry") : t("connector.refreshTools")}
        </button>
        <button
          onClick={onEdit}
          className="flex items-center gap-1.5 rounded-lg border border-border px-4 py-2 text-sm text-text-200 transition-colors hover:bg-bg-300"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
            <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
          </svg>
          {t("connector.edit")}
        </button>
        <button
          onClick={onDelete}
          className="flex items-center gap-1.5 rounded-lg border border-red-500/30 px-4 py-2 text-sm text-red-400 transition-colors hover:bg-red-500/10"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 6h18M19 6l-1 14H6L5 6M10 11v6M14 11v6M9 6V4h6v2" />
          </svg>
          {t("connector.delete")}
        </button>
      </div>

      {/* Tool 列表 */}
      <div>
        <h3 className="mb-3 text-sm font-medium text-text-200">Tools</h3>
        {server.tools.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border py-6 text-center text-xs text-text-400">
            {isStarting ? t("connector.toolsLoading") : t("connector.toolsNotRunning")}
          </div>
        ) : (
          <ToolExplorer tools={server.tools} />
        )}
      </div>
    </div>
  );
}
