import { useState, useEffect } from "react";
import { useAppStore } from "../store/useAppStore";
import { useLocale } from "../i18n";
import type { ChannelConfig, ChannelType } from "@lenovo/agent-protocol";
import { apiListChannels, apiSaveChannel, apiDeleteChannel, apiToggleChannel, apiTestChannel, apiRestartChannel } from "../api/channel";
import { getChannelMeta, CHANNEL_TYPES } from "../settings/channel-fields";
import { confirmDialog } from "../components/ConfirmDialog";
import { showToast } from "../components/Toast";
import { ChannelListPanel } from "./ChannelListPanel";
import { ChannelFormPanel } from "./ChannelFormPanel";

export function ChannelPanel() {
  const { t } = useLocale();
  const channels = useAppStore((s) => s.channels);
  const setChannels = useAppStore((s) => s.setChannels);
  const wechatQrUrl = useAppStore((s) => s.wechatQrUrl);
  const wechatQrWarning = useAppStore((s) => s.wechatQrWarning);
  const selectedChannelId = useAppStore((s) => s.selectedChannelId);
  const channelPanelMode = useAppStore((s) => s.channelPanelMode);
  const setChannelPanelMode = useAppStore((s) => s.setChannelPanelMode);
  const setSelectedChannelId = useAppStore((s) => s.setSelectedChannelId);
  const [editing, setEditing] = useState<ChannelConfig | null>(null);
  const [adding, setAdding] = useState(false);

  const activeChannels = channels;

  useEffect(() => {
    apiListChannels().then(setChannels).catch(() => {});
  }, []);

  useEffect(() => {
    // 仅响应外部导航（侧边栏深链到编辑 / 重置为列表）。
    // "add" 流程由 handleAdd 独占，此处不得清空 editing，否则会与刚设置的
    // 本地状态抢占，造成表单闪现一帧后又退回列表的闪烁。
    if (channelPanelMode === "edit" && selectedChannelId) {
      const ch = channels.find((c) => c.id === selectedChannelId);
      if (ch) { setEditing(ch); setAdding(false); }
    } else if (channelPanelMode === "list") {
      setEditing(null); setAdding(false);
    }
  }, [channelPanelMode, selectedChannelId, channels]);

  const refresh = async () => { const list = await apiListChannels(); setChannels(list); };

  const backToList = () => { setEditing(null); setAdding(false); setChannelPanelMode("list"); setSelectedChannelId(null); };

  const handleSave = async (channel: Partial<ChannelConfig> & { type: ChannelType }) => {
    const { channel: saved, error } = await apiSaveChannel(channel);
    if (saved) { await refresh(); backToList(); }
    if (saved?.status === "connected") showToast("success", t("channel.testSuccess"));
    else if (saved?.status === "error" && saved.errorMessage) showToast("error", t("channel.testFailed", { error: saved.errorMessage }));
    else if (!saved) showToast("error", error || t("channel.saveFailed"));
  };

  const handleSaveInline = async (channel: Partial<ChannelConfig> & { type: ChannelType }): Promise<ChannelConfig | null> => {
    const { channel: saved, error } = await apiSaveChannel(channel);
    if (saved) { await refresh(); setEditing((prev) => prev ? { ...prev, ...saved } : saved); }
    else showToast("error", error || t("channel.saveFailed"));
    return saved;
  };

  const handleDelete = async (id: string) => {
    if (!await confirmDialog({ title: t("channel.deleteTitle"), message: t("channel.deleteConfirm"), confirmText: t("channel.deleteConfirmText"), danger: true })) return;
    if (await apiDeleteChannel(id)) await refresh();
  };

  const handleToggle = async (id: string, enabled: boolean) => { await apiToggleChannel(id, enabled); await refresh(); };
  const handleTest = async (id: string) => { const r = await apiTestChannel(id); showToast(r.ok ? "success" : "error", r.ok ? t("channel.testSuccess") : t("channel.testFailed", { error: r.error ?? "" })); await refresh(); };
  const handleRestart = async (id: string) => { const r = await apiRestartChannel(id); showToast(r.ok ? "success" : "error", r.ok ? t("channel.restartSuccess") : t("channel.restartFailed", { error: r.error ?? "" })); await refresh(); };

  const handleAdd = (type: ChannelType) => {
    // 微信：复用已存在但未登录（无 token）的草稿渠道，避免反复点「获取二维码」堆出重复渠道
    if (type === "wechat") {
      const draft = channels.find((c) => c.type === "wechat" && !c.credentials?.token);
      if (draft) {
        setEditing(draft); setAdding(true); setChannelPanelMode("add"); setSelectedChannelId(null);
        return;
      }
    }
    // 所有渠道（含微信）均走 golembot 引擎。微信用 golembot 原生 WeixinAdapter，
    // 绝不可设 legacy——否则 GolemChannelManager.startChannel 见 legacy 直接 return，
    // adapter 永不启动，扫码后收不到消息也不回复。
    setEditing({ id: "", type, name: (getChannelMeta(type) ? t(getChannelMeta(type)!.labelKey) : type), enabled: true, credentials: {}, status: "disconnected", createdAt: Date.now(), updatedAt: Date.now(), engine: "golembot", workspaceDir: "" });
    setAdding(true); setChannelPanelMode("add"); setSelectedChannelId(null);
  };

  const handleEdit = (ch: ChannelConfig) => { setEditing(ch); setAdding(false); setChannelPanelMode("edit"); setSelectedChannelId(ch.id); };

  const handleCancel = async () => {
    if (adding && editing?.type === "wechat" && editing.id) {
      const live = channels.find((c) => c.id === editing.id);
      if (!live || live.status !== "connected") { await apiDeleteChannel(editing.id); await refresh(); }
    }
    backToList();
  };

  // --- form view ---
  if (editing) {
    return (
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl px-10 py-10">
          <ChannelFormPanel initial={editing} isNew={adding} channels={channels}
            wechatQrUrl={wechatQrUrl} wechatQrWarning={wechatQrWarning}
            onCancel={handleCancel} onSave={handleSave} onSaveInline={handleSaveInline} />
        </div>
      </div>
    );
  }

  // --- list view ---
  return (
    <div className="flex flex-1 flex-col overflow-hidden min-w-0">
      {/* Header */}
      <div className="shrink-0 px-8 pt-7 pb-4">
        <h1 className="text-xl font-bold text-text-100">{t("channel.sectionTitle")}</h1>
        <p className="text-xs text-text-400 mt-1">{t("channel.emptyHint")}</p>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-8 pb-10 pt-2">
        <ChannelListPanel channels={activeChannels} onAdd={handleAdd} onEdit={handleEdit}
          onDelete={handleDelete} onToggle={handleToggle} onTest={handleTest}
          onRestart={handleRestart} onRefresh={refresh} showTypePicker />
      </div>
    </div>
  );
}
