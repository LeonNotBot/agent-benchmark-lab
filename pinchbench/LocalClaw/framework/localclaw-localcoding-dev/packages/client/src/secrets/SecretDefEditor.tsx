import { useState, useEffect } from "react";
import type { SecretDefConfig, SecretCategory } from "@lenovo/agent-protocol";
import { apiGetSecretConfig, apiSaveSecretConfig } from "../api";
import { showToast } from "../components/Toast";

const svgProps = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export function SecretDefEditor({ onClose }: { onClose: () => void }) {
  const [config, setConfig] = useState<SecretDefConfig | null>(null);
  const [defaults, setDefaults] = useState<SecretDefConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    apiGetSecretConfig()
      .then((res) => {
        if (res) {
          setConfig(res.config);
          setDefaults(res.defaults);
        }
      })
      .catch((err) => {
        console.error("Failed to load secret config:", err);
        showToast("error", "加载隐私定义失败");
      })
      .finally(() => setLoading(false));
  }, []);

  function updateCategory(idx: number, patch: Partial<SecretCategory>) {
    if (!config) return;
    const categories = config.categories.map((c, i) => (i === idx ? { ...c, ...patch } : c));
    setConfig({ ...config, categories });
  }

  function addCategory() {
    if (!config) return;
    setConfig({ ...config, categories: [...config.categories, { label: "", examples: "" }] });
  }

  function removeCategory(idx: number) {
    if (!config) return;
    setConfig({ ...config, categories: config.categories.filter((_, i) => i !== idx) });
  }

  function restoreDefaults() {
    if (defaults) setConfig({ ...defaults, categories: defaults.categories.map((c) => ({ ...c })) });
  }

  async function handleSave() {
    if (!config) return;
    const categories = config.categories.filter((c) => c.label.trim() !== "");
    if (categories.length === 0) {
      showToast("error", "至少保留一个隐私类别");
      return;
    }
    setSaving(true);
    try {
      const saved = await apiSaveSecretConfig({ ...config, categories });
      if (saved) {
        showToast("success", "隐私定义已保存，将对新会话生效");
        onClose();
      } else {
        showToast("error", "保存失败");
      }
    } catch (err) {
      console.error("Failed to save secret config:", err);
      showToast("error", "保存失败");
    } finally {
      setSaving(false);
    }
  }

  if (loading || !config) {
    return <div className="text-center text-text-400 text-sm py-12">加载中...</div>;
  }

  return (
    <div className="max-w-3xl">
      {/* 说明 */}
      <div className="rounded-xl border border-border-300 bg-bg-100 px-4 py-3 mb-5 text-xs text-text-400 leading-relaxed flex gap-2">
        <svg className="w-4 h-4 shrink-0 mt-0.5 text-accent-brand" viewBox="0 0 24 24" {...svgProps}>
          <circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" />
        </svg>
        <span>
          这里定义「哪些信息算隐私」。AI 在对话中遇到这些类别的信息时，会自动存入隐私管理。
          修改后对<b className="text-text-200">新开的对话</b>生效（已进行中的对话不变）。
          执行机制（用工具存储、禁止明文回显等）由系统固定，不可更改。
        </span>
      </div>

      {/* 隐私类别 */}
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-text-100">隐私类别</h3>
        <button
          onClick={addCategory}
          className="text-xs text-accent-brand hover:text-accent-hover font-medium flex items-center gap-1 transition-colors"
        >
          ＋ 新增类别
        </button>
      </div>
      <div className="space-y-3">
        {config.categories.map((cat, idx) => (
          <div key={idx} className="rounded-xl border border-border-300 bg-bg-000 p-3.5">
            <div className="flex items-center gap-2 mb-2">
              <input
                value={cat.label}
                onChange={(e) => updateCategory(idx, { label: e.target.value })}
                placeholder="类别名，如「证件号码」"
                className="flex-1 px-3 py-1.5 border border-border-300 rounded-lg bg-bg-100 text-text-100 text-sm font-medium outline-none focus:border-accent-brand transition-colors"
              />
              <button
                onClick={() => removeCategory(idx)}
                title="删除类别"
                className="shrink-0 p-1.5 text-text-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" {...svgProps}>
                  <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                </svg>
              </button>
            </div>
            <textarea
              value={cat.examples}
              onChange={(e) => updateCategory(idx, { examples: e.target.value })}
              placeholder="该类别包含哪些信息，如：身份证号、护照号、社保号…"
              rows={2}
              className="w-full px-3 py-2 border border-border-300 rounded-lg bg-bg-100 text-text-300 text-xs outline-none focus:border-accent-brand transition-colors resize-none leading-relaxed"
            />
          </div>
        ))}
      </div>

      {/* 触发口语 */}
      <h3 className="text-sm font-semibold text-text-100 mt-6 mb-2">触发口语</h3>
      <input
        value={config.triggerPhrases}
        onChange={(e) => setConfig({ ...config, triggerPhrases: e.target.value })}
        placeholder="用户说哪些话时也应存储"
        className="w-full px-3 py-2 border border-border-300 rounded-lg bg-bg-100 text-text-100 text-sm outline-none focus:border-accent-brand transition-colors"
      />

      {/* 补充规则 */}
      <h3 className="text-sm font-semibold text-text-100 mt-6 mb-2">补充规则（可选）</h3>
      <textarea
        value={config.extraRules}
        onChange={(e) => setConfig({ ...config, extraRules: e.target.value })}
        placeholder="每行一条额外约束，例如：公司内部文档编号也视为隐私"
        rows={3}
        className="w-full px-3 py-2 border border-border-300 rounded-lg bg-bg-100 text-text-100 text-sm outline-none focus:border-accent-brand transition-colors resize-none leading-relaxed"
      />

      {/* 操作 */}
      <div className="flex items-center gap-2 mt-6">
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-4 py-2 bg-accent-brand text-white text-sm font-semibold rounded-lg hover:bg-accent-hover transition-colors disabled:opacity-60"
        >
          {saving ? "保存中..." : "保存"}
        </button>
        <button
          onClick={onClose}
          className="px-4 py-2 bg-bg-200 text-text-200 text-sm font-medium rounded-lg hover:bg-bg-300 transition-colors"
        >
          取消
        </button>
        <button
          onClick={restoreDefaults}
          className="ml-auto px-3 py-2 text-text-400 hover:text-text-200 text-xs transition-colors"
        >
          恢复默认
        </button>
      </div>
    </div>
  );
}
