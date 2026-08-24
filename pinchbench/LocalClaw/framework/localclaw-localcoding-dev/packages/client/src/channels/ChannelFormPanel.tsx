import { useState, useEffect } from "react";
import { useLocale } from "../i18n";
import type { ChannelConfig, ChannelType } from "@lenovo/agent-protocol";
import { CHANNEL_TYPES, getChannelMeta, resolveChannelDisplayName } from "../settings/channel-fields";
import { WeChatLoginSection } from "./WeChatLoginSection";
import { showToast } from "../components/Toast";
import { apiBrowseFolder } from "../api/system";

interface Props {
  initial: ChannelConfig;
  isNew: boolean;
  channels: ChannelConfig[];
  wechatQrUrl: string | null;
  wechatQrWarning: string | null;
  onCancel: () => void;
  onSave: (ch: Partial<ChannelConfig> & { type: ChannelType }) => void | Promise<void>;
  onSaveInline: (ch: Partial<ChannelConfig> & { type: ChannelType }) => Promise<ChannelConfig | null>;
}

export function ChannelFormPanel({ initial, isNew, channels, wechatQrUrl, wechatQrWarning, onCancel, onSave, onSaveInline }: Props) {
  const { t } = useLocale();
  const [item, setItem] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [browsing, setBrowsing] = useState(false);

  // 内联保存（获取二维码时）会在 DB 创建渠道并分配新 id，父组件通过 initial 回传。
  // useState 只取首次初始值，须在此把新分配的 id 回填到本地 item，
  // 否则 item.id 一直为空，liveChannel 查不到，扫码成功后仍误判为「未绑定」。
  useEffect(() => {
    if (initial.id && initial.id !== item.id) {
      setItem((prev) => ({ ...prev, id: initial.id }));
    }
  }, [initial.id]);

  const meta = getChannelMeta(item.type);
  // 用 channels 数组中 live 的渠道（refresh 后已含 token），
  // 而非本地 stale 的 item（handleSaveInline 后 item.id 可能未及时同步）。
  // 找不到时回退 item.credentials.token（新建渠道时 onSaveInline 返回前仍需此判断）。
  const liveChannel = initial.id ? channels.find((c) => c.id === initial.id) : undefined;
  // 登录真相源：DB credentials.token（不依赖 status，规避 websocket 时序）
  const wechatBound = item.type === "wechat" && !!(
    liveChannel?.credentials?.token || item.credentials?.token
  );

  const set = (patch: Partial<ChannelConfig>) => setItem((s) => ({ ...s, ...patch }));
  const setCredential = (key: string, value: string) =>
    set({ credentials: { ...item.credentials, [key]: value } });

  // 打开系统文件夹选择器：Electron 走原生对话框，Web 端走后端 PowerShell/zenity 对话框。
  // 两者都只能选「已存在的文件夹」，从源头杜绝手输不存在路径的问题。
  // Web 端 PowerShell 冷启动约 1s+，故点击后立即进入 browsing 态给出反馈、防重复点击。
  const browseWorkspace = async () => {
    if (browsing) return;
    setBrowsing(true);
    try {
      const api = (window as any).electronAPI;
      const folder = api?.openFolderDialog
        ? await api.openFolderDialog()
        : await apiBrowseFolder();
      if (folder) set({ workspaceDir: folder });
    } catch {
      showToast("error", t("channel.workspaceBrowseFailed"));
    } finally {
      setBrowsing(false);
    }
  };

  const inputCls = "w-full rounded-lg border border-border-300 bg-bg-000 px-3 py-2 text-sm text-text-100 shadow-soft placeholder:text-text-400 focus:border-accent-brand/40 focus:outline-none transition-colors";
  // 所有 IM 渠道（golembot 引擎）均需工作目录：收到消息时以此作为会话 cwd 自动绑定，
  // 空值会导致用户保存成功却在发消息后才收到「请先 /bind」提示，故前移到保存校验。
  const canSave = !!item.name
    && (!meta?.fields.length || meta.fields.every((f) => !f.required || item.credentials[f.key]))
    && !!item.workspaceDir?.trim();
  const wechatNeedsBinding = item.type === "wechat" && isNew && !wechatBound;

  const handlePrimary = async () => {
    if (saving) return;
    if (wechatNeedsBinding) { showToast("warning", t("channel.wechatBindRequired")); return; }
    // 微信 token 由后端扫码写入 DB，本地 item.credentials 不含 token。
    // 提交时以 liveChannel.credentials 为基础合并用户编辑字段，避免 UPDATE 覆盖丢失 token。
    const credentials = liveChannel?.credentials
      ? { ...liveChannel.credentials, ...item.credentials }
      : item.credentials;
    setSaving(true);
    try {
      await onSave({ ...item, credentials });
    } finally {
      // 保存成功后父组件会切回列表卸载本组件，此处为 no-op；
      // 失败时组件仍挂载，需恢复按钮以便重试。
      setSaving(false);
    }
  };

  return (
    <div>
      {/* Back + Title */}
      <div className="flex items-center gap-3 mb-6">
        <button onClick={onCancel}
          className="flex items-center justify-center w-8 h-8 rounded-lg border border-border-300 bg-bg-000 text-text-400 hover:text-text-200 hover:border-border-200/40 transition-colors">
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <div>
          <h1 className="text-xl font-bold text-text-100">
            {isNew ? t("channel.addTitle", { name: meta ? t(meta.labelKey) : t("channel.defaultLabel") }) : t("channel.editTitle", { name: resolveChannelDisplayName(item.type, item.name, t) })}
          </h1>
          {meta?.descKey && <p className="text-xs text-text-400 mt-0.5">{t(meta.descKey)}</p>}
        </div>
      </div>

      {/* Form card */}
      <div className="rounded-xl border border-border-300 bg-bg-000 p-5 shadow-soft space-y-4">
        {/* Type (read-only) */}
        <Field label={t("channel.fieldType")}>
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border-300 bg-bg-100">
            <span className="text-sm text-text-200">{meta ? t(meta.labelKey) : item.type}</span>
          </div>
        </Field>

        {/* Name */}
        <Field label={t("channel.fieldName")}>
          <input className={inputCls} value={item.name}
            onChange={(e) => set({ name: e.target.value })}
            placeholder={t("channel.namePlaceholder", { label: meta ? t(meta.labelKey) : t("channel.myChannel") })} />
        </Field>

        {/* Credential fields */}
        {meta?.fields && meta.fields.length > 0 && meta.fields.map((field) => (
          <Field key={field.key} label={field.label}>
            <input type={field.secret ? "password" : "text"} className={inputCls}
              value={item.credentials[field.key] || ""}
              onChange={(e) => setCredential(field.key, e.target.value)}
              placeholder={field.placeholderKey ? t(field.placeholderKey) : field.placeholder} />
          </Field>
        ))}

        {/* Workspace —— 只能从文件夹选择器挑选已存在目录，杜绝手输不存在路径导致保存成功却无回复 */}
        <Field label={t("channel.workspaceLabel")}>
          <div className="flex items-center gap-2">
            <button type="button" onClick={browseWorkspace} disabled={browsing}
              className="shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-border-300 bg-bg-000 px-3 py-2 text-sm text-text-200 hover:bg-bg-100 hover:text-text-100 disabled:opacity-50 disabled:cursor-wait transition-colors">
              {browsing ? (
                <svg viewBox="0 0 24 24" className="h-4 w-4 animate-spin" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M12 3a9 9 0 1 0 9 9" strokeLinecap="round" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                </svg>
              )}
              {browsing ? t("channel.workspaceBrowsing") : t("channel.workspaceBrowse")}
            </button>
            <div className={`flex-1 truncate rounded-lg border border-border-300 px-3 py-2 text-sm ${item.workspaceDir ? "bg-bg-100 text-text-100" : "bg-bg-100 text-text-400"}`}
              title={item.workspaceDir || ""}>
              {item.workspaceDir || t("channel.workspaceUnset")}
            </div>
          </div>
          <p className="mt-1.5 text-[11px] text-text-400">{t("channel.workspaceHint")}</p>
        </Field>

        {/* WeChat login section */}
        {item.type === "wechat" && (
          <Field label={t("channel.wechatLogin")}>
            <WeChatLoginSection item={item} isNew={isNew} channels={channels}
              wechatQrUrl={wechatQrUrl} wechatQrWarning={wechatQrWarning}
              onSaveInline={onSaveInline} />
          </Field>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center justify-end gap-3 mt-6">
        <button onClick={onCancel} disabled={saving}
          className="rounded-lg border border-border-300 bg-bg-000 px-5 py-2.5 text-sm font-medium text-text-400 hover:bg-bg-100 hover:text-text-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
          {wechatBound ? t("channel.back") : t("channel.cancel")}
        </button>
        <button onClick={handlePrimary} disabled={!canSave || saving}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-accent-brand px-5 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity shadow-soft">
          {saving && (
            <svg viewBox="0 0 24 24" className="h-4 w-4 animate-spin" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M12 3a9 9 0 1 0 9 9" strokeLinecap="round" />
            </svg>
          )}
          {saving ? t("channel.saving") : wechatBound ? t("channel.done") : t("channel.save")}
        </button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-text-400">{label}</label>
      {children}
    </div>
  );
}
