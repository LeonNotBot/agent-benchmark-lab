// 鍗曚釜椤圭洰鍒嗙粍锛氶」鐩(鍥炬爣闅忓睍寮€鎬?+ 鍚?+ 鏂颁細璇濇寜閽?+ 路路路 鑿滃崟) + 浼氳瘽鍒楄〃
// 鐐归」鐩鎶樺彔/灞曞紑鏁寸粍浼氳瘽锛涚粍鍐?>5 鏉″啀浜岀骇鎶樺彔(鏄剧ず鍓? + 灞曞紑鏄剧ず)
import { useEffect, useRef, useState } from "react";
import { useAppStore } from "../store/useAppStore";
import { useLocale } from "../i18n";
import { useSidebarStore } from "./store";
import { useAuiBridge } from "../runtime/AuiBridge";
import type { ProjectGroup as PG, GroupedSession } from "./groupSessions";
import { relativeTime } from "./relativeTime";
import { ProjectMenu } from "./ProjectMenu";
import { CollapsibleRow } from "./CollapsibleRow";
import { Collapsible } from "./Collapsible";
import { ProjectCapabilityFlyout, invalidateCapabilityCache } from "./ProjectCapabilityPanel";
import { useDeleteSessionGuard } from "./useDeleteSessionGuard";
import { apiScaffoldPlugin, downloadPluginExport } from "../api/plugin";
import { showToast } from "../components/Toast";

const COLLAPSE_LIMIT = 5;

interface Props {
  group: PG;
  pinned?: boolean;
  activeSessionId: string | null;
  onSelect: (id: string) => void;
}

export function ProjectGroup({ group, pinned = false, activeSessionId, onSelect }: Props) {
  const { t, locale } = useLocale();
  const [collapsed, setCollapsed] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [capOpen, setCapOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [draft, setDraft] = useState(group.name);
  const inputRef = useRef<HTMLInputElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  // 「查看能力」待打开标记：ProjectMenu 关闭后再开浮层，避免两个 DropdownMenu
  // 在同一事件循环里 dismiss 打架（否则浮层刚开就被菜单关闭连带 dismiss）。
  const pendingCapRef = useRef(false);
  const handleMenuOpenChange = (open: boolean) => {
    setMenuOpen(open);
    if (!open && pendingCapRef.current) {
      pendingCapRef.current = false;
      requestAnimationFrame(() => setCapOpen(true));
    }
  };
  const togglePin = useSidebarStore((s) => s.toggleProjectPin);
  const renameProject = useSidebarStore((s) => s.renameProject);
  const removeProject = useSidebarStore((s) => s.removeProject);
  const setDefaultWorkspace = useAppStore((s) => s.setDefaultWorkspace);
  const setActiveSessionId = useAppStore((s) => s.setActiveSessionId);

  const list = group.sessions;
  const visible = showAll ? list : list.slice(0, COLLAPSE_LIMIT);
  const hasMore = list.length > COLLAPSE_LIMIT;

  useEffect(() => {
    if (renaming) { const el = inputRef.current; if (el) { el.focus(); el.select(); } }
  }, [renaming]);

  const openDir = () => {
    fetch("/api/workspace/open-dir", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: group.path }),
    }).catch(() => {});
  };

  const newSessionHere = () => {
    setDefaultWorkspace(group.path);
    setActiveSessionId(null);
  };

  const startRename = () => { setDraft(group.name); setRenaming(true); };
  const commitRename = () => { renameProject(group.path, draft); setRenaming(false); };

  const handleScaffold = async () => {
    try {
      const r = await apiScaffoldPlugin(group.path);
      invalidateCapabilityCache(group.path);
      showToast("success", t("plugin.scaffoldDone", { n: r.created.length }));
    } catch (e) {
      showToast("error", e instanceof Error ? e.message : String(e));
    }
  };
  const handleExportPack = async () => {
    try {
      await downloadPluginExport(group.path);
    } catch (e) {
      // 后端错误码 → 友好文案；未知错误回退通用「导出失败」，不把原始码/JSON 弹给用户。
      const code = e instanceof Error ? e.message : "";
      const msg = code === "no_claude_dir" ? t("plugin.noClaude") : t("plugin.exportFail");
      showToast("error", msg);
    }
  };

  return (
    <div className="mt-1">
      {/* 椤圭洰琛?*/}
      {renaming ? (
        <div className="flex items-center gap-2 px-3 py-1">
          <FolderIcon open={false} />
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); commitRename(); }
              if (e.key === "Escape") setRenaming(false);
            }}
            className="flex-1 rounded border border-accent-brand bg-bg-000 px-1.5 py-0.5 text-[13px] text-text-100 outline-none"
          />
        </div>
      ) : (
        <div ref={rowRef} className={`group relative flex w-full min-w-0 items-center gap-2 rounded-sm px-3 py-1.5 text-[13px] text-text-200 transition-colors hover:bg-[#ECE6E2] dark:hover:bg-[#242424] ${menuOpen ? "bg-[#ECE6E2] dark:bg-[#242424]" : ""}`}>
          <button onClick={() => setCollapsed((v) => !v)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
            <FolderIcon open={!collapsed} />
            <span className="flex-1 truncate">{group.name}</span>
          </button>
          <ProjectCapabilityFlyout path={group.path} open={capOpen} onOpenChange={setCapOpen} anchorRef={rowRef} />
          <button
            onClick={(e) => { e.stopPropagation(); newSessionHere(); }}
            aria-label={t("sidebar.newSessionHere", { name: group.name })}
            title={t("sidebar.newSessionHere", { name: group.name })}
            className={`shrink-0 rounded p-0.5 text-text-400 transition-opacity hover:bg-bg-300 hover:text-text-200 group-hover:opacity-100 ${menuOpen ? "opacity-100" : "opacity-0"}`}
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>
          </button>
          <ProjectMenu
            pinned={pinned}
            onOpenChange={handleMenuOpenChange}
            onTogglePin={() => togglePin(group.path)}
            onOpenDir={openDir}
            onRename={startRename}
            onRemove={() => removeProject(group.path)}
            onViewCapabilities={() => { pendingCapRef.current = true; }}
            onScaffold={handleScaffold}
            onExportPack={handleExportPack}
          />
        </div>
      )}

      {/* 浼氳瘽鍒楄〃 / 绌烘€侊紙鎶樺彔鏃跺钩婊戝缂╅殣钘忥級 */}
      <Collapsible open={!collapsed}>
        {list.length === 0 ? (
          <div className="px-9 py-1 text-[13px] text-text-400/70">{t("sidebar.noConversations")}</div>
        ) : (
          <>
            {visible.map((s) => (
              <SessionRow
                key={s.id}
                session={s}
                active={activeSessionId === s.id}
                onClick={() => onSelect(s.id)}
              />
            ))}
            {hasMore && (
              <button
                onClick={() => setShowAll((v) => !v)}
                className="px-9 py-1 text-left text-[13px] text-text-400/70 transition-colors hover:text-text-300"
              >
                {showAll ? t("sidebar.showLess") : t("sidebar.showMore")}
              </button>
            )}
          </>
        )}
      </Collapsible>
    </div>
  );
}

function FolderIcon({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-text-400" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {open ? (
        <path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H21a2 2 0 0 1 1.94 2.5l-1.55 6A2 2 0 0 1 19.46 20H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.93a2 2 0 0 1 1.66.9l.82 1.2a2 2 0 0 0 1.66.9H18a2 2 0 0 1 2 2v2" />
      ) : (
        <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
      )}
    </svg>
  );
}

function SessionRow({ session, active, onClick }: {
  session: GroupedSession; active: boolean; onClick: () => void;
}) {
  const running = session.status === "running";
  const { sendEvent } = useAuiBridge();
  const { t, locale } = useLocale();
  const [confirming, setConfirming] = useState(false);
  const [removing, setRemoving] = useState(false);
  const guard = useDeleteSessionGuard();

  const onConfirmDelete = async () => {
    if (await guard(session.id)) setRemoving(true);
    else setConfirming(false);
  };

  return (
    <CollapsibleRow
      removing={removing}
      onRemoved={() => sendEvent({ type: "session.delete", payload: { sessionId: session.id } } as any)}
    >
    <div
      onClick={onClick}
      onMouseLeave={() => setConfirming(false)}
      className={`group flex w-full min-w-0 cursor-pointer items-center gap-2 rounded-sm py-1.5 pl-9 pr-3 text-left text-[13px] transition-colors ${
        active ? "bg-[#ECE6E2] font-medium text-text-100 dark:bg-[#242424]" : "text-text-200 hover:bg-[#ECE6E2] dark:hover:bg-[#242424]"
      }`}
    >
      <span className="min-w-0 flex-1 truncate">{session.title}</span>
      {confirming ? (
        <button
          onClick={(e) => { e.stopPropagation(); void onConfirmDelete(); }}
          className="shrink-0 rounded-md bg-danger-100 px-2 py-0.5 text-[11px] font-medium text-white transition-colors hover:bg-danger-200"
        >
          {t("sidebar.delete")}
        </button>
      ) : running ? (
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0 animate-spin text-text-400" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M21 12a9 9 0 1 1-6.2-8.6" />
        </svg>
      ) : (
        <>
          <span className="shrink-0 text-[11px] text-text-400/70 group-hover:hidden">{relativeTime(session.updatedAt, locale)}</span>
          <button
            onClick={(e) => { e.stopPropagation(); setConfirming(true); }}
            aria-label={t("sidebar.deleteSessionLabel")}
            title={t("sidebar.deleteSessionLabel")}
            className="hidden shrink-0 rounded-md p-0.5 text-text-400 transition-colors hover:bg-bg-300 hover:text-text-200 group-hover:block"
          >
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </>
      )}
    </div>
    </CollapsibleRow>
  );
}
