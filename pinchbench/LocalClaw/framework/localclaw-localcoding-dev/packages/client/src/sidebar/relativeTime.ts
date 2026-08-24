// 相对时间：刚刚 / N分钟 / N小时 / N天，超 30 天显示日期
// 文案随 locale 切换：zh 返回中文，en 返回英文缩写
type RelLabels = {
  justNow: string;
  minutes: (n: number) => string;
  hours: (n: number) => string;
  days: (n: number) => string;
};

const LABELS: Record<string, RelLabels> = {
  zh: {
    justNow: "刚刚",
    minutes: (n) => `${n} 分钟`,
    hours: (n) => `${n} 小时`,
    days: (n) => `${n} 天`,
  },
  en: {
    justNow: "just now",
    minutes: (n) => `${n}m`,
    hours: (n) => `${n}h`,
    days: (n) => `${n}d`,
  },
};

export function relativeTime(ts?: number, locale: string = "zh"): string {
  if (!ts) return "";
  const l = LABELS[locale] ?? LABELS.zh;
  const diff = Date.now() - ts;
  if (diff < 60_000) return l.justNow;
  const min = Math.floor(diff / 60_000);
  if (min < 60) return l.minutes(min);
  const hr = Math.floor(min / 60);
  if (hr < 24) return l.hours(hr);
  const day = Math.floor(hr / 24);
  if (day < 30) return l.days(day);
  return new Date(ts).toLocaleDateString();
}
