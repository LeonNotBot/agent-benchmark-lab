// 安全审查区：脚本清单 + 权限声明 + settings.local 权限的可选导入开关。
// 知情同意——纯告知性展示，local 开关默认关。
import type { PluginAudit } from "@lenovo/agent-protocol";
import { useLocale } from "../i18n";

export function PluginAuditSection({
  audit, includeLocalPerms, setIncludeLocalPerms,
}: {
  audit: PluginAudit;
  includeLocalPerms: boolean;
  setIncludeLocalPerms: (v: boolean) => void;
}) {
  const { t } = useLocale();
  const { scripts, permissions } = audit;
  const hasLocal = permissions.fromLocal.length > 0;
  if (scripts.length === 0 && permissions.fromSettings.length === 0 && !hasLocal) return null;

  return (
    <div className="rounded-lg border border-amber-300/50 bg-amber-50/40 p-3 dark:bg-amber-900/10">
      <div className="mb-1.5 text-[13px] font-medium text-amber-700 dark:text-amber-500">
        {t("plugin.auditTitle")}
      </div>
      {scripts.length > 0 && (
        <div className="mb-2 text-[12px] text-amber-600">{t("plugin.auditWarn", { n: scripts.length })}</div>
      )}

      {/* 脚本清单 */}
      {scripts.length > 0 && (
        <div className="mb-2">
          <div className="text-[12px] font-medium text-text-300">{t("plugin.auditScripts", { n: scripts.length })}</div>
          <ul className="mt-1 max-h-28 overflow-y-auto text-[12px] text-text-400">
            {scripts.map((s) => (
              <li key={s.path} className="flex items-center gap-2 truncate">
                <span className="shrink-0 rounded bg-bg-300 px-1 text-[10px] uppercase">{s.type}</span>
                <span className="truncate">{s.path}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* settings.json 权限（随包导入，告知性） */}
      {permissions.fromSettings.length > 0 && (
        <div className="mb-2">
          <div className="text-[12px] font-medium text-text-300">{t("plugin.auditPermissions")}</div>
          <ul className="mt-1 max-h-20 overflow-y-auto text-[12px] text-text-400">
            {permissions.fromSettings.map((p) => <li key={p} className="truncate">· {p}</li>)}
          </ul>
        </div>
      )}

      {/* settings.local.json 权限：可选导入开关（默认关） */}
      {hasLocal && (
        <label className="mt-1 flex cursor-pointer items-start gap-2 text-[12px] text-text-300">
          <input type="checkbox" checked={includeLocalPerms}
            onChange={(e) => setIncludeLocalPerms(e.target.checked)} className="mt-0.5" />
          <span>{t("plugin.importLocalPerms", { n: permissions.fromLocal.length })}</span>
        </label>
      )}
    </div>
  );
}
