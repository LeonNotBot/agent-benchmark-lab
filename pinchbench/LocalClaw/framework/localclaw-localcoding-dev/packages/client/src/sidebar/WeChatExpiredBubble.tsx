// 微信登录失效气泡：当微信渠道会话过期(status=error 且 token 仍在)时，
// 在侧栏微信栏目下方弹出醒目提示，引导用户一键跳转到渠道配置页重新扫码。
import { useEffect, useState } from "react";
import { useLocale } from "../i18n";
import { useAppStore } from "../store/useAppStore";

interface Props {
  channelId: string;
}

export function WeChatExpiredBubble({ channelId }: Props) {
  const { t } = useLocale();
  const [dismissed, setDismissed] = useState(false);
  const [entered, setEntered] = useState(false);
  const setSelectedChannelId = useAppStore((s) => s.setSelectedChannelId);
  const setChannelPanelMode = useAppStore((s) => s.setChannelPanelMode);
  const openView = useAppStore((s) => s.openView);

  // 进入动画：挂载后下一帧切换到可见态，触发淡入+下滑过渡
  useEffect(() => {
    const id = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(id);
  }, []);

  if (dismissed) return null;

  // 重新登录：深链到渠道配置页并直接打开该微信渠道的编辑表单，
  // WeChatLoginSection 检测到 sessionExpired 会自动呈现重新扫码卡片。
  const handleRelogin = () => {
    setSelectedChannelId(channelId);
    setChannelPanelMode("edit");
    openView("channels");
  };

  return (
    <div
      className={`mx-3 mt-1 overflow-hidden rounded-lg border border-danger/30 bg-danger/5 px-3 py-2.5 shadow-soft transition-all duration-300 ${
        entered ? "translate-y-0 opacity-100" : "-translate-y-1 opacity-0"
      }`}
      role="alert"
    >
      <div className="flex items-start gap-2">
        <svg viewBox="0 0 24 24" className="mt-0.5 h-4 w-4 shrink-0 text-danger" fill="none" stroke="currentColor" strokeWidth="2.2">
          <path d="M12 9v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <p className="flex-1 text-[12px] leading-snug text-text-200">{t("channel.wechatExpiredBubble")}</p>
        <button
          onClick={() => setDismissed(true)}
          aria-label={t("channel.wechatExpiredDismiss")}
          title={t("channel.wechatExpiredDismiss")}
          className="shrink-0 rounded p-0.5 text-text-400 transition-colors hover:bg-bg-300 hover:text-text-200"
        >
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>
      <div className="mt-2 flex justify-end">
        <button
          onClick={handleRelogin}
          className="rounded-md bg-accent-brand px-3 py-1 text-[12px] font-semibold text-white transition-opacity hover:opacity-90"
        >
          {t("channel.wechatRelogin")}
        </button>
      </div>
    </div>
  );
}
