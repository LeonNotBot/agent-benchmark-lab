import { useState, useEffect, useCallback } from "react";

type ToastType = "success" | "error" | "warning";
type ToastItem = { id: number; type: ToastType; message: string };

let addToastFn: ((type: ToastType, message: string) => void) | null = null;

/** 全局调用：showToast("success", "操作成功") */
export function showToast(type: ToastType, message: string) {
  addToastFn?.(type, message);
}

let nextId = 0;

export function ToastContainer() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const addToast = useCallback((type: ToastType, message: string) => {
    const id = nextId++;
    setToasts((prev) => [...prev, { id, type, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, type === "error" ? 6000 : 4000);
  }, []);

  useEffect(() => {
    addToastFn = addToast;
    return () => { addToastFn = null; };
  }, [addToast]);

  if (toasts.length === 0) return null;

  const colors: Record<ToastType, string> = {
    success: "bg-success text-white",
    error: "bg-danger text-white",
    warning: "bg-warning text-white",
  };

  return (
    <div className="fixed top-4 right-4 z-[100] flex flex-col gap-2 max-w-sm">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`${colors[t.type]} text-xs px-4 py-3 rounded-lg shadow-elevated animate-fade-in whitespace-pre-line`}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}
