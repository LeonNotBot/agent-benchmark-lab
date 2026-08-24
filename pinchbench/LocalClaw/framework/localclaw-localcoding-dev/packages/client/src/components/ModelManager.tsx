import { useLocale } from "../i18n";
import type { DeviceCapabilities } from "@lenovo/agent-protocol";

export function DeviceInfoCard({ caps }: { caps: DeviceCapabilities }) {
  const { t } = useLocale();
  return (
    <div className="rounded-lg border border-border-300 bg-bg-000 p-3 space-y-1.5 shadow-soft">
      <h3 className="text-xs font-semibold text-text-300 uppercase tracking-wide">{t("modelMgr.deviceInfo")}</h3>
      <div className="grid grid-cols-2 gap-1 text-xs text-text-400">
        <span>{t("modelMgr.gpu")}</span>
        <span className="text-right font-medium">{caps.gpuName ?? t("modelMgr.gpuNotDetected")}</span>
        <span>{t("modelMgr.vram")}</span>
        <span className="text-right font-medium">
          {caps.gpuVramMB > 0 ? `${Math.round(caps.gpuVramMB / 1024)} GB` : "N/A"}
        </span>
        <span>{t("modelMgr.ram")}</span>
        <span className="text-right font-medium">{Math.round(caps.ramMB / 1024)} GB</span>
        <span>{t("modelMgr.cpu")}</span>
        <span className="text-right font-medium">{caps.cpuCores} {t("modelMgr.cores")}</span>
      </div>
    </div>
  );
}
