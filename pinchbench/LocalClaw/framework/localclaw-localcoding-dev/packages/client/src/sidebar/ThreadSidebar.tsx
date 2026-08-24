// 宸︽爮锛氭柊瀵硅瘽 + 缃《/椤圭洰/瀵硅瘽 涓夋寮忓垎缁?+ 搴曢儴璁剧疆
import { useEffect, useMemo, useState } from "react";
import { useAppStore } from "../store/useAppStore";
import { useLocale } from "../i18n";
import { useSidebarStore, SIDEBAR_MIN_WIDTH } from "./store";
import { useSidebarResize } from "../hooks/useSidebarResize";
import { useAuiBridge } from "../runtime/AuiBridge";
import { SidebarSection } from "./SidebarSection";
import { ProjectGroup } from "./ProjectGroup";
import { ChannelGroup } from "./ChannelGroup";
import { CollapsibleRow } from "./CollapsibleRow";
import { useDeleteSessionGuard } from "./useDeleteSessionGuard";
import { groupSessions } from "./groupSessions";
import { SettingsSidebarContent } from "../settings/SettingsSidebarContent";
import { PANEL_NAV_ITEMS, NavRow } from "./navItems";
import { apiListChannelSessions } from "../api/channel";

export function ThreadSidebar() {
  const sessions = useAppStore((s) => s.sessions);
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const setActiveSessionId = useAppStore((s) => s.setActiveSessionId);
  const setSettingsPanelOpen = useAppStore((s) => s.setSettingsPanelOpen);
  const settingsPanelOpen = useAppStore((s) => s.settingsPanelOpen);
  const currentView = useAppStore((s) => s.currentView);
  const openView = useAppStore((s) => s.openView);
  const setChannelPanelMode = useAppStore((s) => s.setChannelPanelMode);
  const projectPins = useSidebarStore((s) => s.projectPins);
  const projectAliases = useSidebarStore((s) => s.projectAliases);
  const registeredProjects = useSidebarStore((s) => s.registeredProjects);
  const sessionPins = useSidebarStore((s) => s.sessionPins);
  const toggleSessionPin = useSidebarStore((s) => s.toggleSessionPin);
  const sidebarOpen = useSidebarStore((s) => s.sidebarOpen);
  const sidebarWidth = useSidebarStore((s) => s.sidebarWidth);
  // 娓犻亾鍒嗙粍鐘舵€?
  const channels = useAppStore((s) => s.channels);
  const channelPins = useSidebarStore((s) => s.channelPins);
  const channelAliases = useSidebarStore((s) => s.channelAliases);
  const channelHidden = useSidebarStore((s) => s.channelHidden);
  const channelSessions = useSidebarStore((s) => s.channelSessions);
  const mergeChannelSessions = useSidebarStore((s) => s.mergeChannelSessions);
  const { isDragging, dragWidth, handleDragStart } = useSidebarResize();
  const { sendEvent } = useAuiBridge();
  const { t } = useLocale();

  const groups = useMemo(
    () => groupSessions({
      sessions,
      registered: registeredProjects,
      pinned: projectPins,
      aliases: projectAliases,
      sessionPins,
      channels,
      channelSessions,
      channelPins,
      channelAliases,
      channelHidden,
    }),
    [sessions, registeredProjects, projectPins, projectAliases, sessionPins,
      channels, channelSessions, channelPins, channelAliases, channelHidden],
  );

  // 娓犻亾浼氳瘽鍒楄〃锛歝hannels 鍔犺浇鍚庡姣忎釜娓犻亾鎷夊彇浼氳瘽
  useEffect(() => {
    if (!channels.length) return;
    for (const ch of channels) {
      // 闅愯棌娓犻亾涓嶉鎷夛紙鐢ㄦ埛 unhide 鏃舵寜闇€鎷夛級銆傚凡缂撳瓨涔熼噸鎷変竴娆″苟 merge锛?
      // 浠ョ撼鍏ユ湇鍔＄鏈€鏂颁細璇濓紱merge 淇濊瘉涓嶈鐩栧疄鏃?upsert 杩涙潵鐨?live 浼氳瘽銆?
      if (channelHidden[ch.id]) continue;
      apiListChannelSessions(ch.id).then((list) => {
        mergeChannelSessions(ch.id, list.map((s) => ({
          id: s.id,
          title: s.title || "(鏈懡鍚?",
          status: s.status,
          updatedAt: s.updatedAt ?? s.createdAt,
        })));
      }).catch(() => {});
    }
  }, [channels]); // channelSessions 鍙樺寲涓嶈Е鍙戦噸鏂版媺鍙栵紙閬垮厤寰幆锛?

  // 褰撳墠瀹為檯瀹藉害锛氭嫋鎷戒腑鐢ㄤ复鏃跺€硷紝鏀惰捣涓?0锛屽惁鍒欑敤鎸佷箙鍖栧搴?
  const width = dragWidth ?? (sidebarOpen ? sidebarWidth : 0);
  // 鍐呭瀹瑰櫒瀹藉害锛氳窡闅忓灞傚彉瀹斤紝浣嗕笉浣庝簬鏈€灏忓搴︼紙鏀惰捣鍔ㄧ敾鏃惰瑁佸垏婊戝嚭锛屾枃瀛椾笉閲嶆帓锛?
  const contentWidth = Math.max(width, SIDEBAR_MIN_WIDTH);

  // 浠呭湪瀵硅瘽瑙嗗浘涓嬮珮浜細璇濓紱鍒囧埌鎼滅储/鎻掍欢/鑷姩鍖栫瓑闈㈡澘鏃讹紝浼氳瘽涓嶅簲淇濇寔楂樹寒
  const highlightSessionId = currentView === "chat" ? activeSessionId : null;

  return (
    <aside
      className="chrome-surface relative flex h-full shrink-0 flex-col overflow-hidden"
      style={{
        width,
        transition: isDragging ? "none" : "width 250ms ease",
      }}
    >
      {/* 鍐呭瀹瑰櫒锛氶伩鍏嶆敹璧峰姩鐢绘椂鏂囧瓧閲嶆帓璺冲姩 */}
      <div className="flex h-full flex-col" style={{ width: contentWidth, minWidth: contentWidth }}>
      {settingsPanelOpen ? (
        <SettingsSidebarContent />
      ) : (
        <>
        {/* 椤堕儴锛氭柊瀵硅瘽 */}
        <div className="px-2 pt-3">
        <button
          onClick={() => setActiveSessionId(null)}
          className="flex w-full items-center gap-2.5 rounded px-3 py-2 text-[13px] font-medium text-text-100 transition-colors hover:bg-[#ECE6E2] dark:hover:bg-[#242424]"
        >
          <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
          </svg>
          {t("sidebar.newChat")}
        </button>
      </div>

      {/* 瀵艰埅椤癸細鑷姩鍖?/ 娓犻亾绠＄悊銆傜偣鍑诲垏鍒板搴旈潰鏉匡紝鍙充晶鏇挎崲鏄剧ず锛屽乏杈规爮涓嶅彉 */}
      {PANEL_NAV_ITEMS.length > 0 && (
        <div className="px-2 pt-1">
          {PANEL_NAV_ITEMS.map((item) => (
            <NavRow
              key={item.view}
              label={t(item.labelKey)}
              active={currentView === item.view}
              onClick={() => {
                // 娓犻亾闈㈡澘杩涘叆鏃跺己鍒跺洖鍒板垪琛ㄦ€侊紝閬垮厤涓婃鍋滃湪缂栬緫椤垫椂鐩存帴寮瑰嚭琛ㄥ崟
                if (item.view === "channels") setChannelPanelMode("list");
                openView(item.view);
              }}
            >
              {item.icon}
            </NavRow>
          ))}
        </div>
      )}

      {/* 浼氳瘽鍒楄〃鍖猴細娓犻亾 / 缃《 / 椤圭洰 / 瀵硅瘽銆俿crollbar-gutter:stable 璁╂粴鍔ㄦ潯鍗犻鐣?gutter锛?
          涓嶆尋鍗犲唴瀹广€佷笉閬尅琛屽彸鍦嗚 */}
      <nav className="flex-1 overflow-y-auto px-2 pb-2 [scrollbar-gutter:stable]" style={{ overflowAnchor: "none" }}>
        {/* 娓犻亾鍒嗙粍锛氭瘡涓笭閬撲竴缁?*/}
        {groups.channels.length > 0 && (
          <SidebarSection title={t("sidebar.channels")}>
            {groups.channels.map((g) => {
              const ch = channels.find((c) => c.id === g.channelId);
              if (!ch) return null;
              return (
                <ChannelGroup
                  key={g.channelId}
                  channel={ch}
                  group={g}
                  pinned={channelPins.includes(g.channelId)}
                  activeSessionId={highlightSessionId}
                  onSelect={setActiveSessionId}
                />
              );
            })}
          </SidebarSection>
        )}

        {(groups.pinnedSessions.length > 0 || groups.pinned.length > 0) && (
          <SidebarSection title={t("sidebar.pinned")}>
            {groups.pinnedSessions.map((c) => (
              <SessionItem
                key={c.id}
                sessionId={c.id}
                title={c.title}
                status={c.status}
                pinned
                active={highlightSessionId === c.id}
                onClick={() => setActiveSessionId(c.id)}
                onTogglePin={() => toggleSessionPin(c.id)}
                onDelete={() => sendEvent({ type: "session.delete", payload: { sessionId: c.id } } as any)}
              />
            ))}
            {groups.pinned.map((g) => (
              <ProjectGroup key={g.path} group={g} pinned activeSessionId={highlightSessionId} onSelect={setActiveSessionId} />
            ))}
          </SidebarSection>
        )}

        <SidebarSection title={t("sidebar.projects")}>
          {groups.projects.length === 0 && (
            <div className="px-3 py-2 text-xs text-text-400">{t("sidebar.noProjects")}</div>
          )}
          {groups.projects.map((g) => (
            <ProjectGroup key={g.path} group={g} activeSessionId={highlightSessionId} onSelect={setActiveSessionId} />
          ))}
        </SidebarSection>

        {groups.loose.length > 0 && (
          <SidebarSection title={t("sidebar.conversations")}>
            {groups.loose.map((c) => (
              <SessionItem
                key={c.id}
                sessionId={c.id}
                title={c.title}
                status={c.status}
                active={highlightSessionId === c.id}
                onClick={() => setActiveSessionId(c.id)}
                onTogglePin={() => toggleSessionPin(c.id)}
                onDelete={() => sendEvent({ type: "session.delete", payload: { sessionId: c.id } } as any)}
              />
            ))}
          </SidebarSection>
        )}
      </nav>

      {/* 搴曢儴锛氳缃?*/}
      <div className="px-2 py-2">
        <button
          onClick={() => setSettingsPanelOpen(true)}
          className="flex w-full items-center gap-2.5 rounded px-3 py-2 text-[13px] text-text-300 transition-colors hover:bg-[#ECE6E2] hover:text-text-100 dark:hover:bg-[#242424]"
        >
          <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.8">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
          </svg>
          {t("sidebar.settingsEntry")}
        </button>
      </div>
        </>
      )}
      </div>

      {/* 鍙宠竟缂樻嫋鎷芥墜鏌?*/}
      {sidebarOpen && (
        <div
          onMouseDown={handleDragStart}
          className="absolute right-0 top-0 z-10 flex h-full w-1.5 cursor-col-resize justify-center group"
          title={t("sidebar.resizeWidth")}
        >
          <div className="h-full w-px bg-transparent transition-colors group-hover:bg-accent-brand/60" />
        </div>
      )}
    </aside>
  );
}

function SessionItem({ sessionId, title, status, active, pinned = false, onClick, onTogglePin, onDelete }: {
  sessionId: string; title: string; status?: string; active: boolean; pinned?: boolean;
  onClick: () => void; onTogglePin: () => void; onDelete: () => void;
}) {
  const dot = status === "running" ? "bg-info" : status === "error" ? "bg-danger" : null;
  // 鍒犻櫎浜や簰锛歩dle 鈫?鏄剧ず鍙夊彿锛沜onfirm 鈫?鏄剧ず"鍒犻櫎"鎸夐挳锛涚偣鍑诲悗鍏堣窇瀹堝崼锛堢粦瀹氳嚜鍔ㄥ寲鍒欏脊绐?
  // 纭涓€骞跺垹闄わ級锛岄€氳繃鍐嶆挱鏀惧缂╅€€鍦哄姩鐢伙紝鍔ㄧ敾缁撴潫鎵嶇湡姝ｆ墽琛屽垹闄わ紝閬垮厤鍒楄〃鏁翠綋閲嶆帓闂儊銆?
  const [confirming, setConfirming] = useState(false);
  const [removing, setRemoving] = useState(false);
  const guard = useDeleteSessionGuard();
  const { t } = useLocale();

  const onConfirmDelete = async () => {
    if (await guard(sessionId)) setRemoving(true);
    else setConfirming(false);
  };

  return (
    <CollapsibleRow removing={removing} onRemoved={onDelete}>
    <div
      onClick={onClick}
      onMouseLeave={() => setConfirming(false)}
      className={`group flex w-full min-w-0 cursor-pointer items-center gap-2 rounded-sm px-3 py-1.5 text-left text-[13px] transition-colors ${
        active ? "bg-[#ECE6E2] font-medium text-text-100 dark:bg-[#242424]" : "text-text-200 hover:bg-[#ECE6E2] dark:hover:bg-[#242424]"
      }`}
    >
      {dot && <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />}
      <span className="min-w-0 flex-1 truncate">{title}</span>

      {confirming ? (
        <button
          onClick={(e) => { e.stopPropagation(); void onConfirmDelete(); }}
          className="shrink-0 rounded-md bg-danger-100 px-2 py-0.5 text-[11px] font-medium text-white transition-colors hover:bg-danger-200"
        >
          {t("sidebar.delete")}
        </button>
      ) : (
        <>
          {/* 缃《/鍙栨秷缃《锛歨over 鏄剧ず锛涚疆椤舵€佸疄蹇冨浘閽?*/}
          <button
            onClick={(e) => { e.stopPropagation(); onTogglePin(); }}
            aria-label={pinned ? t("sidebar.unpinSession") : t("sidebar.pinSession")}
            title={pinned ? t("sidebar.unpinSession") : t("sidebar.pinSession")}
            className="shrink-0 rounded-md p-0.5 text-text-400 opacity-0 transition-opacity hover:bg-bg-300 hover:text-text-200 group-hover:opacity-100"
          >
            <PinIcon filled={pinned} />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); setConfirming(true); }}
            aria-label={t("sidebar.deleteSessionLabel")}
            title={t("sidebar.deleteSessionLabel")}
            className="shrink-0 rounded-md p-0.5 text-text-400 opacity-0 transition-opacity hover:bg-bg-300 hover:text-text-200 group-hover:opacity-100"
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

// 鍥鹃拤鍥炬爣锛歰utline(鏈疆椤? / filled(宸茬疆椤?銆?5掳 鍊炬枩鐨勭粡鍏稿浘閽夐€犲瀷銆?
function PinIcon({ filled }: { filled: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-3.5 w-3.5"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M9 4 15 4 14 10 18 14 6 14 10 10 9 4Z" />
      <path d="M12 14 12 20" />
    </svg>
  );
}
