// cron 表达式 → 人类可读文案。识别 buildCron 产出的常见形态，其余回退原串。
// 文案经 t() 走 i18n 字典，支持中英文切换。
// buildCron 形态：interval `*/n * * * *`、hourly `0 * * * *`、daily `m h * * *`、
// workday `m h * * 1-5`、weekly `m h * * d`(d:0~6,0=周日)。
type T = (key: string, params?: Record<string, string | number>) => string;

// dow 0~6（0=周日）→ weekday.* key
const DOW_KEYS = ["weekday.sun", "weekday.mon", "weekday.tue", "weekday.wed", "weekday.thu", "weekday.fri", "weekday.sat"];

// 时分补零 → "8:00"（时去前导零，分两位）
function hm(h: string, m: string): string {
  return `${parseInt(h, 10)}:${(m ?? "0").padStart(2, "0")}`;
}

export function cronToLabel(t: T, cron: string): string {
  const parts = String(cron ?? "").trim().split(/\s+/);
  if (parts.length !== 5) return cron || t("auto.cronEmpty");
  const [min, hour, dom, mon, dow] = parts;

  // interval：每 n 分钟
  const itv = /^\*\/(\d+)$/.exec(min);
  if (itv && hour === "*" && dom === "*" && mon === "*" && dow === "*") {
    return t("sched.everyN", { n: itv[1] });
  }
  // hourly：每小时整点
  if (min === "0" && hour === "*" && dom === "*" && mon === "*" && dow === "*") {
    return t("sched.hourly");
  }
  // 固定时分（daily/workday/weekly）
  if (/^\d+$/.test(min) && /^\d+$/.test(hour) && dom === "*" && mon === "*") {
    const time = hm(hour, min);
    if (dow === "*") return t("sched.dailyAt", { time });
    if (dow === "1-5") return t("sched.workdayAt", { time });
    if (/^\d$/.test(dow)) return t("sched.weekdayAt", { day: t(DOW_KEYS[parseInt(dow, 10) % 7]), time });
  }
  return cron; // 自定义/未识别：原样展示
}
