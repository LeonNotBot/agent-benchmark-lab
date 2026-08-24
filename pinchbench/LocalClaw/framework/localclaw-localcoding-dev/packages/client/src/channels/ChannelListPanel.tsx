import { useState, useEffect, useRef } from "react";
import { useLocale } from "../i18n";
import type { ChannelConfig, ChannelType } from "@lenovo/agent-protocol";
import { CHANNEL_TYPES, getChannelMeta, resolveChannelDisplayName } from "../settings/channel-fields";

interface Props {
  channels: ChannelConfig[];
  onAdd: (type: ChannelType) => void;
  onEdit: (ch: ChannelConfig) => void;
  onDelete: (id: string) => void;
  onToggle: (id: string, enabled: boolean) => void;
  onTest: (id: string) => void;
  onRestart: (id: string) => void;
  onRefresh: () => void;
  showTypePicker?: boolean;
}

export function ChannelListPanel({ channels, onAdd, onEdit, onDelete, onToggle, onTest, onRestart, onRefresh, showTypePicker }: Props) {
  const { t } = useLocale();
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!pickerOpen) return;
    const onPointerDown = (ev: PointerEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(ev.target as Node)) setPickerOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [pickerOpen]);

  const statusColor = (s: ChannelConfig["status"]) =>
    s === "connected" ? "bg-green-500" : s === "connecting" ? "bg-yellow-500" : s === "error" ? "bg-red-500" : "bg-text-400/40";

  const statusLabel = (s: ChannelConfig["status"]) => {
    switch (s) {
      case "connected": return t("channel.statusConnected");
      case "connecting": return t("channel.statusConnecting");
      case "error": return t("channel.statusError");
      default: return t("channel.statusDisconnected");
    }
  };

  if (channels.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-4">
        <div className="rounded-xl border border-dashed border-border-300 p-8 text-center max-w-sm w-full">
          <div className="text-3xl mb-3 opacity-40">📡</div>
          <p className="text-sm text-text-400 mb-1">{t("channel.emptyHint")}</p>
          <p className="text-xs text-text-500">{t("channel.enable")}</p>
        </div>
        <div className="relative" ref={pickerRef}>
          <button onClick={() => setPickerOpen((v) => !v)}
            className="rounded-lg bg-accent-brand text-white text-sm font-semibold px-5 py-2.5 hover:opacity-90 shadow-soft transition-opacity">
            ＋ {t("channel.addChannel")}
          </button>
          {pickerOpen && (
            <div className="absolute left-1/2 -translate-x-1/2 z-10 mt-2 w-56 overflow-hidden rounded-xl border border-border-300 bg-bg-000 py-1 shadow-lg">
              {CHANNEL_TYPES.map((ct) => (
                <button key={ct.type} onClick={() => { setPickerOpen(false); onAdd(ct.type); }}
                  className="w-full px-4 py-2.5 text-left hover:bg-bg-100 transition-colors">
                  <div className="text-sm font-medium text-text-100">{t(ct.labelKey)}</div>
                  <div className="text-[11px] text-text-400">{t(ct.descKey)}</div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-end mb-4">
        <button onClick={onRefresh}
          className="flex items-center gap-1.5 rounded-lg border border-border-300 bg-bg-000 px-3 py-1.5 text-xs text-text-400 hover:text-text-200 hover:border-border-200/40 transition-colors">
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
          </svg>
          {t("channel.refreshStatus")}
        </button>
      </div>

      <div className="space-y-2">
        {channels.map((ch) => {
          const meta = getChannelMeta(ch.type);
          return (
            <div key={ch.id}
              className="group flex items-center gap-4 rounded-xl border border-border-300 bg-bg-000 px-4 py-3 transition-colors hover:border-border-200/60 hover:shadow-soft">
              {/* Status + Info */}
              <span className={`w-2 h-2 rounded-full shrink-0 ${statusColor(ch.status)}`} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-text-100">{resolveChannelDisplayName(ch.type, ch.name, t)}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-bg-200 text-text-400">{meta ? t(meta.labelKey) : ch.type}</span>
                </div>
                <div className="text-xs text-text-400 mt-0.5">
                  {statusLabel(ch.status)}
                  {ch.errorMessage && <span className="text-danger-100"> · {ch.errorMessage}</span>}
                </div>
              </div>

              {/* Quick toggle */}
              <label className="flex items-center gap-1.5 cursor-pointer shrink-0">
                <input type="checkbox" checked={ch.enabled}
                  onChange={(e) => onToggle(ch.id, e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-border-300 text-accent-brand focus:ring-accent-brand/20" />
                <span className="text-xs text-text-400">{t("channel.enable")}</span>
              </label>

              {/* Actions */}
              <div className="flex items-center gap-1 shrink-0">
                {/* 微信会话失效（error 且仍有 token）：列表页直达扫码入口，
                    点击跳转编辑表单（失效态会显式提示并提供「重新扫码」按钮），
                    避免用户在列表看到红点却不知去哪重新登录。 */}
                {ch.type === "wechat" && ch.status === "error" && !!ch.credentials?.token && (
                  <button onClick={() => onEdit(ch)}
                    className="rounded-md bg-accent-brand px-2.5 py-1 text-xs font-semibold text-white hover:opacity-90 transition-opacity">
                    {t("channel.wechatRescan")}
                  </button>
                )}
                <button onClick={() => onTest(ch.id)}
                  className="rounded-md px-2.5 py-1 text-xs text-text-400 hover:bg-bg-200 hover:text-text-200 transition-colors">
                  {t("channel.test")}
                </button>
                <button onClick={() => onRestart(ch.id)} disabled={!ch.enabled}
                  className="rounded-md px-2.5 py-1 text-xs text-text-400 hover:bg-bg-200 hover:text-text-200 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                  {t("channel.restart")}
                </button>
                <button onClick={() => onEdit(ch)}
                  className="rounded-md px-2.5 py-1 text-xs text-text-400 hover:bg-bg-200 hover:text-text-200 transition-colors">
                  {t("channel.edit")}
                </button>
                <button onClick={() => onDelete(ch.id)}
                  className="rounded-md px-2.5 py-1 text-xs text-text-400 hover:bg-danger-900 hover:text-danger-100 transition-colors">
                  {t("channel.delete")}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Add button */}
      {showTypePicker && (
        <div className="relative mt-3" ref={pickerRef}>
          <button onClick={() => setPickerOpen((v) => !v)}
            className="w-full rounded-lg border border-dashed border-border-300 bg-bg-000 px-4 py-2.5 text-sm text-text-400 hover:border-accent-brand/30 hover:text-text-200 hover:bg-purple-light2 transition-colors">
            ＋ {t("channel.addChannel")}
          </button>
          {pickerOpen && (
            <div className="absolute left-0 right-0 z-10 mt-1 overflow-hidden rounded-xl border border-border-300 bg-bg-000 py-1 shadow-lg">
              {CHANNEL_TYPES.map((ct) => (
                <button key={ct.type} onClick={() => { setPickerOpen(false); onAdd(ct.type); }}
                  className="w-full px-4 py-2.5 text-left hover:bg-bg-100 transition-colors">
                  <div className="text-sm font-medium text-text-100">{t(ct.labelKey)}</div>
                  <div className="text-[11px] text-text-400">{t(ct.descKey)}</div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
