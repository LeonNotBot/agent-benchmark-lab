// 撤销前置校验失败提示（4.png）：
// reason="not-git" → 非 git 仓库；reason="no-head" → 仓库无 commit/无可恢复基线。
import * as Dialog from "@radix-ui/react-dialog";
import { useLocale } from "../i18n";

interface Props {
  open: boolean;
  onClose: () => void;
  // 触发原因：决定标题/描述文案。默认 not-git（向后兼容）。
  reason?: "not-git" | "no-head";
}

export function NeedGitDialog({ open, onClose, reason = "not-git" }: Props) {
  const { t } = useLocale();
  const titleKey = reason === "no-head" ? "review.summary.noBaselineTitle" : "review.summary.needGitTitle";
  const descKey = reason === "no-head" ? "review.summary.noBaselineDesc" : "review.summary.needGitDesc";
  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[300] bg-black/40" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[301] w-[420px] max-w-[92vw] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border-300 bg-bg-000 p-6 shadow-elevated">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-red-50 text-red-500 dark:bg-red-950/40">
              <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="9" /><path d="M15 9l-6 6M9 9l6 6" />
              </svg>
            </span>
            <Dialog.Close className="ml-auto text-text-400 hover:text-text-200">
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </Dialog.Close>
          </div>
          <Dialog.Title className="mt-3 text-lg font-semibold text-text-100">
            {t(titleKey)}
          </Dialog.Title>
          <Dialog.Description className="mt-2 text-sm text-text-400">
            {t(descKey)}
          </Dialog.Description>
          <button
            onClick={onClose}
            className="mt-5 w-full rounded-xl bg-zinc-900 py-2.5 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            {t("review.summary.close")}
          </button>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
