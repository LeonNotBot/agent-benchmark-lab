// 自动化详情页的时间文案：绝对(今天/明天/MM月DD日 HH:MM) 与 相对(刚刚/N分钟/N小时/N天)。
// 文案经 t() 走 i18n 字典，支持中英文切换。
type T = (key: string, params?: Record<string, string | number>) => string;

function hm(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** 同一自然日判定。 */
function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** 绝对时刻 → "今天 09:46" / "明天 08:01" / "昨天 10:00" / "6月18日 09:00"。 */
export function fmtAbsTime(t: T, ms?: number | null): string {
  if (!ms) return t("auto.cronEmpty");
  const d = new Date(ms);
  const now = new Date();
  const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1);
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  const time = hm(d);
  if (sameDay(d, now)) return t("time.today", { time });
  if (sameDay(d, tomorrow)) return t("time.tomorrow", { time });
  if (sameDay(d, yesterday)) return t("time.yesterday", { time });
  return t("time.monthDay", { m: d.getMonth() + 1, d: d.getDate(), time });
}

/** 距今相对时长 → "刚刚" / "N 分钟前" / "N 小时前" / "N 天前"。 */
export function fmtRelative(t: T, ms?: number | null): string {
  if (!ms) return t("auto.cronEmpty");
  const diff = Date.now() - ms;
  if (diff < 60_000) return t("auto.relNow");
  const min = Math.floor(diff / 60_000);
  if (min < 60) return t("auto.relMin", { n: min });
  const hr = Math.floor(min / 60);
  if (hr < 24) return t("auto.relHour", { n: hr });
  return t("auto.relDay", { n: Math.floor(hr / 24) });
}
