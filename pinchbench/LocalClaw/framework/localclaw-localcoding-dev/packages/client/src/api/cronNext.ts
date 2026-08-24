// cron → 下次/上次运行时间的客户端计算 + 相对时间文案。
// 与 SDK cron-match 同义的字段匹配（分 时 日 月 周, 周 0=周日），但保持纯前端零依赖。
const FIELD_MIN = [0, 0, 1, 1, 0];
const FIELD_MAX = [59, 23, 31, 12, 6];

// 单个 piece（"*" | "a" | "a-b" | "*\/n" | "a-b/n" | "a/n"）是否匹配 val。
function pieceMatch(piece: string, val: number, idx: number): boolean {
  const min = FIELD_MIN[idx], max = FIELD_MAX[idx];
  let step = 1, range = piece;
  const slash = piece.indexOf("/");
  if (slash >= 0) {
    range = piece.slice(0, slash);
    step = parseInt(piece.slice(slash + 1), 10);
    if (!Number.isInteger(step) || step <= 0) return false;
  }
  let lo: number, hi: number;
  if (range === "*") { lo = min; hi = max; }
  else if (range.includes("-")) { const [a, b] = range.split("-"); lo = parseInt(a, 10); hi = parseInt(b, 10); }
  else { lo = parseInt(range, 10); hi = slash >= 0 ? max : lo; }
  if (!Number.isInteger(lo) || !Number.isInteger(hi) || lo > hi) return false;
  if (val < lo || val > hi) return false;
  return (val - lo) % step === 0;
}

function fieldMatch(field: string, val: number, idx: number): boolean {
  return field.split(",").some((p) => pieceMatch(p, val, idx));
}

function matchesAt(parts: string[], d: Date): boolean {
  return (
    fieldMatch(parts[0], d.getMinutes(), 0) &&
    fieldMatch(parts[1], d.getHours(), 1) &&
    fieldMatch(parts[2], d.getDate(), 2) &&
    fieldMatch(parts[3], d.getMonth() + 1, 3) &&
    fieldMatch(parts[4], d.getDay(), 4)
  );
}

/** 下次触发的 epoch ms；从下一分钟起向前扫描，最多 8 天（覆盖每周）。无解返回 null。 */
export function nextRunMs(cron: string, from = Date.now()): number | null {
  const parts = String(cron ?? "").trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const MIN = 60_000;
  let cursor = Math.floor(from / MIN) * MIN + MIN; // 下一分钟起
  for (let i = 0; i < 8 * 24 * 60; i++) {
    if (matchesAt(parts, new Date(cursor))) return cursor;
    cursor += MIN;
  }
  return null;
}
