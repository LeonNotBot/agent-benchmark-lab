import { useState, useEffect } from "react";
import type { SecretEntry } from "@lenovo/agent-protocol";
import { apiListSecrets, apiUpsertSecret, apiDeleteSecret } from "../api";
import { showToast } from "../components/Toast";
import { getSecretType } from "./secretType";
import { SecretDefEditor } from "./SecretDefEditor";

const svgProps = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export function SecretsPanel() {
  const [secrets, setSecrets] = useState<SecretEntry[]>([]);
  const [storagePath, setStoragePath] = useState("");
  const [loading, setLoading] = useState(false);
  const [revealedKeys, setRevealedKeys] = useState<Set<string>>(new Set());
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [formData, setFormData] = useState({ key: "", value: "", description: "" });
  const [defEditorOpen, setDefEditorOpen] = useState(false);

  useEffect(() => {
    loadSecrets();
  }, []);

  async function loadSecrets() {
    setLoading(true);
    try {
      const data = await apiListSecrets();
      setSecrets(data.secrets);
      setStoragePath(data.storagePath);
    } catch (err) {
      console.error("Failed to load secrets:", err);
      showToast("error", "加载隐私信息失败");
    } finally {
      setLoading(false);
    }
  }

  function toggleReveal(key: string) {
    setRevealedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function handleSave() {
    if (!formData.key.trim() || !formData.value.trim()) {
      showToast("error", "名称和内容不能为空");
      return;
    }
    try {
      await apiUpsertSecret(formData);
      showToast("success", editingKey === "__new__" ? "已添加" : "已更新");
      setEditingKey(null);
      setFormData({ key: "", value: "", description: "" });
      await loadSecrets();
    } catch (err) {
      console.error("Failed to save secret:", err);
      showToast("error", "保存失败");
    }
  }

  async function handleDelete(key: string) {
    if (!confirm(`确认删除「${key}」？此操作不可恢复。`)) return;
    try {
      await apiDeleteSecret(key);
      showToast("success", "已删除");
      setRevealedKeys((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
      await loadSecrets();
    } catch (err) {
      console.error("Failed to delete secret:", err);
      showToast("error", "删除失败");
    }
  }

  function startEdit(secret: SecretEntry) {
    setEditingKey(secret.key);
    setFormData({ key: secret.key, value: secret.value, description: secret.description });
  }

  function cancelEdit() {
    setEditingKey(null);
    setFormData({ key: "", value: "", description: "" });
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden min-w-0">
      <PanelHeader
        count={secrets.length}
        storagePath={storagePath}
        defEditorOpen={defEditorOpen}
        onAdd={() => {
          setDefEditorOpen(false);
          setEditingKey("__new__");
          setFormData({ key: "", value: "", description: "" });
        }}
        onToggleDefEditor={() => {
          setEditingKey(null);
          setDefEditorOpen((v) => !v);
        }}
      />

      <div className="flex-1 overflow-y-auto px-8 pb-10">
        {defEditorOpen ? (
          <SecretDefEditor onClose={() => setDefEditorOpen(false)} />
        ) : loading ? (
          <div className="text-center text-text-400 text-sm py-12">加载中...</div>
        ) : editingKey ? (
          <SecretForm
            isNew={editingKey === "__new__"}
            formData={formData}
            setFormData={setFormData}
            onSave={handleSave}
            onCancel={cancelEdit}
          />
        ) : secrets.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {secrets.map((secret) => (
              <SecretCard
                key={secret.key}
                secret={secret}
                revealed={revealedKeys.has(secret.key)}
                onToggle={() => toggleReveal(secret.key)}
                onEdit={() => startEdit(secret)}
                onDelete={() => handleDelete(secret.key)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────── Header ───────────────────────────

function PanelHeader({ count, storagePath, defEditorOpen, onAdd, onToggleDefEditor }: {
  count: number; storagePath: string; defEditorOpen: boolean;
  onAdd: () => void; onToggleDefEditor: () => void;
}) {
  return (
    <div className="shrink-0 px-8 pt-7 pb-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {/* 盾牌徽标 */}
          <div className="secret-badge relative flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-400 to-violet-500 text-white shadow-soft" style={{ ["--secret-glow" as string]: "99 102 241" }}>
            <svg className="h-6 w-6" viewBox="0 0 24 24" {...svgProps}>
              <path d="M12 2 4 5v6c0 5 3.5 8.5 8 10 4.5-1.5 8-5 8-10V5z" />
              <path d="m9 12 2 2 4-4" />
            </svg>
          </div>
          <div>
            <h1 className="text-xl font-bold text-text-100 flex items-center gap-2">
              隐私管理
              {count > 0 && (
                <span className="text-[11px] font-medium text-text-400 bg-bg-200 rounded-full px-2 py-0.5">{count}</span>
              )}
            </h1>
            <p className="text-xs text-text-400 mt-0.5">本地加密保险箱 · 仅存本机，永不上传</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onToggleDefEditor}
            title="定义哪些信息算隐私"
            className={`rounded-lg text-sm font-medium px-3 py-2 flex items-center gap-1.5 cursor-pointer transition-colors border ${
              defEditorOpen
                ? "bg-accent-brand/10 border-accent-brand text-accent-brand"
                : "bg-bg-000 border-border-300 text-text-300 hover:text-text-100 hover:border-border-200/40"
            }`}
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" {...svgProps}>
              <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
            隐私定义
          </button>
          <button
            onClick={onAdd}
            className="rounded-lg bg-accent-brand text-white text-sm font-semibold px-4 py-2 hover:bg-accent-hover shadow-soft flex items-center gap-1 cursor-pointer transition-all"
          >
            ＋ 添加
          </button>
        </div>
      </div>
      {storagePath && (
        <div className="mt-3 text-[11px] text-text-400 flex items-center gap-1.5">
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" {...svgProps}>
            <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><polyline points="13 2 13 9 20 9" />
          </svg>
          <span className="select-all">存储位置：{storagePath}</span>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────── Card ───────────────────────────

function SecretCard({ secret, revealed, onToggle, onEdit, onDelete }: {
  secret: SecretEntry; revealed: boolean;
  onToggle: () => void; onEdit: () => void; onDelete: () => void;
}) {
  const type = getSecretType(secret.key);
  return (
    <div
      className="secret-card group/card rounded-2xl border border-border-300 bg-bg-000 p-5"
      style={{ ["--secret-glow" as string]: type.glow }}
    >
      {/* 头部：图标徽章 + key + 类型标签 */}
      <div className="relative z-[2] flex items-start gap-3">
        <div className={`secret-badge flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ${type.badge} text-white`}>
          <svg className="h-5 w-5" viewBox="0 0 24 24" {...svgProps}>{type.icon}</svg>
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-bold text-text-100" title={secret.key}>{secret.key}</div>
          <div className="mt-0.5 inline-flex items-center gap-1 rounded-full bg-bg-200 px-2 py-0.5 text-[10px] font-medium text-text-300">
            {type.label}
          </div>
        </div>
        {/* 操作按钮 */}
        <div className="flex items-center gap-0.5 opacity-0 group-hover/card:opacity-100 transition-opacity">
          <button onClick={onEdit} title="编辑" className="p-1.5 text-text-400 hover:text-text-100 hover:bg-bg-200 rounded-lg transition-colors">
            <svg className="w-4 h-4" viewBox="0 0 24 24" {...svgProps}>
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
            </svg>
          </button>
          <button onClick={onDelete} title="删除" className="p-1.5 text-text-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors">
            <svg className="w-4 h-4" viewBox="0 0 24 24" {...svgProps}>
              <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            </svg>
          </button>
        </div>
      </div>

      {/* 值 */}
      <div className="relative z-[2] mt-3 flex items-center gap-2">
        <input
          type={revealed ? "text" : "password"}
          value={secret.value}
          readOnly
          className="flex-1 min-w-0 px-3 py-1.5 border border-border-300 rounded-lg bg-bg-100 text-text-100 text-xs font-mono outline-none select-all"
        />
        <button
          onClick={onToggle}
          title={revealed ? "隐藏" : "显示"}
          className="shrink-0 p-2 text-text-400 hover:text-text-100 hover:bg-bg-200 rounded-lg transition-colors"
        >
          {revealed ? (
            <svg className="w-4 h-4" viewBox="0 0 24 24" {...svgProps}>
              <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" /><line x1="1" y1="1" x2="23" y2="23" />
            </svg>
          ) : (
            <svg className="w-4 h-4" viewBox="0 0 24 24" {...svgProps}>
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" />
            </svg>
          )}
        </button>
      </div>

      {/* 用途 + 时间 */}
      {secret.description && (
        <div className="relative z-[2] mt-3 text-xs text-text-400 leading-relaxed line-clamp-2">{secret.description}</div>
      )}
      <div className="relative z-[2] mt-2 text-[10px] text-text-400">
        {secret.updatedAt !== secret.createdAt
          ? `更新于 ${new Date(secret.updatedAt).toLocaleString("zh-CN")}`
          : `创建于 ${new Date(secret.createdAt).toLocaleString("zh-CN")}`}
      </div>
    </div>
  );
}

// ─────────────────────────── Empty ───────────────────────────

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-20">
      <div className="secret-badge flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-400 to-violet-500 text-white mb-4" style={{ ["--secret-glow" as string]: "99 102 241" }}>
        <svg className="w-10 h-10" viewBox="0 0 24 24" {...svgProps}>
          <path d="M12 2 4 5v6c0 5 3.5 8.5 8 10 4.5-1.5 8-5 8-10V5z" /><path d="m9 12 2 2 4-4" />
        </svg>
      </div>
      <div className="text-text-300 text-sm font-medium">隐私保险箱是空的</div>
      <div className="text-text-400 text-xs mt-1">点击右上角「添加」存入第一条隐私信息</div>
    </div>
  );
}

// ─────────────────────────── Form ───────────────────────────

function SecretForm({ isNew, formData, setFormData, onSave, onCancel }: {
  isNew: boolean;
  formData: { key: string; value: string; description: string };
  setFormData: (d: { key: string; value: string; description: string }) => void;
  onSave: () => void; onCancel: () => void;
}) {
  return (
    <div className="max-w-2xl rounded-2xl border-2 border-accent-brand bg-bg-000 p-6 shadow-lg">
      <h3 className="text-base font-semibold text-text-100 mb-4">
        {isNew ? "添加隐私信息" : "编辑隐私信息"}
      </h3>
      <div className="space-y-4">
        <div>
          <label className="block text-xs font-medium text-text-200 mb-1.5">名称（Key）</label>
          <input
            type="text"
            value={formData.key}
            onChange={(e) => setFormData({ ...formData, key: e.target.value })}
            disabled={!isNew}
            placeholder="例如：OPENAI_API_KEY、ID_CARD_NUMBER、BANK_CARD"
            className="w-full px-3 py-2 border border-border-300 rounded-lg bg-bg-100 text-text-100 text-sm outline-none focus:border-accent-brand transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-text-200 mb-1.5">内容（Value）</label>
          <input
            type="text"
            value={formData.value}
            onChange={(e) => setFormData({ ...formData, value: e.target.value })}
            placeholder="敏感信息原文"
            className="w-full px-3 py-2 border border-border-300 rounded-lg bg-bg-100 text-text-100 text-sm outline-none focus:border-accent-brand transition-colors font-mono"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-text-200 mb-1.5">用途说明</label>
          <textarea
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            placeholder="例如：Anthropic API 认证令牌 / 本人身份证号"
            rows={2}
            className="w-full px-3 py-2 border border-border-300 rounded-lg bg-bg-100 text-text-100 text-sm outline-none focus:border-accent-brand transition-colors resize-none"
          />
        </div>
        <div className="flex gap-2 pt-2">
          <button onClick={onSave} className="px-4 py-2 bg-accent-brand text-white text-sm font-semibold rounded-lg hover:bg-accent-hover transition-colors">保存</button>
          <button onClick={onCancel} className="px-4 py-2 bg-bg-200 text-text-200 text-sm font-medium rounded-lg hover:bg-bg-300 transition-colors">取消</button>
        </div>
      </div>
    </div>
  );
}

