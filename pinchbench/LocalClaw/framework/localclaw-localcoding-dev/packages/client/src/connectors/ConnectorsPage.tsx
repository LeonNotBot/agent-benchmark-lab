/**
 * MCP 连接器主页面。
 * 左侧 Server 列表 + 右侧 Server 详情 / Tool 列表。
 * 数据源：全局 store.mcpServers（由 AppShell 常驻 WS 订阅写入），本页只读 + 调 API。
 */
import { useState } from "react";
import type { MCPServer } from "@lenovo/agent-protocol";
import {
  apiDeleteMCPServer,
  apiStartMCPServer,
  apiCreateMCPServer,
  apiUpdateMCPServer,
} from "../api/mcp";
import { AddServerDialog } from "./AddServerDialog";
import { ServerDetail } from "./ServerDetail";
import { confirmDialog } from "../components/ConfirmDialog";
import { useLocale } from "../i18n";
import { useAppStore } from "../store/useAppStore";

export function ConnectorsPage() {
  const { t } = useLocale();
  const servers = useAppStore((s) => s.mcpServers);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<MCPServer | null>(null);

  const selected = servers.find((s) => s.id === selectedId) ?? null;

  const handleAdd = () => { setEditing(null); setAddOpen(true); };

  const handleEdit = (server: MCPServer) => { setEditing(server); setAddOpen(true); };

  const handleSubmitted = async (input: Parameters<typeof apiCreateMCPServer>[0], editingId?: string) => {
    // 创建/更新后状态变更由后端探活经 WS 推送回流到 store，无需本地轮询。
    if (editingId) {
      await apiUpdateMCPServer(editingId, input);
    } else {
      await apiCreateMCPServer(input);
    }
    setAddOpen(false);
    setEditing(null);
  };

  const handlePreview = async (id: string) => {
    // 后端 spawn 预览进程拉取工具，完成后经 WS 推 mcp.server.status / updated 回流。
    await apiStartMCPServer(id);
  };

  const handleDelete = async (server: MCPServer) => {
    const ok = await confirmDialog({
      title: t("connector.deleteTitle"),
      message: t("connector.deleteConfirm", { name: server.name }),
      confirmText: t("connector.delete"),
      danger: true,
    });
    if (!ok) return;
    await apiDeleteMCPServer(server.id);
    if (selectedId === server.id) setSelectedId(null);
  };

  const handleSelect = (id: string) => setSelectedId(id);

  return (
    <div className="flex flex-1 flex-col overflow-hidden min-w-0">
      {/* 顶部栏 */}
      <div className="flex items-center justify-between px-8 pt-6 pb-4">
        <h1 className="text-2xl font-semibold text-text-100">{t("connector.title")}</h1>
        <button
          onClick={handleAdd}
          className="flex items-center gap-2 rounded-lg bg-accent-brand px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-brand/80"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 5v14M5 12h14" />
          </svg>
          {t("connector.addServer")}
        </button>
      </div>

      {/* 内容区 */}
      <div className="flex flex-1 overflow-hidden px-8 pb-8">
        {/* 左侧：Server 列表 */}
        <div className="w-64 shrink-0 overflow-y-auto pr-6">
          {servers.length === 0 ? (
            <div className="py-4 text-sm text-text-400">{t("connector.emptyServers")}</div>
          ) : (
            <div className="flex flex-col gap-1">
              {servers.map((server) => (
                <ServerCard
                  key={server.id}
                  server={server}
                  active={server.id === selectedId}
                  onSelect={() => handleSelect(server.id)}
                />
              ))}
            </div>
          )}
        </div>

        {/* 右侧：详情 */}
        <div className="min-w-0 flex-1 overflow-y-auto border-l border-border-300 dark:border-zinc-700/50 pl-6">
          {selected ? (
            <ServerDetail
              server={selected}
              onPreview={() => handlePreview(selected.id)}
              onEdit={() => handleEdit(selected)}
              onDelete={() => handleDelete(selected)}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-text-400">
              {t("connector.selectServer")}
            </div>
          )}
        </div>
      </div>

      {addOpen && (
        <AddServerDialog
          editing={editing}
          onClose={() => { setAddOpen(false); setEditing(null); }}
          onSubmit={handleSubmitted}
        />
      )}
    </div>
  );
}

/** Server 列表卡片 */
function ServerCard({
  server,
  active,
  onSelect,
}: {
  server: MCPServer;
  active: boolean;
  onSelect: () => void;
}) {
  const { t } = useLocale();
  const dotColor = {
    installed: "bg-blue-400",
    starting: "bg-yellow-400",
    running: "bg-blue-400",
    error: "bg-red-400",
    stopped: "bg-text-300",
  }[server.status];
  // running 是预览拉取的瞬态，等同「已启用」显示。
  const isEnabled = server.status === "installed" || server.status === "running";

  return (
    <button
      onClick={onSelect}
      className={`group flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
        active
          ? "bg-[#ECE6E2] font-medium text-text-100 dark:bg-[#242424]"
          : "text-text-200 hover:bg-[#ECE6E2] hover:text-text-100 dark:hover:bg-[#242424]"
      }`}
    >
      <span className={`h-2 w-2 shrink-0 rounded-full ${dotColor}`} />
      <span className="truncate">{server.name}</span>
      {isEnabled && (
        <span className="ml-auto shrink-0 text-xs text-blue-500">{t("connector.enabled")}</span>
      )}
    </button>
  );
}
