// 新建空白项目命名对话框：标题 + 副标题 + 输入框(默认 New project，挂载全选) + 取消/保存
import { useEffect, useRef, useState } from "react";
import { useLocale } from "../i18n";
import { Modal, modalInput, modalCancelBtn, modalPrimaryBtn } from "../components/Modal";

interface Props {
  onCancel: () => void;
  onConfirm: (name: string) => void;
}

export function NewProjectDialog({ onCancel, onConfirm }: Props) {
  const [name, setName] = useState("New project");
  const inputRef = useRef<HTMLInputElement>(null);
  const { t } = useLocale();

  useEffect(() => {
    // 挂载后聚焦并全选默认文本
    const el = inputRef.current;
    if (el) { el.focus(); el.select(); }
  }, []);

  const submit = () => {
    const v = name.trim();
    onConfirm(v || "New project");
  };

  return (
    <Modal
      onClose={onCancel}
      title={t("newProject.title")}
      autoFocus={false}
      footer={
        <>
          <button onClick={onCancel} className={modalCancelBtn}>{t("newProject.cancel")}</button>
          <button onClick={submit} className={modalPrimaryBtn}>{t("newProject.save")}</button>
        </>
      }
    >
      <p className="mt-1 text-sm text-text-400">{t("newProject.subtitle")}</p>
      <input
        ref={inputRef}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); submit(); }
        }}
        className={`mt-4 ${modalInput} rounded-xl px-3.5 py-2.5`}
      />
    </Modal>
  );
}
