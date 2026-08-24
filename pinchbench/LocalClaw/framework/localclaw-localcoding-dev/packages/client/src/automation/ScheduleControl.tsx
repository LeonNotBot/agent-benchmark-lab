// 计划控件(本地运行环境)：频率(每小时/每天/工作日/每周/自定义) + 星期 + 时间 + 自定义 cron。
// 对应设计图 1~9.png。纯前端状态，cron 由各字段实时拼装。文案经 t() 走 i18n。
import { useEffect, useRef, useState } from "react";
import { useLocale } from "../i18n";
import { Dropdown } from "./ManualCreateFooter";

export type ScheduleKind = "interval" | "hourly" | "daily" | "workday" | "weekly" | "custom";

export interface ScheduleState {
  kind: ScheduleKind;
  intervalMin: number; // interval
  time: string;        // "HH:MM"，用于 daily/workday/weekly
  weekday: number;     // 1(周一)~7(周日)，用于 weekly
  cron: string;        // custom 表达式
}

export const DEFAULT_SCHEDULE: ScheduleState = {
  kind: "hourly", intervalMin: 30, time: "09:00", weekday: 1, cron: "",
};

// 频率 key → i18n key（label 在组件内用 t() 解析）
const FREQ_KEYS: { key: ScheduleKind; tk: string }[] = [
  { key: "hourly", tk: "sched.hourly" },
  { key: "daily", tk: "sched.daily" },
  { key: "workday", tk: "sched.workday" },
  { key: "weekly", tk: "sched.weekly" },
  { key: "custom", tk: "sched.custom" },
];
// 星期一→日 的 i18n key（weekday 字段 1~7 对应索引 0~6）
const WEEKDAY_KEYS = ["weekday.mon", "weekday.tue", "weekday.wed", "weekday.thu", "weekday.fri", "weekday.sat", "weekday.sun"];

// "09:00" → "9:00"（小时去前导零，分钟保留两位），用于 chip 文案
function hmShort(time: string): string {
  const [h, m] = time.split(":");
  return `${parseInt(h, 10)}:${m ?? "00"}`;
}

// 由当前各字段拼 cron（自定义模式默认值 / 后端提交用）
export function buildCron(s: ScheduleState): string {
  const [h, m] = s.time.split(":").map((x) => parseInt(x, 10) || 0);
  switch (s.kind) {
    case "interval": return `*/${s.intervalMin} * * * *`;
    case "hourly": return "0 * * * *";
    case "daily": return `${m} ${h} * * *`;
    case "workday": return `${m} ${h} * * 1-5`;
    case "weekly": return `${m} ${h} * * ${s.weekday % 7}`; // 7(周日)→0
    case "custom": return s.cron;
  }
}

type T = (key: string, params?: Record<string, string | number>) => string;

// chip 文案（需 locale，经 t() 生成）
export function scheduleLabel(t: T, s: ScheduleState): string {
  switch (s.kind) {
    case "interval": return t("sched.everyN", { n: s.intervalMin });
    case "hourly": return t("sched.hourly");
    case "daily": return t("sched.dailyAt", { time: hmShort(s.time) });
    case "workday": return t("sched.workdayAt", { time: hmShort(s.time) });
    case "weekly": return t("sched.weeklyChip", { day: t(WEEKDAY_KEYS[s.weekday - 1]), time: hmShort(s.time) });
    case "custom": return t("sched.custom");
  }
}

// cron 串 → ScheduleState（详情页回填用）。识别 buildCron 产出的形态，其余落 custom。
export function cronToSchedule(cron: string): ScheduleState {
  const base = { ...DEFAULT_SCHEDULE };
  const parts = String(cron ?? "").trim().split(/\s+/);
  if (parts.length !== 5) return { ...base, kind: "custom", cron };
  const [min, hour, dom, mon, dow] = parts;
  const itv = /^\*\/(\d+)$/.exec(min);
  if (itv && hour === "*" && dom === "*" && mon === "*" && dow === "*")
    return { ...base, kind: "interval", intervalMin: parseInt(itv[1], 10) };
  if (min === "0" && hour === "*" && dom === "*" && mon === "*" && dow === "*")
    return { ...base, kind: "hourly" };
  if (/^\d+$/.test(min) && /^\d+$/.test(hour) && dom === "*" && mon === "*") {
    const time = `${hour.padStart(2, "0")}:${min.padStart(2, "0")}`;
    if (dow === "*") return { ...base, kind: "daily", time };
    if (dow === "1-5") return { ...base, kind: "workday", time };
    if (/^\d$/.test(dow)) return { ...base, kind: "weekly", time, weekday: parseInt(dow, 10) === 0 ? 7 : parseInt(dow, 10) };
  }
  return { ...base, kind: "custom", cron };
}

// 主控件：chip + 下拉面板（占位，后续补充内部 FreqSelect / WeekdaySelect / TimeField）
export function ScheduleDropdown({ value, onChange, allowInterval, keepHourly, panelClass }: {
  value: ScheduleState; onChange: (s: ScheduleState) => void; allowInterval?: boolean; keepHourly?: boolean; panelClass?: string;
}) {
  const { t } = useLocale();
  const label = (
    <span className="flex items-center gap-1">
      <ClockIcon />
      {scheduleLabel(t, value)}
    </span>
  );
  return (
    <Dropdown label={label} panelClass={panelClass}>
      {() => (
        <div className="w-56 px-3 pb-3 pt-1">
          <div className="px-0.5 pb-1.5 text-[11px] font-medium text-text-400">{t("auto.plan")}</div>
          <ScheduleBody value={value} onChange={onChange} allowInterval={allowInterval} keepHourly={keepHourly} />
        </div>
      )}
    </Dropdown>
  );
}

function ClockIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
  );
}

// 面板主体：频率框 + (每周时)星期框 + (每天/工作日/每周时)时间框 + (自定义时)cron 输入
function ScheduleBody({ value, onChange, allowInterval, keepHourly }: {
  value: ScheduleState; onChange: (s: ScheduleState) => void; allowInterval?: boolean; keepHourly?: boolean;
}) {
  const { t } = useLocale();
  const showTime = value.kind === "daily" || value.kind === "workday" || value.kind === "weekly";
  const weekdays = WEEKDAY_KEYS.map((k) => t(k));
  // 频率选项：
  //   默认(本地创建)：每小时/每天/工作日/每周/自定义。
  //   对话模式(allowInterval)：以「间隔」取代「每小时」(图 1/2)。
  //   编辑页(allowInterval+keepHourly)：同时保留「每小时」与「间隔」，使任意 cron 都能正确回填。
  const baseFreq = FREQ_KEYS.map((o) => ({ key: o.key, label: t(o.tk) }));
  const freqOpts = allowInterval
    ? [
        { key: "interval" as ScheduleKind, label: t("sched.interval") },
        ...baseFreq.filter((o) => keepHourly || o.key !== "hourly"),
      ]
    : baseFreq;
  const curOpt = freqOpts.find((o) => o.key === value.kind) ?? freqOpts[0];
  return (
    <div className="flex flex-col gap-2">
      {/* 频率选择框（图 2/3）：高亮蓝色边框 */}
      <BoxSelect
        value={curOpt.label}
        active
        options={freqOpts.map((o) => ({ key: o.key, label: o.label }))}
        selectedKey={value.kind}
        onPick={(key) => {
          const kind = key as ScheduleKind;
          // 切到自定义时，默认填入当前各字段拼出的 cron 供用户编辑
          if (kind === "custom") onChange({ ...value, kind, cron: value.cron || buildCron(value) });
          else onChange({ ...value, kind });
        }}
      />

      {/* 间隔：每隔 N 分钟（图 33） */}
      {value.kind === "interval" && (
        <div className="flex items-center gap-1.5 text-[13px] text-text-300">
          {t("sched.intervalEvery")}
          <input type="number" min={1} value={value.intervalMin}
            onChange={(e) => onChange({ ...value, intervalMin: Math.max(1, parseInt(e.target.value) || 1) })}
            className="w-16 rounded-md border border-border-300 bg-bg-000 px-2 py-1 text-center text-text-100 outline-none focus:border-accent-brand" />
          {t("sched.intervalUnit")}
        </div>
      )}

      {/* 每周：星期选择框（图 5/6），默认星期一 */}
      {value.kind === "weekly" && (
        <BoxSelect
          value={weekdays[value.weekday - 1]}
          options={weekdays.map((w, i) => ({ key: String(i + 1), label: w }))}
          selectedKey={String(value.weekday)}
          onPick={(key) => onChange({ ...value, weekday: parseInt(key, 10) })}
        />
      )}

      {/* 时间框（图 4/5/8/9）：可编辑 HH:MM + 右侧时钟下拉 */}
      {showTime && (
        <TimeField value={value.time} onChange={(time) => onChange({ ...value, time })} />
      )}

      {/* 自定义：cron 表达式直接编辑（默认填当前各字段拼出的表达式） */}
      {value.kind === "custom" && (
        <input
          value={value.cron}
          onChange={(e) => onChange({ ...value, cron: e.target.value })}
          placeholder="* * * * *"
          className="w-full rounded-lg border border-border-300 bg-bg-000 px-3 py-2 text-[13px] text-text-100 outline-none focus:border-accent-brand"
        />
      )}
    </div>
  );
}


// 0:00 起每 15 分钟一档，共 96 项："H:MM"（小时不补零，与图 8 一致）
const TIME_SLOTS: string[] = Array.from({ length: 96 }, (_, i) => {
  const h = Math.floor(i / 4), m = (i % 4) * 15;
  return `${h}:${String(m).padStart(2, "0")}`;
});

// "HH:MM"/"H:MM" → 分钟数；非法返回 -1
function toMinutes(t: string): number {
  const m = t.match(/^(\d{1,2}):(\d{1,2})$/);
  if (!m) return -1;
  const hh = parseInt(m[1], 10), mm = parseInt(m[2], 10);
  if (hh > 23 || mm > 59) return -1;
  return hh * 60 + mm;
}

// 找与目标分钟最接近的档位索引
function nearestSlotIndex(mins: number): number {
  if (mins < 0) return 0;
  let best = 0, diff = Infinity;
  TIME_SLOTS.forEach((s, i) => {
    const d = Math.abs(toMinutes(s) - mins);
    if (d < diff) { diff = d; best = i; }
  });
  return best;
}

// 时间字段(图 9 直接编辑 / 图 8 下拉编辑联动)：HH:MM 输入 + 时钟按钮 → 15 分钟档下拉。
function TimeField({ value, onChange }: { value: string; onChange: (t: string) => void }) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(value);
  const ref = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // 外部 value 变化时同步显示文本
  useEffect(() => { setText(value); }, [value]);

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) { setOpen(false); commit(); } };
    window.addEventListener("mousedown", h);
    return () => window.removeEventListener("mousedown", h);
  }, [open, text]);

  // 打开下拉时滚动到匹配/相近项
  useEffect(() => {
    if (!open || !listRef.current) return;
    const idx = nearestSlotIndex(toMinutes(text));
    const el = listRef.current.children[idx] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "center" });
  }, [open]);

  // 规范化提交：合法则补零成 HH:MM，非法回退原值
  const commit = () => {
    const mins = toMinutes(text);
    if (mins < 0) { setText(value); return; }
    const norm = `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
    onChange(norm);
  };

  const mins = toMinutes(text);
  const matchIdx = TIME_SLOTS.findIndex((s) => toMinutes(s) === mins);
  const highlightIdx = matchIdx >= 0 ? matchIdx : nearestSlotIndex(mins);

  return (
    <div ref={ref} className="relative">
      <div className={`flex items-center rounded-lg border bg-bg-000 px-3 py-2 ${open ? "border-accent-brand" : "border-border-300"}`}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => { if (e.key === "Enter") { commit(); setOpen(false); } }}
          placeholder="09:00"
          className="w-full bg-transparent text-[13px] text-text-100 outline-none"
        />
        <button onClick={() => setOpen((v) => !v)} aria-label={t("auto.selectTime")} className="ml-1 shrink-0 text-text-400 hover:text-text-200">
          <ClockIcon />
        </button>
      </div>
      {open && (
        <div ref={listRef} className="absolute left-0 top-full z-40 mt-1 max-h-[180px] w-full overflow-y-auto rounded-xl border border-border-300 bg-bg-000 py-1.5 shadow-elevated">
          {TIME_SLOTS.map((s, i) => (
            <button key={s}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { onChange(s); setText(s); setOpen(false); }}
              className={`block w-full px-3.5 py-1.5 text-left text-[13px] transition-colors hover:bg-bg-200 ${i === highlightIdx ? "bg-bg-100 text-accent-text font-medium" : "text-text-100"}`}>
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// 盒式下拉选择：白底圆角框 + 右侧 chevron，点击在下方展开选项列表（选中项打勾）。
// active=true 时蓝色高亮边框（图 2/3 的频率框、图 5 的每周频率框）。
function BoxSelect({ value, active, options, selectedKey, onPick }: {
  value: string;
  active?: boolean;
  options: { key: string; label: string }[];
  selectedKey: string;
  onPick: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    window.addEventListener("mousedown", h);
    return () => window.removeEventListener("mousedown", h);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`flex w-full items-center justify-between rounded-lg border bg-bg-000 px-3 py-2 text-[13px] text-text-100 transition-colors ${open || active ? "border-accent-brand" : "border-border-300 hover:border-text-400"}`}
      >
        {value}
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 text-text-400" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
      </button>
      {open && (
        <div className="absolute left-0 top-full z-40 mt-1 max-h-[260px] w-full overflow-y-auto rounded-xl border border-border-300 bg-bg-000 py-1.5 shadow-elevated">
          {options.map((o) => {
            const sel = o.key === selectedKey;
            return (
              <button key={o.key} onClick={() => { onPick(o.key); setOpen(false); }}
                className="flex w-full items-center justify-between px-3.5 py-2 text-left text-[13px] text-text-100 transition-colors hover:bg-bg-200">
                {o.label}
                {sel && <svg viewBox="0 0 24 24" className="h-4 w-4 text-text-200" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5L20 7" /></svg>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
