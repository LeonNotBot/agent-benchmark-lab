import { useState, useEffect } from "react";
import { useLocale } from "../i18n";
import { modalPanel, modalTitle, modalInput, modalCancelBtn, modalPrimaryBtn, ModalCloseButton } from "../components/Modal";

const TOOL_OPTIONS = [
  "Bash", "Read", "Write", "Edit", "Grep", "Glob", "Agent",
  "TodoWrite", "WebSearch", "WebFetch", "NotebookEdit", "Skill",
];

type SkillFormData = {
  name: string;
  displayName?: string;
  description: string;
  whenToUse?: string;
  allowedTools?: string[];
  content: string;
  __clone?: boolean;
};

type Props = {
  open: boolean;
  onClose: () => void;
  onSave: (skill: SkillFormData) => void;
  initialData?: SkillFormData | null;
};

export function SkillEditor({ open, onClose, onSave, initialData }: Props) {
  const inputCls = modalInput;
  const { t } = useLocale();
  const [name, setName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [description, setDescription] = useState("");
  const [whenToUse, setWhenToUse] = useState("");
  const [allowedTools, setAllowedTools] = useState<string[]>([]);
  const [content, setContent] = useState("");

  useEffect(() => {
    if (!open) return;
    setName(initialData?.name ?? "");
    setDisplayName(initialData?.displayName ?? "");
    setDescription(initialData?.description ?? "");
    setWhenToUse(initialData?.whenToUse ?? "");
    // 允许的工具：未声明或为空数组都视为"全选"，避免旧 Skill（无 allowed-tools）
    // 进入编辑界面时全部未选中。
    setAllowedTools(
      initialData?.allowedTools && initialData.allowedTools.length > 0
        ? initialData.allowedTools
        : [...TOOL_OPTIONS],
    );
    setContent(initialData?.content ?? "");
  }, [open, initialData]);

  // 克隆态视为新建：name 可编辑、保存走 POST
  const isClone = !!initialData?.__clone;
  const isEdit = !!initialData?.name && !isClone;

  // Esc 关闭
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const canSave = name.trim() && description.trim() && content.trim();

  const toggleTool = (tool: string) => {
    setAllowedTools((prev) =>
      prev.includes(tool) ? prev.filter((x) => x !== tool) : [...prev, tool]
    );
  };

  const handleSave = () => {
    if (!canSave) return;
    onSave({
      name: name.trim(),
      displayName: displayName.trim() || undefined,
      description: description.trim(),
      whenToUse: whenToUse.trim() || undefined,
      allowedTools: allowedTools.length > 0 ? allowedTools : undefined,
      content: content.trim(),
    });
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center">
      <div className="absolute inset-0 bg-text-000/40 backdrop-blur-sm" onClick={onClose} />
      <div className={`relative w-[92vw] max-w-2xl max-h-[90vh] overflow-y-auto ${modalPanel} p-6`}>
        <ModalCloseButton onClose={onClose} label={t("skillEdit.cancel")} />
        <h2 className={`${modalTitle} mb-4`}>
          {isEdit ? t("skillEdit.editTitle") : t("skillEdit.newTitle")}
        </h2>
        <div className="space-y-3">
          <Field label={t("skillEdit.name")} hint={t("skillEdit.nameHint")}>
            <input value={name} onChange={(e) => setName(e.target.value.replace(/[^a-zA-Z0-9-]/g, ""))}
              disabled={isEdit} className={inputCls} placeholder="my-skill" />
          </Field>
          <Field label={t("skillEdit.displayName")}>
            <input value={displayName} onChange={(e) => setDisplayName(e.target.value)}
              className={inputCls} placeholder={t("skill.displayNameHint")} />
          </Field>
          <Field label={t("skillEdit.description")}>
            <input value={description} onChange={(e) => setDescription(e.target.value)}
              className={inputCls} placeholder={t("skillEdit.descPlaceholder")} />
          </Field>
          <Field label={t("skillEdit.allowedTools")}>
            <div className="flex flex-wrap gap-1.5">
              {TOOL_OPTIONS.map((tool) => {
                const active = allowedTools.includes(tool);
                return (
                  <button
                    key={tool}
                    type="button"
                    onClick={() => toggleTool(tool)}
                    className={`px-2.5 py-1 rounded-full text-xs border cursor-pointer transition-colors ${
                      active
                        ? "border-accent-brand bg-accent-brand/10 text-accent-text"
                        : "border-border-300 bg-bg-000 text-text-400 hover:border-border-200/40"
                    }`}
                  >
                    {tool}
                  </button>
                );
              })}
            </div>
          </Field>
          <Field label={t("skillEdit.promptContent")}>
            <textarea value={content} onChange={(e) => setContent(e.target.value)}
              className={`${inputCls} min-h-40 resize-y font-mono text-xs`}
              placeholder={t("skillEdit.promptPlaceholder")} />
          </Field>
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className={modalCancelBtn}>
            {t("skillEdit.cancel")}
          </button>
          <button onClick={handleSave} disabled={!canSave} className={modalPrimaryBtn}>
            {t("skillEdit.save")}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-text-200 mb-1">
        {label} {hint && <span className="text-text-400 font-normal">({hint})</span>}
      </label>
      {children}
    </div>
  );
}
