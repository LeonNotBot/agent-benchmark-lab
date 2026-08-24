// ── File Changes types ──

export type FileChangeStatus = "added" | "modified" | "deleted";

export type ChangedFile = {
  path: string;
  status: FileChangeStatus;
};

export type FileChangesResult = {
  files: ChangedFile[];
};

// ── AI Coding: Diff types ──

export type DiffLineType = "add" | "remove" | "context";

export type DiffLine = {
  type: DiffLineType;
  content: string;
  oldLineNumber?: number;
  newLineNumber?: number;
};

export type DiffHunk = {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
};

export type FileDiff = {
  path: string;
  status: "added" | "modified" | "deleted";
  oldContent?: string;
  newContent?: string;
  hunks: DiffHunk[];
  linesAdded: number;
  linesRemoved: number;
  /** 最近一次修改时间（毫秒）。仅会话工具调用重建的 diff 会带此字段 */
  modifiedAt?: number;
  /** 本次会话对该文件的工具操作次数（Edit/Write 合计）。仅重建 diff 带此字段 */
  opCount?: number;
};

export type GeneratedFileType = "pdf" | "image" | "csv" | "code" | "other";

export type GeneratedFile = {
  name: string;
  path: string;
  size: number;
  type: GeneratedFileType;
  createdAt: number;
};

export type DetectedCommand = {
  label: string;
  command: string;
};