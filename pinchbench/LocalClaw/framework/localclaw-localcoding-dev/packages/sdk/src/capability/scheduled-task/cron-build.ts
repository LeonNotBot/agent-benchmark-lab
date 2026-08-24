/**
 * 排程 → cron 表达式构建 —— 纯函数，无 NestJS 依赖（@public）。
 *
 * 单一真相源：前端 ScheduleControl、MCP cron-tools、REST controller、Service 层
 * 全部复用本模块，杜绝 buildCron / cron 字段顺序在多处各自漂移。
 *
 * 校验复用同目录 cron-match.ts 的 isValidCron（真正逐 piece 解析，强于正则）。
 */
import { isValidCron } from "./cron-match";

export { isValidCron };

/** 结构化排程：模型/UI 只描述意图，cron 表达式由 buildCron 权威生成。 */
export interface ScheduleSpec {
  kind: "interval" | "hourly" | "daily" | "workday" | "weekly" | "custom";
  /** interval：每 N 分钟。1~59。 */
  intervalMin?: number;
  /** daily/workday/weekly：触发时间 "HH:MM"（24 小时制）。 */
  time?: string;
  /** weekly：1(周一)~7(周日)。 */
  weekday?: number;
  /** custom：用户直接给定的 5 段表达式。 */
  cron?: string;
}

/** 解析 "HH:MM" → [时, 分]，非法位回退 0。 */
function parseHM(time?: string): [number, number] {
  const [h, m] = String(time ?? "").split(":").map((x) => parseInt(x, 10));
  return [Number.isFinite(h) ? h : 0, Number.isFinite(m) ? m : 0];
}

/**
 * 由结构化 spec 生成 5 段 cron 表达式。
 * 与前端 ScheduleControl.buildCron 字段顺序、周日换算(7→0)保持一致。
 */
export function buildCron(spec: ScheduleSpec): string {
  const [h, m] = parseHM(spec.time);
  switch (spec.kind) {
    case "interval": return `*/${spec.intervalMin ?? 30} * * * *`;
    case "hourly": return "0 * * * *";
    case "daily": return `${m} ${h} * * *`;
    case "workday": return `${m} ${h} * * 1-5`;
    case "weekly": return `${m} ${h} * * ${(spec.weekday ?? 1) % 7}`;
    case "custom": return String(spec.cron ?? "").trim();
  }
}

/**
 * 解析任意创建入参为最终 cron：优先用结构化 spec.kind，否则回退裸 cron 串。
 * 返回 { cron, error }：error 非空表示无法得到合法 cron。这是创建路径的唯一收口逻辑。
 */
export function resolveCron(input: { cron?: string; schedule?: ScheduleSpec }): {
  cron: string;
  error: string | null;
} {
  const cron = input.schedule?.kind
    ? buildCron(input.schedule)
    : String(input.cron ?? "").trim();
  if (!cron) return { cron: "", error: "missing_cron" };
  if (!isValidCron(cron)) return { cron, error: "invalid_cron" };
  return { cron, error: null };
}
