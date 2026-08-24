// 工作目录缺失横幅：常驻 composer 顶部，灰底非阻塞（对齐 Codex 参考图）。
// 主文案加粗 + 副文案弱化 + 「重新选择目录」出口。选完写回 session.cwd 并清除缺失态。
import { useState } from "react";
import { useLocale } from "../i18n";
import { useAppStore } from "../store/useAppStore";
import { apiUpdateCwd } from "../api/session";

interface Props {
  sessionId: string;
  missingPath: string;
}

// 复用 settings 的目录选择交互：electron 优先，web 回退 browse-folder。
async function pickFolder(): Promise<string | null> {
  const api = (window as any).electronAPI;
  if (api?.openFolderDialog) {
    return (await api.openFolderDialog()) || null;
  }
  const res = await fetch("/api/system/browse-folder", { method: "POST" });
  const data = await res.json().catch(() => null);
  return data?.path || null;
}

export function CwdMissingBanner({ sessionId, missingPath }: Props) {
  const { t } = useLocale();
  const [busy, setBusy] = useState(false);

  const handleReselect = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const folder = await pickFolder();
      if (folder) {
        const r = await apiUpdateCwd(sessionId, folder);
        if (r?.ok && r.cwd) {
          // 写回成功：更新 store 的 cwd 并清除缺失态，横幅随之消失。
          // 同时把新目录登记为项目，否则会话因 cwd 未命中已登记项目而被归入「对话」分组。
          useAppStore.getState().registerProject(r.cwd);
          useAppStore.setState((state: any) => {
            const s = state.sessions[sessionId];
            if (!s) return state;
            return { sessions: { ...state.sessions, [sessionId]: { ...s, cwd: r.cwd, cwdMissing: undefined } } };
          });
        }
      }
    } catch { /* ignore */ }
    setBusy(false);
  };

  return (
    <div className="mb-1.5 flex items-center gap-2 rounded-lg bg-bg-200 px-2.5 py-1.5 text-xs text-text-300">
      <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-text-400" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
        <path d="M12 11v3M12 17h.01" />
      </svg>
      <div className="min-w-0 flex-1">
        <div className="font-medium text-text-200">{t("thread.cwdMissingTitle")}</div>
        <div className="truncate text-text-400">{t("thread.cwdMissingDesc", { path: missingPath })}</div>
      </div>
      <button
        onClick={handleReselect}
        disabled={busy}
        className="shrink-0 rounded-md border border-border-300 px-2 py-0.5 font-medium text-text-200 transition-colors hover:border-accent-brand/40 hover:bg-bg-000 disabled:opacity-50"
      >
        {busy ? "..." : t("thread.cwdReselect")}
      </button>
    </div>
  );
}
