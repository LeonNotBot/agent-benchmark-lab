// 审查 diff 逻辑模型：加载 git 工作区 diff（含完整 oldContent/newContent）+ 生成 unified patch
import type { FileDiff, DiffLine, DiffHunk } from "@lenovo/agent-protocol";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ReviewLine {
  lineNo: number | null;
  content: string;
  type: "context" | "add" | "remove" | "empty" | "fold";
  /** fold 行专用：被折叠的未变更行数，及其在原数组中的 [start,end) 区间（用于展开）。 */
  foldCount?: number;
  foldStart?: number;
  foldEnd?: number;
}

// ── Side-by-side builder ──────────────────────────────────────────────────────

function splitLines(s: string): string[] {
  const ls = s.split("\n");
  if (ls.length > 0 && ls[ls.length - 1] === "") ls.pop();
  return ls;
}

function buildFullSideBySide(diff: FileDiff): { left: ReviewLine[]; right: ReviewLine[] } {
  const left: ReviewLine[] = [];
  const right: ReviewLine[] = [];

  if (diff.oldContent === undefined && diff.newContent === undefined) {
    // 无完整内容：仅 hunk 行（不再渲染 @@ 定位头，定位交给行号列 + 折叠条）
    for (const hunk of diff.hunks) {
      for (const line of hunk.lines) {
        if (line.type === "context") {
          left.push({ lineNo: line.oldLineNumber ?? null, content: line.content, type: "context" });
          right.push({ lineNo: line.newLineNumber ?? null, content: line.content, type: "context" });
        } else if (line.type === "remove") {
          left.push({ lineNo: line.oldLineNumber ?? null, content: line.content, type: "remove" });
          right.push({ lineNo: null, content: "", type: "empty" });
        } else {
          left.push({ lineNo: null, content: "", type: "empty" });
          right.push({ lineNo: line.newLineNumber ?? null, content: line.content, type: "add" });
        }
      }
    }
    return { left, right };
  }

  const oldLines = splitLines(diff.oldContent ?? "");
  const newLines = splitLines(diff.newContent ?? "");
  let oldCursor = 1, newCursor = 1;

  for (const hunk of diff.hunks) {
    // 填充 hunk 前的未变更行
    const gapCount = hunk.oldStart - oldCursor;
    for (let g = 0; g < gapCount; g++) {
      left.push({ lineNo: oldCursor, content: oldLines[oldCursor - 1] ?? "", type: "context" });
      right.push({ lineNo: newCursor, content: newLines[newCursor - 1] ?? "", type: "context" });
      oldCursor++; newCursor++;
    }
    // 处理 hunk 行（原 @@ 定位头已去除，未变更区之间的间隔靠折叠条表达）
    let hunkOld = hunk.oldStart, hunkNew = hunk.newStart, i = 0;
    while (i < hunk.lines.length) {
      const line = hunk.lines[i];
      if (line.type === "context") {
        left.push({ lineNo: hunkOld++, content: line.content, type: "context" });
        right.push({ lineNo: hunkNew++, content: line.content, type: "context" });
        i++;
      } else {
        const removes: DiffLine[] = [], adds: DiffLine[] = [];
        while (i < hunk.lines.length && hunk.lines[i].type === "remove") removes.push(hunk.lines[i++]);
        while (i < hunk.lines.length && hunk.lines[i].type === "add") adds.push(hunk.lines[i++]);
        const maxLen = Math.max(removes.length, adds.length);
        for (let j = 0; j < maxLen; j++) {
          left.push(j < removes.length ? { lineNo: hunkOld++, content: removes[j].content, type: "remove" } : { lineNo: null, content: "", type: "empty" });
          right.push(j < adds.length ? { lineNo: hunkNew++, content: adds[j].content, type: "add" } : { lineNo: null, content: "", type: "empty" });
        }
      }
    }
    oldCursor = hunk.oldStart + hunk.oldLines;
    newCursor = hunk.newStart + hunk.newLines;
  }

  // 填充最后一个 hunk 后的剩余行
  while (oldCursor <= oldLines.length || newCursor <= newLines.length) {
    left.push(oldCursor <= oldLines.length ? { lineNo: oldCursor, content: oldLines[oldCursor - 1], type: "context" } : { lineNo: null, content: "", type: "empty" });
    right.push(newCursor <= newLines.length ? { lineNo: newCursor, content: newLines[newCursor - 1], type: "context" } : { lineNo: null, content: "", type: "empty" });
    oldCursor++; newCursor++;
  }

  return { left, right };
}

// ── Unified patch generator ────────────────────────────────────────────────────

function generateUnifiedPatch(diff: FileDiff): string {
  if (!diff.hunks.length) return "";
  const lines: string[] = [];
  for (const hunk of diff.hunks) {
    lines.push(`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`);
    for (const line of hunk.lines) {
      if (line.type === "add") lines.push("+" + line.content);
      else if (line.type === "remove") lines.push("-" + line.content);
      else lines.push(" " + line.content);
    }
  }
  return lines.join("\n");
}

// ── Context folding ─────────────────────────────────────────────────────────────
// 把连续的未变更行（左右两侧都是 context）折叠成一个 fold 行（2.png「N unmodified lines」）。
// 变更行附近保留 CONTEXT_KEEP 行上下文；expanded 集合内的 fold（按其 foldStart 标识）不折叠。
const CONTEXT_KEEP = 3;
const FOLD_MIN = 4; // 连续 context 少于此值不折叠（折叠反而更占地方）

export interface FoldedResult {
  left: ReviewLine[];
  right: ReviewLine[];
}

// 输入完整的 left/right（等长），输出折叠后的两侧（仍等长，fold 行左右对齐）。
function foldContext(
  left: ReviewLine[],
  right: ReviewLine[],
  expanded: Set<number>,
): FoldedResult {
  const n = left.length;
  const isCtx = (i: number) => left[i]?.type === "context" && right[i]?.type === "context";
  const outL: ReviewLine[] = [];
  const outR: ReviewLine[] = [];
  let i = 0;
  while (i < n) {
    if (!isCtx(i)) { outL.push(left[i]); outR.push(right[i]); i++; continue; }
    // 收集连续 context 段 [start, end)
    let end = i;
    while (end < n && isCtx(end)) end++;
    // 段首/段尾各保留 CONTEXT_KEEP 行作变更行上下文；中间折叠。
    // 文件最开头的段不留前导（无变更行在其上）、文件末尾的段不留后随。
    const keepHead = i === 0 ? 0 : CONTEXT_KEEP;
    const keepTail = end === n ? 0 : CONTEXT_KEEP;
    const foldFrom = i + keepHead;
    const foldTo = end - keepTail;
    if (foldTo - foldFrom < FOLD_MIN || expanded.has(i)) {
      // 不够折叠阈值，或已展开 → 原样输出
      for (let k = i; k < end; k++) { outL.push(left[k]); outR.push(right[k]); }
    } else {
      for (let k = i; k < foldFrom; k++) { outL.push(left[k]); outR.push(right[k]); }
      const foldLine: ReviewLine = {
        lineNo: null, content: "", type: "fold",
        foldCount: foldTo - foldFrom, foldStart: i, foldEnd: end,
      };
      outL.push(foldLine);
      outR.push({ ...foldLine });
      for (let k = foldTo; k < end; k++) { outL.push(left[k]); outR.push(right[k]); }
    }
    i = end;
  }
  return { left: outL, right: outR };
}

// ── Public API ────────────────────────────────────────────────────────────────

export { buildFullSideBySide, generateUnifiedPatch, foldContext };