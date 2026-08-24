// Edit old_string/new_string 的逐行 LCS diff：相同行标 context（中性色），
// 仅真正变化的行标 remove/add，避免整块 old 染红、整块 new 染绿。
// 输出 side-by-side 配对行：删除行左红右空、新增行左空右绿、相同行两栏中性。

export interface DiffCell {
  lineNo: number | null;
  content: string;
  type: "context" | "add" | "remove" | "empty";
}
export interface DiffRow {
  left: DiffCell;
  right: DiffCell;
}

// 按 \n 切行；末尾多余空行（字符串以 \n 结尾时 split 产生的）丢弃。
function splitLines(s: string): string[] {
  const ls = s.split("\n");
  if (ls.length > 1 && ls[ls.length - 1] === "") ls.pop();
  return ls;
}

type Op = { type: "context" | "remove" | "add"; oldIdx: number; newIdx: number };

// 经典 LCS 回溯，得到 context/remove/add 的操作序列。
function lcsOps(a: string[], b: string[]): Op[] {
  const n = a.length, m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const ops: Op[] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { ops.push({ type: "context", oldIdx: i, newIdx: j }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { ops.push({ type: "remove", oldIdx: i, newIdx: -1 }); i++; }
    else { ops.push({ type: "add", oldIdx: -1, newIdx: j }); j++; }
  }
  while (i < n) ops.push({ type: "remove", oldIdx: i++, newIdx: -1 });
  while (j < m) ops.push({ type: "add", oldIdx: -1, newIdx: j++ });
  return ops;
}

const EMPTY: DiffCell = { lineNo: null, content: "", type: "empty" };

// LCS 是 O(n×m) 时空复杂度：n、m 为两侧行数。超大整块替换（几百上千行）时
// dp 数组会爆内存/卡顿，此阈值以上降级为"整块红/绿"（不配对，退回旧的粗粒度行为）。
const LCS_CELL_BUDGET = 250_000; // 约 500×500 行，正常 Edit 片段远小于此

// 降级：不做 LCS，old 全标 remove、new 全标 add，左右按行号顺次并排、短侧补空。
function buildBlockDiff(a: string[], b: string[]): DiffRow[] {
  const rows: DiffRow[] = [];
  const maxLen = Math.max(a.length, b.length);
  for (let x = 0; x < maxLen; x++) {
    rows.push({
      left: x < a.length ? { lineNo: x + 1, content: a[x], type: "remove" } : EMPTY,
      right: x < b.length ? { lineNo: x + 1, content: b[x], type: "add" } : EMPTY,
    });
  }
  return rows;
}

// 生成 side-by-side 行：相同行两栏并排；连续的删除/新增块左右配对，
// 数量不等时短的一侧补空行。
export function buildLineDiff(oldStr: string, newStr: string): DiffRow[] {
  const a = splitLines(oldStr), b = splitLines(newStr);
  if (a.length * b.length > LCS_CELL_BUDGET) return buildBlockDiff(a, b);
  const ops = lcsOps(a, b);
  const rows: DiffRow[] = [];
  let k = 0;
  while (k < ops.length) {
    const op = ops[k];
    if (op.type === "context") {
      rows.push({
        left: { lineNo: op.oldIdx + 1, content: a[op.oldIdx], type: "context" },
        right: { lineNo: op.newIdx + 1, content: b[op.newIdx], type: "context" },
      });
      k++;
      continue;
    }
    // 收集一段连续的 remove，再收集一段连续的 add，左右配对
    const removes: Op[] = [], adds: Op[] = [];
    while (k < ops.length && ops[k].type === "remove") removes.push(ops[k++]);
    while (k < ops.length && ops[k].type === "add") adds.push(ops[k++]);
    const maxLen = Math.max(removes.length, adds.length);
    for (let x = 0; x < maxLen; x++) {
      rows.push({
        left: x < removes.length
          ? { lineNo: removes[x].oldIdx + 1, content: a[removes[x].oldIdx], type: "remove" }
          : EMPTY,
        right: x < adds.length
          ? { lineNo: adds[x].newIdx + 1, content: b[adds[x].newIdx], type: "add" }
          : EMPTY,
      });
    }
  }
  return rows;
}
