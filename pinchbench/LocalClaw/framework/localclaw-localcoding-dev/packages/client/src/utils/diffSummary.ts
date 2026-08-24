// 权限确认卡片用：从工具调用 input 估算 diff 摘要（在工具执行前计算）。
// Write：整文件视为新增；Edit/MultiEdit：按 old/new 文本行数估算增删；
// Bash：无文件 diff，仅回传命令文本。其余工具返回 null。

export interface DiffSummary {
  /** 目标文件路径（命令类工具为空） */
  fileName?: string;
  /** 新增行数 */
  added: number;
  /** 删除行数 */
  removed: number;
  /** 命令类工具的命令文本（无 diff 时展示） */
  command?: string;
}

function lineCount(text: unknown): number {
  if (typeof text !== "string" || text.length === 0) return 0;
  return text.split("\n").length;
}

function baseName(p: unknown): string | undefined {
  if (typeof p !== "string" || !p) return undefined;
  return p.split(/[\\/]/).pop() || p;
}

export function calcDiffSummary(
  toolName: string,
  input: unknown,
): DiffSummary | null {
  const obj = (input ?? {}) as Record<string, unknown>;

  if (toolName === "Write") {
    return {
      fileName: baseName(obj.file_path),
      added: lineCount(obj.content),
      removed: 0,
    };
  }

  if (toolName === "Edit") {
    return {
      fileName: baseName(obj.file_path),
      added: lineCount(obj.new_string),
      removed: lineCount(obj.old_string),
    };
  }

  if (toolName === "MultiEdit") {
    const edits = Array.isArray(obj.edits) ? obj.edits : [];
    let added = 0;
    let removed = 0;
    for (const e of edits) {
      const ed = (e ?? {}) as Record<string, unknown>;
      added += lineCount(ed.new_string);
      removed += lineCount(ed.old_string);
    }
    return { fileName: baseName(obj.file_path), added, removed };
  }

  if (toolName === "NotebookEdit") {
    return {
      fileName: baseName(obj.notebook_path),
      added: lineCount(obj.new_source),
      removed: 0,
    };
  }

  if (toolName === "Bash") {
    const command = typeof obj.command === "string" ? obj.command : "";
    return { added: 0, removed: 0, command };
  }

  return null;
}
