import { useState, useEffect } from "react";
import { useLocale } from "../i18n";
import {
  apiGetTechStack,
  apiPutTechStack,
  type TechStackConfig,
} from "../api/tech-stack";

const FIELDS: { key: keyof TechStackConfig; labelKey: string }[] = [
  { key: "language", labelKey: "techstack.language" },
  { key: "frontend", labelKey: "techstack.frontend" },
  { key: "backend", labelKey: "techstack.backend" },
  { key: "database", labelKey: "techstack.database" },
  { key: "packageManager", labelKey: "techstack.packageManager" },
  { key: "testing", labelKey: "techstack.testing" },
];

const EMPTY: TechStackConfig = {
  enabled: true,
  language: "",
  frontend: "",
  backend: "",
  database: "",
  packageManager: "",
  testing: "",
  customRules: "",
};

const inputCls =
  "w-full rounded-lg border border-border-300 bg-bg-000 px-3 py-2 text-xs text-text-100 outline-none focus:border-accent-brand/40 box-border";

export function TechStackSection() {
  const { t } = useLocale();
  const [config, setConfig] = useState<TechStackConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    apiGetTechStack().then((c) => setConfig(c ?? EMPTY));
  }, []);

  if (!config) {
    return (
      <div>
        <h2 className="text-sm font-semibold text-text-100 mb-3">{t("techstack.title")}</h2>
        <div className="text-xs text-text-400">{t("techstack.loading")}</div>
      </div>
    );
  }

  const update = (patch: Partial<TechStackConfig>) => {
    setConfig((prev) => (prev ? { ...prev, ...patch } : prev));
    setSaved(false);
  };

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    const result = await apiPutTechStack(config);
    if (result) {
      setConfig(result);
      setSaved(true);
    }
    setSaving(false);
  };

  return (
    <TechStackForm
      config={config}
      saving={saving}
      saved={saved}
      onUpdate={update}
      onSave={handleSave}
    />
  );
}

function TechStackForm({
  config,
  saving,
  saved,
  onUpdate,
  onSave,
}: {
  config: TechStackConfig;
  saving: boolean;
  saved: boolean;
  onUpdate: (patch: Partial<TechStackConfig>) => void;
  onSave: () => void;
}) {
  const { t } = useLocale();
  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-text-100">{t("techstack.title")}</h2>
        <button
          type="button"
          role="switch"
          aria-checked={config.enabled}
          onClick={() => onUpdate({ enabled: !config.enabled })}
          className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors ${
            config.enabled ? "bg-accent-brand" : "bg-border-300"
          }`}
        >
          <span
            className={`inline-block h-3 w-3 transform rounded-full bg-bg-000 shadow-sm transition-transform ${
              config.enabled ? "translate-x-3.5" : "translate-x-0.5"
            }`}
          />
        </button>
      </div>
      <p className="text-xs text-text-500 mb-4">
        {t("techstack.hint")}
      </p>

      <div
        className={`space-y-3 transition-opacity ${config.enabled ? "" : "opacity-40 pointer-events-none"}`}
      >
        {FIELDS.map((f) => (
          <div key={f.key} className="space-y-1">
            <label className="text-xs font-medium text-text-400">{t(f.labelKey)}</label>
            <input
              className={inputCls}
              value={config[f.key] as string}
              onChange={(e) => onUpdate({ [f.key]: e.target.value } as Partial<TechStackConfig>)}
            />
          </div>
        ))}
        <div className="space-y-1">
          <label className="text-xs font-medium text-text-400">{t("techstack.customRules")}</label>
          <textarea
            className={`${inputCls} resize-y leading-relaxed`}
            rows={3}
            value={config.customRules}
            onChange={(e) => onUpdate({ customRules: e.target.value })}
          />
        </div>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <button
          onClick={onSave}
          disabled={saving}
          className="rounded-lg border-none bg-accent-brand hover:bg-accent-hover px-4 py-2 text-xs font-semibold text-white cursor-pointer transition-colors disabled:opacity-50"
        >
          {saving ? t("techstack.saving") : t("techstack.save")}
        </button>
        {saved && <span className="text-xs text-green-600">{t("techstack.saved")}</span>}
      </div>
    </div>
  );
}
