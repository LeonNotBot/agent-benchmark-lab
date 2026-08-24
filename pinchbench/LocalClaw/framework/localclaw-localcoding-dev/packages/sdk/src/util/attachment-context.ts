import type { Attachment } from "@lenovo/agent-protocol";

export type PersistedAttachmentFile = {
  originalName: string;
  savedPath: string;
  relativePath: string;
  mimeType: string;
  size: number;
  extractedTextPath?: string;
};

export type PersistedAttachmentContext = {
  directory: string;
  files: PersistedAttachmentFile[];
};

export function isTextFile(att: Attachment): boolean {
  if (att.mimeType.startsWith("text/")) return true;
  if (att.mimeType === "application/json") return true;
  const ext = att.name.toLowerCase().split(".").pop() ?? "";
  return [
    "md",
    "txt",
    "js",
    "ts",
    "tsx",
    "jsx",
    "json",
    "html",
    "css",
    "py",
    "sh",
    "yaml",
    "yml",
    "xml",
    "csv",
  ].includes(ext);
}

export function buildPromptWithAttachments(
  prompt: string,
  attachments?: Attachment[],
  attachmentContext?: PersistedAttachmentContext,
): string {
  if (!attachments?.length) return prompt;

  const parts: string[] = [prompt];

  if (attachmentContext?.files.length) {
    parts.push(
      "\n\n已上传附件已保存到本地目录，可直接使用 Glob、Read、LS 等工具访问这些文件。\n",
    );
    parts.push(
      "如果原始附件是二进制办公文档，例如 .docx，请优先读取旁边生成的 .txt 文本提取文件，而不是直接对二进制文件使用 Read。\n",
    );
    parts.push(`附件目录: ${attachmentContext.directory}`);
    for (const file of attachmentContext.files) {
      parts.push(`- ${file.savedPath}`);
      if (file.extractedTextPath) {
        parts.push(`  文本提取: ${file.extractedTextPath}`);
      }
    }
  }

  const hasNonImageAttachments = attachments.some(
    (att) => !att.mimeType.startsWith("image/"),
  );
  if (!hasNonImageAttachments) return parts.join("\n");

  attachments.forEach((att, index) => {
    if (att.mimeType.startsWith("image/")) return;
    const savedFile = attachmentContext?.files[index];
    if (isTextFile(att)) {
      try {
        const text = Buffer.from(att.base64, "base64").toString("utf-8");
        const pathSuffix = savedFile
          ? `，本地路径: ${savedFile.savedPath}`
          : "";
        parts.push(
          `\n\n--- 文件: ${att.name}${pathSuffix} ---\n${text}\n--- 文件结束 ---`,
        );
      } catch {
        const pathSuffix = savedFile
          ? `，已保存到: ${savedFile.savedPath}`
          : "";
        parts.push(
          `\n\n[已上传文件: ${att.name}，大小: ${att.size} 字节${pathSuffix}]`,
        );
      }
    } else {
      const pathSuffix = savedFile ? `，已保存到: ${savedFile.savedPath}` : "";
      const extractedSuffix = savedFile?.extractedTextPath
        ? `，文本提取文件: ${savedFile.extractedTextPath}`
        : "";
      parts.push(
        `\n\n[已上传文件: ${att.name}，大小: ${att.size} 字节，类型: ${att.mimeType}${pathSuffix}${extractedSuffix}]`,
      );
    }
  });

  return parts.join("");
}
