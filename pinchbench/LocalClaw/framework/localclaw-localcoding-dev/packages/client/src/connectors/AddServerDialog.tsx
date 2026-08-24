/**
 * 添加 / 编辑 MCP Server 对话框。
 */
import { useState } from "react";
import type { MCPServer, MCPServerConfig, MCPServerTransportType } from "@lenovo/agent-protocol";
import { useLocale } from "../i18n";
import { modalPanel, modalTitle, modalInput, modalCancelBtn, modalPrimaryBtn, ModalCloseButton } from "../components/Modal";

type ServerInput = Omit<MCPServerConfig, "id" | "createdAt" | "updatedAt">;

/** 编辑模式下已存在的敏感值占位符，避免明文回显 */
const SECRET_PLACEHOLDER = "********";

/** 环境变量行（有序，支持行内编辑） */
interface EnvRow {
  key: string;
  value: string;
}

interface Props {
  /** 传入则进入编辑模式，否则为创建模式 */
  editing?: MCPServer | null;
  onClose: () => void;
  onSubmit: (input: ServerInput, editingId?: string) => void;
}

const PRESETS: Array<{
  id: string;
  name: string;
  descKey: string;
  type: MCPServerTransportType;
  command: string;
  args: string[];
  requiredEnvKeys: string[];
  website?: string;
}> = [
  {
    id: "github",
    name: "GitHub",
    descKey: "connector.preset.github",
    type: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-github"],
    requiredEnvKeys: ["GITHUB_TOKEN"],
    website: "https://github.com/modelcontextprotocol/servers/tree/main/src/github",
  },
  {
    id: "filesystem",
    name: "Filesystem",
    descKey: "connector.preset.filesystem",
    type: "stdio",
    command: "npx",
    // 钉版 2025.1.14：该版本忽略 MCP roots、只认命令行参数目录，使连接器页配置的目录真正生效。
    // 新版（2026.x）会用 CLI 发来的会话目录作为 roots 覆盖此处配置（见 change fix-filesystem-connector-roots）。
    args: ["-y", "@modelcontextprotocol/server-filesystem@2025.1.14"],
    requiredEnvKeys: [],
    website: "https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem",
  },
  {
    id: "fetch",
    name: "Fetch",
    descKey: "connector.preset.fetch",
    type: "stdio",
    command: "uvx",
    args: ["mcp-server-fetch"],
    requiredEnvKeys: [],
    website: "https://github.com/modelcontextprotocol/servers/tree/main/src/fetch",
  },
  {
    id: "figma",
    name: "Figma",
    descKey: "connector.preset.figma",
    type: "stdio",
    command: "npx",
    args: ["-y", "figma-developer-mcp", "--stdio"],
    requiredEnvKeys: ["FIGMA_API_KEY"],
    website: "https://github.com/GLips/Figma-Context-MCP",
  },
  {
    id: "slack",
    name: "Slack",
    descKey: "connector.preset.slack",
    type: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-slack"],
    requiredEnvKeys: ["SLACK_BOT_TOKEN", "SLACK_TEAM_ID"],
    website: "https://github.com/modelcontextprotocol/servers/tree/main/src/slack",
  },
];

export function AddServerDialog({ editing, onClose, onSubmit }: Props) {
  const { t } = useLocale();
  const isEditing = !!editing;
  const [step, setStep] = useState<"preset" | "custom">(isEditing ? "custom" : "preset");
  const [form, setForm] = useState({
    name: editing?.name ?? "",
    description: editing?.description ?? "",
    type: "stdio" as MCPServerTransportType,
    command: editing?.command ?? "",
    args: editing?.args?.join(" ") ?? "",
    url: editing?.url ?? "",
  });
  // 环境变量：编辑模式已存在的值用占位符，不回显明文
  const [envRows, setEnvRows] = useState<EnvRow[]>(() => {
    if (!editing?.env) return [];
    return Object.keys(editing.env).map((key) => ({ key, value: SECRET_PLACEHOLDER }));
  });
  const [error, setError] = useState("");

  // 输入框 / 标签样式统一走 Modal 基座导出的 token，保证与其他弹窗一致
  const inputCls = modalInput;
  const labelCls = "mb-1.5 block text-xs font-medium text-text-400";

  const applyPreset = (preset: (typeof PRESETS)[0]) => {
    setForm((f) => ({
      ...f,
      name: preset.name,
      description: t(preset.descKey),
      type: preset.type,
      command: preset.command,
      args: preset.args.join(" "),
    }));
    // 预设要求的环境变量预生成空行，提示用户填写
    setEnvRows(preset.requiredEnvKeys.map((key) => ({ key, value: "" })));
    setStep("custom");
  };

  const updateRow = (i: number, patch: Partial<EnvRow>) =>
    setEnvRows((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const addRow = () => setEnvRows((rows) => [...rows, { key: "", value: "" }]);

  const removeRow = (i: number) => setEnvRows((rows) => rows.filter((_, idx) => idx !== i));

  const handleSubmit = () => {
    if (!form.name.trim()) { setError(t("connector.errNameRequired")); return; }
    if (form.type === "stdio" && !form.command.trim()) { setError(t("connector.errCommandRequired")); return; }
    if (form.type !== "stdio" && !form.url.trim()) { setError(t("connector.errUrlRequired")); return; }
    setError("");

    // 编辑模式占位符表示未修改，沿用原值；空 key 行忽略；后写覆盖先写天然去重
    const original = editing?.env;
    const finalEnvs: Record<string, string> = {};
    for (const { key, value } of envRows) {
      const k = key.trim();
      if (!k) continue;
      finalEnvs[k] = value === SECRET_PLACEHOLDER ? (original?.[k] ?? "") : value;
    }

    onSubmit(
      {
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        type: form.type,
        command: form.command.trim() || undefined,
        args: form.args.trim() ? form.args.split(/\s+/) : undefined,
        url: form.url.trim() || undefined,
        env: Object.keys(finalEnvs).length > 0 ? finalEnvs : undefined,
      },
      editing?.id,
    );
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-text-000/40 backdrop-blur-sm animate-fade-in p-4">
      <div className={`relative w-full max-w-lg max-h-[90vh] overflow-y-auto ${modalPanel} p-6`}>
        <ModalCloseButton onClose={onClose} />
        <div className="mb-5">
          <h2 className={modalTitle}>{isEditing ? t("connector.editTitle") : t("connector.addTitle")}</h2>
        </div>

        {step === "preset" ? (
          <>
            <p className="mb-3 text-sm text-text-400">{t("connector.presetHint")}</p>
            <div className="mb-4 grid grid-cols-2 gap-2">
              {PRESETS.map((p) => (
                <button
                  key={p.id}
                  onClick={() => applyPreset(p)}
                  className="flex flex-col items-start gap-1 rounded-lg border border-border-300 bg-bg-000 px-3 py-2.5 text-left shadow-soft transition-colors hover:border-accent-brand/40 hover:bg-bg-100"
                >
                  <span className="text-sm font-medium text-text-100">{p.name}</span>
                  <span className="text-xs text-text-400">{t(p.descKey)}</span>
                </button>
              ))}
            </div>
            <button
              onClick={() => setStep("custom")}
              className="w-full rounded-lg border border-border-300 bg-bg-000 px-4 py-2 text-sm text-text-300 shadow-soft transition-colors hover:bg-bg-100 hover:text-text-100"
            >
              {t("connector.manualConfig")}
            </button>
          </>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="rounded-xl border border-border-300 bg-bg-000 p-5 shadow-soft space-y-4">
            {/* 基本信息 */}
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className={labelCls}>{t("connector.name")}</label>
                <input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder={t("connector.namePlaceholder")}
                  className={inputCls}
                />
              </div>
              <div className="col-span-2">
                <label className={labelCls}>{t("connector.desc")}</label>
                <input
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  placeholder={t("connector.descPlaceholder")}
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls}>{t("connector.type")}</label>
                <div className={inputCls}>stdio</div>
              </div>
            </div>

            {/* stdio 字段 */}
            {form.type === "stdio" ? (
              <>
                <div>
                  <label className={labelCls}>{t("connector.command")}</label>
                  <input
                    value={form.command}
                    onChange={(e) => setForm((f) => ({ ...f, command: e.target.value }))}
                    placeholder="npx"
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className={labelCls}>{t("connector.args")}</label>
                  <input
                    value={form.args}
                    onChange={(e) => setForm((f) => ({ ...f, args: e.target.value }))}
                    placeholder="-y @modelcontextprotocol/server-github"
                    className={inputCls}
                  />
                  <p className="mt-1 text-xs leading-relaxed text-text-400">{t("connector.argsHint")}</p>
                </div>
              </>
            ) : (
              <div>
                <label className={labelCls}>{t("connector.url")}</label>
                <input
                  value={form.url}
                  onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
                  placeholder="https://..."
                  className={inputCls}
                />
              </div>
            )}

            {/* 环境变量（每行可编辑 key/value） */}
            <div>
              <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-text-400">
                {t("connector.env")}
                {envRows.length > 0 && (
                  <span className="rounded-full bg-bg-100 px-1.5 text-[10px] text-text-300">
                    {envRows.length}
                  </span>
                )}
              </label>
              <div className="flex flex-col gap-2">
                {envRows.map((row, i) => (
                  <div key={i} className="flex gap-2">
                    <input
                      value={row.key}
                      onChange={(e) => updateRow(i, { key: e.target.value })}
                      placeholder={t("connector.envKey")}
                      className={inputCls + " flex-1"}
                    />
                    <input
                      value={row.value}
                      onChange={(e) => updateRow(i, { value: e.target.value })}
                      placeholder={t("connector.envValue")}
                      type="password"
                      className={inputCls + " flex-1"}
                    />
                    <button
                      onClick={() => removeRow(i)}
                      title={t("connector.removeVar")}
                      aria-label={t("connector.removeVarAria")}
                      className="flex shrink-0 items-center justify-center rounded-lg border border-border-300 bg-bg-000 px-2.5 py-1.5 text-text-400 shadow-soft transition-colors hover:border-red-400 hover:text-red-400"
                    >
                      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M18 6L6 18M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ))}
                <button
                  onClick={addRow}
                  className="flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-border-300 px-3 py-1.5 text-xs text-text-400 transition-colors hover:border-accent-brand/40 hover:text-text-200"
                >
                  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                  {t("connector.addVar")}
                </button>
              </div>
            </div>

            {error && <p className="text-xs text-red-400">{error}</p>}
            </div>

            <div className="flex justify-end gap-3">
              {!isEditing && (
                <button onClick={() => setStep("preset")} className={modalCancelBtn}>
                  {t("connector.prevStep")}
                </button>
              )}
              <button onClick={handleSubmit} className={modalPrimaryBtn}>
                {isEditing ? t("connector.save") : t("connector.add")}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
