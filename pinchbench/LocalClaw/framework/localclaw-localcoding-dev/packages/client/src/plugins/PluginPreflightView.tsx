// 导入弹窗内容体：文件选择 + 作用域选择 + 预检结果(摘要/冲突) + 操作按钮。
import type { PluginPreflight, PluginScope } from "@lenovo/agent-protocol";
import { useLocale } from "../i18n";
import { PluginAuditSection } from "./PluginAuditSection";

interface Props {
  fileName: string;
  scope: PluginScope;
  setScope: (s: PluginScope) => void;
  projectCwd: string;
  setProjectCwd: (p: string) => void;
  registeredProjects: string[];
  preflight: PluginPreflight | null;
  busy: boolean;
  includeLocalPerms: boolean;
  setIncludeLocalPerms: (v: boolean) => void;
  onPickFile: (f: File) => void;
  onPreflight: () => void;
  onInstall: (overwrite: boolean) => void;
  onCancel: () => void;
}

const dirName = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() || p;

export function PluginPreflightView(props: Props) {
  const { t } = useLocale();
  const {
    fileName, scope, setScope, projectCwd, setProjectCwd, registeredProjects,
    preflight, busy, includeLocalPerms, setIncludeLocalPerms,
    onPickFile, onPreflight, onInstall, onCancel,
  } = props;
  const hasConflict = !!preflight && preflight.conflicts.length > 0;

  return (
    <div className="space-y-3 text-[13px]">
      {/* 文件选择 */}
      <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-border-300 px-3 py-2.5 hover:border-accent-brand">
        <input type="file" accept=".zip" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) onPickFile(f); e.target.value = ""; }} />
        <span className="text-text-300">{fileName || t("plugin.pickZip")}</span>
      </label>

      {/* 作用域 */}
      <div className="flex items-center gap-2">
        <ScopeButton active={scope === "global"} onClick={() => setScope("global")} label={t("plugin.scopeGlobal")} />
        <ScopeButton active={scope === "project"} onClick={() => setScope("project")} label={t("plugin.scopeProject")} />
      </div>
      {scope === "project" && (
        <select value={projectCwd} onChange={(e) => setProjectCwd(e.target.value)}
          className="w-full rounded-lg border border-border-300 bg-bg-000 px-2 py-1.5 text-text-200">
          {registeredProjects.length === 0 && <option value="">{t("plugin.noProjects")}</option>}
          {registeredProjects.map((p) => <option key={p} value={p}>{dirName(p)}</option>)}
        </select>
      )}

      {/* 预检结果 */}
      {preflight && (
        <div className="rounded-lg bg-bg-200 p-3">
          <div className="font-medium text-text-100">{preflight.manifest.name}</div>
          {preflight.manifest.description && (
            <div className="mt-0.5 text-text-400">{preflight.manifest.description}</div>
          )}
          {hasConflict && (
            <div className="mt-2 text-[12px] text-amber-600">
              {t("plugin.conflictWarn", { n: preflight.conflicts.length })}
              <ul className="mt-1 max-h-24 overflow-y-auto">
                {preflight.conflicts.map((c) => <li key={c} className="truncate">· {c}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* 安全审查：脚本 + 权限 + local 开关 */}
      {preflight && (
        <PluginAuditSection
          audit={preflight.audit}
          includeLocalPerms={includeLocalPerms}
          setIncludeLocalPerms={setIncludeLocalPerms}
        />
      )}

      {/* 操作 */}
      <div className="flex justify-end gap-2 pt-1">
        <button onClick={onCancel} className="rounded-lg px-3 py-1.5 text-text-300 hover:bg-bg-200">
          {t("plugin.cancel")}
        </button>
        {!preflight ? (
          <button disabled={!fileName || busy} onClick={onPreflight}
            className="rounded-lg bg-accent-brand px-3 py-1.5 font-medium text-white disabled:opacity-40">
            {t("plugin.preflightBtn")}
          </button>
        ) : (
          <button disabled={busy} onClick={() => onInstall(hasConflict)}
            className="rounded-lg bg-accent-brand px-3 py-1.5 font-medium text-white disabled:opacity-40">
            {hasConflict ? t("plugin.overwriteInstall") : t("plugin.install")}
          </button>
        )}
      </div>
    </div>
  );
}

function ScopeButton({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button onClick={onClick}
      className={`flex-1 rounded-lg border px-3 py-1.5 transition-colors ${
        active ? "border-accent-brand bg-accent-brand/10 text-text-100" : "border-border-300 text-text-300 hover:bg-bg-200"
      }`}>
      {label}
    </button>
  );
}
