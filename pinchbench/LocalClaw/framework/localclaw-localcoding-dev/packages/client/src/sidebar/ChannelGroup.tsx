// 鍗曚釜娓犻亾鍒嗙粍锛氭笭閬撹(鍥炬爣 + 鍚?+ 路路路鑿滃崟) + 娓犻亾浼氳瘽鍒楄〃
// 涓?ProjectGroup ux 瀵归綈锛氭姌鍙犲睍寮€ / 浼氳瘽鍒楄〃 / 閲嶅懡鍚?/ 缃《 / 闅愯棌
import { useEffect, useRef, useState } from "react";
import type { ChannelConfig } from "@lenovo/agent-protocol";
import type { GroupedSession, ChannelGroupData } from "./groupSessions";
import { useLocale } from "../i18n";
import { resolveChannelDisplayName } from "../settings/channel-fields";
import { useSidebarStore } from "./store";
import { ChannelMenu } from "./ChannelMenu";
import { CollapsibleRow } from "./CollapsibleRow";
import { Collapsible } from "./Collapsible";
import { useDeleteSessionGuard } from "./useDeleteSessionGuard";
import { relativeTime } from "./relativeTime";
import { WeChatExpiredBubble } from "./WeChatExpiredBubble";

const COLLAPSE_LIMIT = 5;

interface Props {
  channel: ChannelConfig;
  group: ChannelGroupData;
  pinned?: boolean;
  activeSessionId: string | null;
  onSelect: (id: string) => void;
}

export function ChannelGroup({ channel, group, pinned = false, activeSessionId, onSelect }: Props) {
  const { t, locale } = useLocale();
  const [collapsed, setCollapsed] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [draft, setDraft] = useState(group.name);
  const inputRef = useRef<HTMLInputElement>(null);
  const togglePin = useSidebarStore((s) => s.toggleChannelPin);
  const renameChannel = useSidebarStore((s) => s.renameChannel);

  const list = group.sessions;
  const visible = showAll ? list : list.slice(0, COLLAPSE_LIMIT);
  const hasMore = list.length > COLLAPSE_LIMIT;

  // 灞曠ず鍚嶅厹搴曟湰鍦板寲锛氶粯璁ゅ悕锛?绫诲瀷鏍囩锛夎窡闅忚瑷€鍒囨崲锛涚敤鎴疯嚜瀹氫箟鍚嶅師鏍蜂繚鐣?
  const displayName = resolveChannelDisplayName(channel.type, group.name, t);

  useEffect(() => {
    if (renaming) { const el = inputRef.current; if (el) { el.focus(); el.select(); } }
  }, [renaming]);

  const startRename = () => { setDraft(displayName); setRenaming(true); };
  const commitRename = () => { renameChannel(group.channelId, draft); setRenaming(false); };

  // 微信登录失效：曾扫码绑定(token 仍在)但渠道被标 error —— iLink 会话过期。
  // 与 WeChatLoginSection 的 sessionExpired 判据保持一致，避免「从未绑定」误报。
  const wechatExpired =
    channel.type === "wechat" && channel.status === "error" && !!channel.credentials?.token;

  return (
    <div className="mt-1">
      {/* 娓犻亾琛?*/}
      {renaming ? (
        <div className="flex items-center gap-2 px-3 py-1">
          <ChannelIcon type={channel.type} />
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
        <div className={`group flex w-full min-w-0 items-center gap-2 rounded-sm px-3 py-1.5 text-[13px] text-text-200 transition-colors hover:bg-[#ECE6E2] dark:hover:bg-[#242424] ${menuOpen ? "bg-[#ECE6E2] dark:bg-[#242424]" : ""}`}>
          <button onClick={() => setCollapsed((v) => !v)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
            <ChannelIcon type={channel.type} />
            <span className="flex-1 truncate">{displayName}</span>
            {/* 娓犻亾鐘舵€佹寚绀?*/}
            {channel.status === "connected" && (
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-success" title={t("channel.statusConnected")} />
            )}
            {channel.status === "error" && (
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-danger" title={channel.errorMessage ?? t("channel.statusError")} />
            )}
          </button>
          <ChannelMenu
            pinned={pinned}
            onOpenChange={setMenuOpen}
            onTogglePin={() => togglePin(group.channelId)}
            onRename={startRename}
          />
        </div>
      )}

      {/* 微信登录失效气泡：醒目提示 + 一键跳转重新登录。
          以 channelId+error 为 key，每次重新进入失效态时重挂载、复位关闭状态。 */}
      {wechatExpired && (
        <WeChatExpiredBubble key={`${group.channelId}-expired`} channelId={group.channelId} />
      )}

      {/* 会话列表 / 空态（折叠时平滑塌缩隐藏） */}
      <Collapsible open={!collapsed}>
        {list.length === 0 ? (
          <div className="px-9 py-1 text-[13px] text-text-400/70">{t("sidebar.noConversations")}</div>
        ) : (
          <>
            {visible.map((s) => (
              <ChannelSessionRow
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

function ChannelSessionRow({ session, active, onClick }: {
  session: GroupedSession; active: boolean; onClick: () => void;
}) {
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
      onRemoved={async () => {
        try {
          await fetch(`/api/sessions/${session.id}`, { method: "DELETE" });
        } catch { /* best-effort */ }
      }}
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
      ) : session.status === "running" ? (
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

// 娓犻亾绫诲瀷瀵瑰簲鍥炬爣
function ChannelIcon({ type }: { type: string }) {
  const cls = "h-4 w-4 shrink-0 text-text-400";
  switch (type) {
    case "feishu":
      return (
        <svg viewBox="0 0 24 24" className={cls} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 4h4l4 8 4-8h4v16h-5v-9l-3 6-3-6v9H4V4Z" />
        </svg>
      );
    case "dingtalk":
      return (
        <svg viewBox="0 0 24 24" className={cls} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <path d="M12 8v4l3 3" />
        </svg>
      );
    case "wecom":
      return (
        <svg viewBox="0 0 24 24" className={cls} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      );
    case "wechat":
      return (
        <svg viewBox="0 0 24 24" className={cls} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M8 10.5c0-1 .5-2 2-2.5M16 10.5c0-1-.5-2-2-2.5" />
          <path d="M9 9c0-2 1-3 3-3s3 1 3 3-1 3-3 3-3-1-3-3Z" />
          <path d="M15 15c0 2-1.5 3-3.5 3S8 17 8 15" />
          <path d="M12 2C6.48 2 2 6.48 2 12c0 2 .7 3.86 1.9 5.38L2 22l4.62-1.9A9.96 9.96 0 0 0 12 22c5.52 0 10-4.48 10-10S17.52 2 12 2Z" />
        </svg>
      );
    default:
      return (
        <svg viewBox="0 0 24 24" className={cls} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      );
  }
}
