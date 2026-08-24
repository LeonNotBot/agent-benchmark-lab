// 附件预览条 + 文件按钮，独立成一个组件保持 Composer 文件不超过 100 行
import type { Attachment } from "@lenovo/agent-protocol";

interface Props {
  attachments: Attachment[];
  onRemove: (index: number) => void;
}

const MAX = 4;

function fmtSize(n: number): string {
  if (n < 1024) return n + "B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + "KB";
  return (n / (1024 * 1024)).toFixed(1) + "MB";
}

export function AttachmentChips({ attachments, onRemove }: Props) {
  if (attachments.length === 0) return null;
  return (
    <div className="mb-1.5 flex flex-wrap gap-1.5">
      {attachments.map((a, i) => {
        const isImg = a.mimeType.startsWith("image/");
        const dataUrl = `data:${a.mimeType};base64,${a.base64}`;
        return (
          <div
            key={i}
            className="group relative flex items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900"
          >
            {isImg ? (
              <img src={dataUrl} alt={a.name} className="h-6 w-6 rounded object-cover" />
            ) : (
              <span className="text-zinc-500">📄</span>
            )}
            <span className="max-w-[140px] truncate" title={a.name}>{a.name}</span>
            <span className="text-[10px] text-zinc-400">{fmtSize(a.size)}</span>
            <button
              onClick={() => onRemove(i)}
              className="ml-1 text-zinc-400 hover:text-red-500"
              title="Remove"
              aria-label="Remove attachment"
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}

export function readFilesAsAttachments(files: FileList | File[], remaining: number): Promise<Attachment[]> {
  const arr = Array.from(files).slice(0, remaining);
  return Promise.all(
    arr.map(
      (file) =>
        new Promise<Attachment>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => {
            const result = reader.result as string;
            const base64 = result.split(",")[1] ?? "";
            resolve({
              base64,
              mimeType: file.type || "application/octet-stream",
              name: file.name,
              size: file.size,
            });
          };
          reader.readAsDataURL(file);
        }),
    ),
  );
}

export const ATTACHMENT_MAX = MAX;