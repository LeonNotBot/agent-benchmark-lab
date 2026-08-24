import { useState, useEffect } from "react";
import { useLocale } from "../i18n";
import type { ChannelConfig } from "@lenovo/agent-protocol";
import { apiReloginChannel } from "../api/channel";
import { showToast } from "../components/Toast";
import { confirmDialog } from "../components/ConfirmDialog";
import { useAppStore } from "../store/useAppStore";

interface Props {
  item: ChannelConfig;
  isNew: boolean;
  channels: ChannelConfig[];
  wechatQrUrl: string | null;
  wechatQrWarning: string | null;
  onSaveInline: (ch: Partial<ChannelConfig> & { type: any }) => Promise<ChannelConfig | null>;
}

export function WeChatLoginSection({ item, isNew, channels, wechatQrUrl, wechatQrWarning, onSaveInline }: Props) {
  const { t } = useLocale();
  const setWechatQrUrl = useAppStore((s) => s.setWechatQrUrl);
  const [qrLoading, setQrLoading] = useState(false);
  const [qrCountdown, setQrCountdown] = useState<number | null>(null);

  const liveChannel = item.id ? channels.find((c) => c.id === item.id) : undefined;
  // 登录真相源：DB credentials.token（不依赖 status，规避 websocket 时序）
  const wechatBound = !!liveChannel?.credentials?.token;
  // 会话失效态：token 字段仍在（曾扫码绑定）但渠道被标 error —— iLink session timeout
  // 场景。此时 token 已不可用，必须显式提示「失效」并引导重新扫码，
  // 不能沿用绿色「已绑定」状态（否则用户在列表看到红点、进表单却见绿框，找不到扫码入口）。
  const sessionExpired = wechatBound && liveChannel?.status === "error";

  useEffect(() => {
    if (!wechatQrUrl) { setQrCountdown(null); return; }
    let remaining = 8 * 60;
    setQrCountdown(remaining);
    const interval = setInterval(() => {
      remaining--;
      setQrCountdown(remaining);
      if (remaining <= 0) clearInterval(interval);
    }, 1000);
    return () => clearInterval(interval);
  }, [wechatQrUrl]);

  const fmt = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;
  const cdColor = (s: number) => s <= 30 ? "text-red-500" : s <= 60 ? "text-orange-500" : "text-text-400";

  const handleWechatLogin = async () => {
    if (!item.name) { showToast("warning", t("channel.nameRequired")); return; }

    // 已绑定且仍有效时：确认后才重新登录，避免误操作断开现有连接。
    // 会话已失效（sessionExpired）则无连接可断，直接重新扫码、不打断用户。
    if (wechatBound && !sessionExpired) {
      const ok = await confirmDialog({
        message: t("channel.reloginConfirm"),
        danger: true,
      });
      if (!ok) return;
    }

    setQrLoading(true);
    let channelId = item.id;
    // 无 id（新建草稿）→ 先内联保存创建渠道拿 id；id 会回填，再次点击复用不重复建
    if (!channelId) {
      const saved = await onSaveInline({ ...item });
      if (!saved) { setQrLoading(false); return; }
      channelId = saved.id;
    }
    const res = await apiReloginChannel(channelId);
    setQrLoading(false);
    if (!res.ok) {
      showToast("error", t("channel.loginFailed", { error: res.error ?? "" }));
      return;
    }
    // relogin 响应同步带回二维码：直接 set，不依赖 WS channel.qrcode 推送
    //（WS 事件可能丢/晚于跳转，REST 响应是确定到达的可靠来源）。
    if (res.qrDataUrl) setWechatQrUrl(res.qrDataUrl);
  };

  // QR code showing —— 最高优先级。后端 relogin 会同时推送 channel.saved（清 token）
  // 和 channel.qrcode（二维码 URL）两个事件，二者到达顺序不确定。若不优先判断
  // wechatQrUrl，channel.qrcode 先到、channel.saved 后到的瞬间 token 仍在，会落入
  // 「已绑定」分支把二维码吞掉，用户点重新扫码却看不到码。故只要有 QR 就先显示。
  if (wechatQrUrl) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-lg border border-border-300 bg-bg-000 p-5">
        <img src={wechatQrUrl} alt={t("channel.wechatQrAlt")}
          className="w-48 h-48 rounded-xl border border-border-200 shadow-soft" />
        <p className="text-sm text-text-400">{t("channel.wechatScanTip")}</p>
        <p className="text-xs text-text-400">{t("channel.wechatScanConfirmTip")}</p>
        {qrCountdown !== null && (
          <div className={`text-xs font-mono font-medium ${cdColor(qrCountdown)}`}>
            {t("channel.wechatQrExpireIn", { time: fmt(qrCountdown) })}
          </div>
        )}
        {wechatQrWarning && (
          <div className="flex items-center gap-2 w-full rounded-lg bg-orange-500/10 border border-orange-500/20 px-3 py-2 text-orange-500 text-xs">
            <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 9v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {wechatQrWarning}
          </div>
        )}
      </div>
    );
  }

  // Session-expired state: token 字段还在但会话失效（status=error）
  if (sessionExpired) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3">
        <div className="flex items-center justify-center w-8 h-8 rounded-full bg-red-500/10 text-red-500">
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M12 9v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <div className="flex-1">
          <div className="text-sm font-medium text-text-100">{t("channel.wechatSessionExpired")}</div>
          <p className="text-xs text-text-400">{t("channel.wechatSessionExpiredTip")}</p>
        </div>
        <button onClick={handleWechatLogin} disabled={qrLoading}
          className="rounded-lg bg-accent-brand px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 transition-opacity disabled:opacity-40">
          {qrLoading ? t("channel.loading") : t("channel.wechatRescan")}
        </button>
      </div>
    );
  }

  // Bound state
  if (wechatBound) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-green-500/20 bg-green-500/5 px-4 py-3">
        <div className="flex items-center justify-center w-8 h-8 rounded-full bg-green-500/10 text-green-500">
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M20 6L9 17l-5-5" />
          </svg>
        </div>
        <div className="flex-1">
          <div className="text-sm font-medium text-text-100">{t("channel.wechatBound")}</div>
          <p className="text-xs text-text-400">{t("channel.wechatBoundTip")}</p>
        </div>
        <button onClick={handleWechatLogin} disabled={qrLoading}
          className="rounded-lg border border-border-300 bg-bg-000 px-3 py-1.5 text-xs text-text-400 hover:text-text-200 hover:border-border-200/40 transition-colors disabled:opacity-40">
          {t("channel.restart")}
        </button>
      </div>
    );
  }

  // Get QR button
  return (
    <div className="space-y-3">
      <button
        onClick={handleWechatLogin}
        disabled={qrLoading || !item.name}
        className="w-full rounded-lg border border-border-300 bg-bg-000 px-4 py-2.5 text-sm text-text-200 hover:border-accent-brand/30 hover:bg-purple-light2 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
        {qrLoading ? t("channel.loading") : t("channel.getQrCode")}
      </button>
      <p className="text-xs text-text-400">{t("channel.wechatLoginHint")}</p>
    </div>
  );
}
