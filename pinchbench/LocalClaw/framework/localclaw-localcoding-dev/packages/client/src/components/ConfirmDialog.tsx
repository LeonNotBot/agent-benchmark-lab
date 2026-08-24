import { useState, useEffect, useCallback } from "react";
import { Modal, modalCancelBtn, modalPrimaryBtn, modalDangerBtn } from "./Modal";

type ConfirmOptions = {
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  /** 危险操作（删除等）→ 确认按钮用红色强调 */
  danger?: boolean;
};

type PendingConfirm = ConfirmOptions & { id: number; resolve: (ok: boolean) => void };

let openConfirmFn: ((opts: ConfirmOptions) => Promise<boolean>) | null = null;

/**
 * 全局确认对话框，替代原生 window.confirm()。
 * 用法：if (await confirmDialog({ message: "确定删除？", danger: true })) { ... }
 * 需在应用根部挂载一次 <ConfirmContainer />。
 */
export function confirmDialog(opts: ConfirmOptions): Promise<boolean> {
  if (!openConfirmFn) return Promise.resolve(window.confirm(opts.message));
  return openConfirmFn(opts);
}

let nextId = 0;

export function ConfirmContainer() {
  const [pending, setPending] = useState<PendingConfirm | null>(null);

  const open = useCallback((opts: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      setPending({ ...opts, id: nextId++, resolve });
    });
  }, []);

  useEffect(() => {
    openConfirmFn = open;
    return () => { openConfirmFn = null; };
  }, [open]);

  return <ConfirmView pending={pending} setPending={setPending} />;
}

function ConfirmView({
  pending,
  setPending,
}: {
  pending: PendingConfirm | null;
  setPending: (p: PendingConfirm | null) => void;
}) {
  // Enter 确认（Esc 取消由 Modal 基座统一处理）
  useEffect(() => {
    if (!pending) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter") { e.preventDefault(); finish(true); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending]);

  if (!pending) return null;

  const finish = (ok: boolean) => {
    pending.resolve(ok);
    setPending(null);
  };

  return (
    <Modal
      onClose={() => finish(false)}
      size="sm"
      title={pending.title}
      footer={
        <>
          <button onClick={() => finish(false)} className={modalCancelBtn}>
            {pending.cancelText || "取消"}
          </button>
          <button
            onClick={() => finish(true)}
            className={pending.danger ? modalDangerBtn : modalPrimaryBtn}
          >
            {pending.confirmText || "确定"}
          </button>
        </>
      }
    >
      <p className={`text-sm text-text-200 ${pending.title ? "mt-1.5" : ""}`}>{pending.message}</p>
    </Modal>
  );
}
