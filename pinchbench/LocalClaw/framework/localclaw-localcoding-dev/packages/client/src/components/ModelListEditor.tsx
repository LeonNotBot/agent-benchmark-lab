import { useState } from "react";
import type { ModelConfig } from "@lenovo/agent-protocol";
import { useLocale } from "../i18n";

/**
 * 共享「模型列表」编辑器：多行（ID + 显示名）+ 获取模型列表 + 全部添加 + 可点选 chips。
 * 所有 endpoint 卡片共用同一交互。
 * fetchModels 由调用方注入，统一打 /api/endpoints/models（试探给定 baseUrl 的可用模型）。
 */
export function ModelListEditor({
  models,
  onChange,
  fetchModels,
  canFetch = true,
}: {
  models: ModelConfig[];
  onChange: (m: ModelConfig[]) => void;
  fetchModels: () => Promise<{ ok: boolean; models: Array<{ id: string; maxOutputTokens?: number }>; error?: string }>;
  canFetch?: boolean;
}) {
  const { t } = useLocale();
  const [loading, setLoading] = useState(false);
  const [remote, setRemote] = useState<Array<{ id: string; maxOutputTokens?: number }> | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const update = (i: number, patch: Partial<ModelConfig>) =>
    onChange(models.map((m, idx) => (idx === i ? { ...m, ...patch } : m)));
  const inputCls =
    "flex-1 rounded-md border border-border-300 bg-bg-000 px-2 py-1 text-[11px] text-text-100 focus:border-accent-brand/40 focus:outline-none";
  const capInputCls =
    "w-24 rounded-md border border-border-300 bg-bg-000 px-2 py-1 text-[11px] text-text-100 focus:border-accent-brand/40 focus:outline-none";

  const handleFetch = async () => {
    setLoading(true);
    setFetchError(null);
    setRemote(null);
    const res = await fetchModels();
    setLoading(false);
    if (res.ok && res.models.length > 0) setRemote(res.models);
    else setFetchError(res.error || t("endpoint.fetchModelsFailed"));
  };

  const existingIds = new Set(models.map((m) => m.id));
  // 远程拉取的模型带上游声明的 maxOutputTokens（若有）→ 直接写入 ModelConfig，无需手填。
  // 上游没给（如 OpenAI/DeepSeek 的 /models 只返回 id）则留空，运行时落 gateway cap 表兜底。
  const addRemote = (rm: { id: string; maxOutputTokens?: number }) => {
    if (existingIds.has(rm.id)) return;
    onChange([...models, { id: rm.id, ...(rm.maxOutputTokens ? { maxOutputTokens: rm.maxOutputTokens } : {}) }]);
  };
  const addAllRemote = () => {
    const toAdd = (remote ?? [])
      .filter((rm) => !existingIds.has(rm.id))
      .map((rm) => ({ id: rm.id, ...(rm.maxOutputTokens ? { maxOutputTokens: rm.maxOutputTokens } : {}) }));
    if (toAdd.length) onChange([...models, ...toAdd]);
  };

  return (
    <Field label={t("endpoint.modelList")}>
      <div className="space-y-1.5">
        {fetchError && <p className="whitespace-pre-line text-[11px] text-amber-600">{t("endpoint.fetchErrorHint", { error: fetchError })}</p>}

        {models.map((m, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <input className={inputCls} value={m.id} onChange={(e) => update(i, { id: e.target.value })} placeholder={t("endpoint.modelIdPlaceholder")} />
            <input className={inputCls} value={m.label || ""} onChange={(e) => update(i, { label: e.target.value })} placeholder={t("endpoint.modelLabelPlaceholder")} />
            {/* 输出 token 上限：远程拉取时自动填入上游声明值；也可手填覆盖。留空则运行时落 gateway cap 表兜底。 */}
            <input
              className={capInputCls}
              type="number"
              value={m.maxOutputTokens ?? ""}
              onChange={(e) => {
                const v = e.target.value.trim();
                const n = v === "" ? undefined : Number(v);
                update(i, { maxOutputTokens: n && n > 0 ? n : undefined });
              }}
              placeholder={t("endpoint.maxOutputPlaceholder")}
              title={t("endpoint.maxOutputHint")}
            />
            <button onClick={() => onChange(models.filter((_, idx) => idx !== i))} className="rounded p-1 text-text-400 hover:text-danger-100">
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
            </button>
          </div>
        ))}
        <div className="flex items-center gap-3">
          <button onClick={() => onChange([...models, { id: "" }])} className="text-[11px] text-accent-brand hover:underline">
            + {t("endpoint.addModel")}
          </button>
          <button
            type="button"
            onClick={handleFetch}
            disabled={loading || !canFetch}
            className="rounded-md border border-border-300 px-2 py-1 text-[11px] text-text-300 hover:bg-bg-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? t("endpoint.fetching") : t("endpoint.fetchModels")}
          </button>
          {remote && remote.length > 0 && (
            <button type="button" onClick={addAllRemote} className="text-[11px] text-accent-brand hover:underline">
              {t("endpoint.addAll")}
            </button>
          )}
        </div>

        {remote && remote.length > 0 && (
          <div className="flex flex-wrap gap-1.5 rounded-md border border-border-200 bg-bg-100 p-2">
            {remote.map((rm) => {
              const added = existingIds.has(rm.id);
              const capLabel = rm.maxOutputTokens ? ` (${Math.round(rm.maxOutputTokens / 1000)}K)` : "";
              return (
                <button
                  key={rm.id}
                  type="button"
                  onClick={() => addRemote(rm)}
                  disabled={added}
                  title={added ? t("endpoint.added") : t("endpoint.clickToAdd")}
                  className={`rounded px-1.5 py-0.5 text-[11px] transition-colors ${
                    added
                      ? "bg-green-500/10 text-green-600 cursor-default"
                      : "border border-border-300 bg-bg-000 text-text-200 hover:border-accent-brand/40 hover:text-accent-brand"
                  }`}
                >
                  {added ? `✓ ${rm.id}${capLabel}` : `+ ${rm.id}${capLabel}`}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </Field>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-text-400">{label}</label>
      {children}
    </div>
  );
}
