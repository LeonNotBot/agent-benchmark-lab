// API 错误卡片：把 parseApiError 解析出的结构化错误渲染成可读卡片。
// 替代原先直接糊出 "API Error: 403 {...}" 英文+JSON 的体验。
// 自带「重新发送」(ActionBar.Reload)，故同消息不再额外显示「回复中断」提示。

import { ActionBarPrimitive } from "@assistant-ui/react";
import { useState } from "react";
import { useLocale } from "../../i18n";
import type { ParsedApiError, ApiErrorKind } from "../../runtime/parseApiError";

const KIND_KEY: Record<ApiErrorKind, string> = {
  balance: "apiError.balance",
  auth: "apiError.auth",
  rate_limit: "apiError.rateLimit",
  upstream: "apiError.upstream",
  network: "apiError.network",
  unknown: "apiError.unknown",
};

export function ApiErrorCard({ error }: { error: ParsedApiError }) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const hasDetail = !!error.requestId || !!error.raw;
  const title = t(KIND_KEY[error.kind] as any) || error.title;

  return (
    <div className="my-1 rounded-xl border border-border-300 bg-bg-000 px-3.5 py-2.5 text-sm">
      <div className="flex items-start gap-2.5">
        <svg viewBox="0 0 24 24" className="mt-0.5 h-4 w-4 shrink-0 text-text-400" fill="none" stroke="currentColor" strokeWidth="1.8">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 8v5M12 16h.01" strokeLinecap="round" />
        </svg>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-medium text-text-100">{title}</span>
            {error.code != null && (
              <span className="rounded bg-bg-200 px-1.5 py-0.5 text-[10px] text-text-400">
                {error.code}
              </span>
            )}
          </div>
          <p className="mt-0.5 break-words text-xs text-text-300">{error.message}</p>

          <div className="mt-2 flex items-center gap-3">
            <ActionBarPrimitive.Root>
              <ActionBarPrimitive.Reload className="rounded-md border border-border-300 px-2.5 py-0.5 text-xs font-medium text-text-200 transition-colors hover:border-accent-brand/40 hover:bg-bg-200">
                {t("thread.continueRun")}
              </ActionBarPrimitive.Reload>
            </ActionBarPrimitive.Root>
            {hasDetail && (
              <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                className="text-xs text-text-400 hover:text-text-200 transition-colors"
              >
                {open ? t("apiError.detailHide") : t("apiError.detail")}
              </button>
            )}
          </div>

          {open && hasDetail && (
            <div className="mt-2 space-y-1 border-t border-border-200 pt-2">
              {error.requestId && (
                <div className="text-[11px] text-text-400">
                  request id：<span className="select-all font-mono">{error.requestId}</span>
                </div>
              )}
              {error.raw && (
                <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-all rounded bg-bg-100 p-1.5 text-[10px] leading-relaxed text-text-400">
                  {error.raw}
                </pre>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
