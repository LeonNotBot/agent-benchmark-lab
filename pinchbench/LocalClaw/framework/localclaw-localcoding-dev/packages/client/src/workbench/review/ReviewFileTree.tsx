// 审查面板文件列表：树状结构（对齐「文件」tab 的 FileTreeNode 观感），
// 但节点数据来自本轮 diff（每文件带 M/A/D 徽章 + +/- 统计）。目录默认展开。
// 树构建（buildReviewTree）与渲染节点同文件，避免与 .ts 同名文件在大小写不敏感文件系统冲突。
import { useState } from "react";
import type { FileDiff } from "@lenovo/agent-protocol";

// ── 树构建 ──────────────────────────────────────────────────────────────────
// 把扁平变更文件列表（FileDiff[]，path 为 /-分隔相对路径）构建成树；单链目录做路径压缩。
export interface ReviewTreeNode {
  name: string;                 // 显示名（目录为压缩后的相对段，如 "src/store"）
  path: string;                 // 目录用作 key；文件为其 diff.path（选中用）
  isDir: boolean;
  diff?: FileDiff;              // 文件节点携带其 diff（渲染 +/- 与状态徽章）
  children: ReviewTreeNode[];
}

interface MutDir {
  name: string;
  path: string;
  dirs: Map<string, MutDir>;
  files: ReviewTreeNode[];
}

function makeDir(name: string, path: string): MutDir {
  return { name, path, dirs: new Map(), files: [] };
}

// 目录聚合 + 单链压缩。files 顺序保留传入顺序（后端已按修改时间排序）。
export function buildReviewTree(diffs: FileDiff[]): ReviewTreeNode[] {
  const root = makeDir("", "");
  for (const d of diffs) {
    const segs = d.path.replace(/\\/g, "/").split("/").filter(Boolean);
    const fileName = segs.pop() ?? d.path;
    let cur = root;
    let curPath = "";
    for (const seg of segs) {
      curPath = curPath ? `${curPath}/${seg}` : seg;
      let next = cur.dirs.get(seg);
      if (!next) {
        next = makeDir(seg, curPath);
        cur.dirs.set(seg, next);
      }
      cur = next;
    }
    cur.files.push({ name: fileName, path: d.path, isDir: false, diff: d, children: [] });
  }
  return finalize(root);
}

// 递归转换 + 单链目录压缩（目录只有 1 个子目录且无直接文件 → 合并名字）。
function finalize(node: MutDir): ReviewTreeNode[] {
  const dirs: ReviewTreeNode[] = [];
  for (const child of node.dirs.values()) {
    let label = child.name;
    let cur = child;
    while (cur.dirs.size === 1 && cur.files.length === 0) {
      const only = cur.dirs.values().next().value as MutDir;
      label = `${label}/${only.name}`;
      cur = only;
    }
    dirs.push({
      name: label,
      path: cur.path,
      isDir: true,
      // finalize(cur) 已在末尾拼上 cur.files（见下方 return），此处不能再拼一次，
      // 否则「只有文件的叶目录」里每个文件会重复一次（同名文件 bug 根因）。
      children: finalize(cur),
    });
  }
  return [...dirs, ...node.files];
}

// ── 渲染 ────────────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: "added" | "modified" | "deleted" }) {
  const cfg =
    status === "added" ? { c: "bg-green-100 text-green-700", ch: "A" } :
    status === "deleted" ? { c: "bg-red-100 text-red-700", ch: "D" } :
    { c: "bg-blue-100 text-blue-700", ch: "M" };
  return (
    <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${cfg.c}`}>
      {cfg.ch}
    </span>
  );
}

export function ReviewFileTreeNode({
  node,
  depth,
  onSelectFile,
  selectedPath,
}: {
  node: ReviewTreeNode;
  depth: number;
  onSelectFile: (path: string) => void;
  selectedPath: string | null;
}) {
  const [expanded, setExpanded] = useState(true); // 目录默认展开（diff 集合小，全展开更利于浏览）
  const isSelected = !node.isDir && selectedPath === node.path;

  return (
    <div>
      <div
        className={`flex items-center gap-1.5 px-2 py-1.5 cursor-pointer hover:bg-bg-200 rounded text-sm
          ${isSelected ? "bg-purple-light2 text-accent-text" : "text-text-200"}`}
        style={{ paddingLeft: `${8 + depth * 16}px` }}
        onClick={() => (node.isDir ? setExpanded((v) => !v) : onSelectFile(node.path))}
        title={node.isDir ? node.name : node.path}
      >
        {node.isDir ? (
          <svg
            viewBox="0 0 24 24"
            className={`h-3.5 w-3.5 shrink-0 text-text-400 transition-transform ${expanded ? "rotate-90" : ""}`}
            fill="none" stroke="currentColor" strokeWidth="2"
          >
            <path d="M9 6l6 6-6 6" />
          </svg>
        ) : node.diff ? (
          <StatusBadge status={node.diff.status} />
        ) : null}
        <span className="min-w-0 flex-1 truncate">{node.name}</span>
        {!node.isDir && node.diff && (
          <>
            <span className="shrink-0 text-green-600 text-xs">+{node.diff.linesAdded ?? 0}</span>
            <span className="shrink-0 text-red-600 text-xs">-{node.diff.linesRemoved ?? 0}</span>
          </>
        )}
      </div>
      {node.isDir && expanded && node.children.map((child) => (
        <ReviewFileTreeNode
          key={child.path}
          node={child}
          depth={depth + 1}
          onSelectFile={onSelectFile}
          selectedPath={selectedPath}
        />
      ))}
    </div>
  );
}
