/**
 * 从工具入参 + 磁盘现状算出 AI 提案的新文件内容。纯函数,便于单测。
 *
 * - Write:     input.content 即完整新内容(oldContent 用于左侧对比,不参与计算)
 * - Edit:      oldContent 中 old_string → new_string(replace_all 决定全替换/仅首个)
 * - MultiEdit: 依次应用 input.edits[] 的每个 {old_string,new_string,replace_all}
 */
export function computeProposedContent(
  toolName: string,
  input: Record<string, unknown>,
  oldContent: string,
): string {
  if (toolName === "Write") {
    return typeof input.content === "string" ? input.content : "";
  }
  if (toolName === "Edit") {
    return applyEdit(oldContent, input);
  }
  if (toolName === "MultiEdit") {
    const edits = Array.isArray(input.edits) ? input.edits : [];
    return edits.reduce<string>(
      (acc, e) => applyEdit(acc, e as Record<string, unknown>),
      oldContent,
    );
  }
  return oldContent;
}

/** 应用单次 Edit 替换。old_string 为空时视为无操作(避免误替换)。 */
function applyEdit(content: string, edit: Record<string, unknown>): string {
  const oldStr = typeof edit.old_string === "string" ? edit.old_string : "";
  const newStr = typeof edit.new_string === "string" ? edit.new_string : "";
  if (!oldStr) return content;
  if (edit.replace_all === true) {
    return content.split(oldStr).join(newStr);
  }
  const idx = content.indexOf(oldStr);
  if (idx === -1) return content;
  return content.slice(0, idx) + newStr + content.slice(idx + oldStr.length);
}
