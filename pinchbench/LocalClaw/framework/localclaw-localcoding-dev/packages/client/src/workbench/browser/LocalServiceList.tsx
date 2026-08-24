// Local 运行服务列表：探测常见本地端口，列出在线服务
import { useState, useEffect, useCallback } from "react";
import { useLocale } from "../../i18n";
import type { LocalService } from "./types";

const COMMON_PORTS = [3000, 3001, 4173, 5173, 5174, 8000, 8080, 8081, 8888, 9000];

async function probe(port: number): Promise<boolean> {
  try {
    await fetch(`http://localhost:${port}`, { mode: "no-cors", signal: AbortSignal.timeout(1200) });
    return true; // no-cors 下 opaque 响应也代表端口有服务在监听
  } catch { return false; }
}

interface Props {
  onOpen: (url: string) => void;
}

export function LocalServiceList({ onOpen }: Props) {
  const [services, setServices] = useState<LocalService[]>([]);
  const [loading, setLoading] = useState(false);
  const { t } = useLocale();

  const scan = useCallback(async () => {
    setLoading(true);
    const results = await Promise.all(
      COMMON_PORTS.map(async (port) => ({
        name: `localhost:${port}`,
        url: `http://localhost:${port}`,
        port,
        online: await probe(port),
      }))
    );
    setServices(results.filter((s) => s.online));
    setLoading(false);
  }, []);

  useEffect(() => { scan(); }, [scan]);

  return (
    <div className="px-3 py-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-medium text-text-300">{t("browser.localServices")}</span>
        <button onClick={scan} title={t("browser.rescan")}
          className="flex h-6 w-6 items-center justify-center rounded-md text-text-400 hover:bg-bg-200 hover:text-text-200">
          <svg viewBox="0 0 24 24" className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M23 4v6h-6M1 20v-6h6" /><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
          </svg>
        </button>
      </div>
      {services.length === 0 && !loading && (
        <div className="rounded-lg border border-dashed border-border-300 px-3 py-6 text-center text-xs text-text-400">
          {t("browser.noServices")}
        </div>
      )}
      <div className="flex flex-col gap-2">
        {services.map((s) => (
          <button key={s.port} onClick={() => onOpen(s.url)}
            className="flex items-center gap-3 rounded-xl border border-border-300 px-3 py-2.5 text-left transition-colors hover:bg-bg-100">
            <span className="flex h-9 w-12 shrink-0 items-center justify-center rounded-md bg-bg-200 text-[9px] text-text-400">
              {s.port}
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-text-100">{s.name}</div>
              <div className="truncate text-xs text-text-400">{s.url}</div>
            </div>
            <span className="h-2 w-2 shrink-0 rounded-full bg-success-100" />
          </button>
        ))}
      </div>
    </div>
  );
}
