/**
 * 5 段 cron 表达式匹配 —— 纯函数，无副作用，可独立单测（@internal）。
 *
 * 字段顺序：分(0-59) 时(0-23) 日(1-31) 月(1-12) 周(0-6, 0=周日)。
 *
 * 单字段支持：
 *   - `*`        通配
 *   - `a`        单值
 *   - `a,b,c`    枚举（逗号）
 *   - `a-b`      闭区间范围
 *   - `*\/n`      从 0 起步进
 *   - `a-b/n`    范围内步进
 *   - `a/n`      从 a 起到字段上界步进
 *
 * 不实现：月份/星期英文别名（JAN、SUN）、`?`、`L`、`#` 等扩展语法 —— 前端模板
 * 只产出数字表达式，按需再加。
 */

/** 各字段的取值上界（含），用于裸 `a/n` 步进的封顶。下界统一视作字段最小合法值。 */
const FIELD_MAX = [59, 23, 31, 12, 6] as const;
const FIELD_MIN = [0, 0, 1, 1, 0] as const;

/** 解析单个 piece 为 [lo, hi, step]；非法返回 null。 */
function parsePiece(
  piece: string,
  min: number,
  max: number,
): [number, number, number] | null {
  let step = 1;
  let rangePart = piece;
  const slash = piece.indexOf("/");
  if (slash >= 0) {
    rangePart = piece.slice(0, slash);
    step = parseInt(piece.slice(slash + 1), 10);
    if (!Number.isInteger(step) || step <= 0) return null;
  }

  let lo: number;
  let hi: number;
  if (rangePart === "*") {
    lo = min;
    hi = max;
  } else if (rangePart.includes("-")) {
    const [a, b] = rangePart.split("-");
    lo = parseInt(a, 10);
    hi = parseInt(b, 10);
  } else {
    lo = parseInt(rangePart, 10);
    // 裸值带步进（a/n）→ 从 a 到字段上界；裸值无步进 → 单点。
    hi = slash >= 0 ? max : lo;
  }
  if (!Number.isInteger(lo) || !Number.isInteger(hi)) return null;
  if (lo < min || hi > max || lo > hi) return null;
  return [lo, hi, step];
}

/** 单字段匹配：field 形如 "*"|"5"|"1,3"|"1-5"|"*\/2"|"1-5/2"|"9/3"。 */
export function matchField(
  field: string,
  val: number,
  fieldIndex: number,
): boolean {
  const min = FIELD_MIN[fieldIndex] ?? 0;
  const max = FIELD_MAX[fieldIndex] ?? 59;
  for (const piece of field.split(",")) {
    const parsed = parsePiece(piece, min, max);
    if (!parsed) continue; // 跳过单个非法 piece，不连累整段
    const [lo, hi, step] = parsed;
    if (val < lo || val > hi) continue;
    if ((val - lo) % step === 0) return true;
  }
  return false;
}

/** 5 段全部合法且段数正确才算可解析。 */
export function isValidCron(cron: string): boolean {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  return parts.every((p, i) =>
    p.split(",").every((piece) => parsePiece(piece, FIELD_MIN[i], FIELD_MAX[i]) !== null),
  );
}

/** 指定时刻 date 是否匹配 cron（精度到分钟）。 */
export function cronMatchesAt(cron: string, date: Date): boolean {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  return (
    matchField(parts[0], date.getMinutes(), 0) &&
    matchField(parts[1], date.getHours(), 1) &&
    matchField(parts[2], date.getDate(), 2) &&
    matchField(parts[3], date.getMonth() + 1, 3) &&
    matchField(parts[4], date.getDay(), 4)
  );
}

/** 当前分钟是否应触发（runner tick 用）。 */
export function shouldRun(cron: string): boolean {
  return cronMatchesAt(cron, new Date());
}
