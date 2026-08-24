/**
 * SDK 日志门面（@public）。
 *
 * 问题：库代码若直接 console.* 会污染消费方 stdout，且无法关闭。
 * 方案：所有 SDK 内部日志走本模块的 `logger`，消费方可：
 *   - 用 setSdkLogger() 注入自己的实现（接到 pino / winston / NestJS Logger 等）；
 *   - 或用 setSdkLogLevel("silent") 静默；
 *   - 默认级别由环境变量 LENOVO_SDK_LOG_LEVEL 决定（未设则 "log"，保持历史行为：
 *     log/warn/error 全出；设为 "warn" 可静默常规进度日志，"silent" 全关）。
 *
 * 设计为模块级单例 + 极薄接口：内部文件只需 `import { logger } from ".../logger"`
 * 再 `logger.log(...)`，迁移成本最低；行为可被宿主集中改写。
 */

/** 日志级别，从最吵到最静。silent 完全静默。 */
export type SdkLogLevel = "debug" | "log" | "warn" | "error" | "silent";

/** SDK 日志接口。消费方实现此接口并经 setSdkLogger 注入即可接管全部 SDK 日志。 */
export interface SdkLogger {
  debug(...args: unknown[]): void;
  log(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

const LEVEL_ORDER: Record<Exclude<SdkLogLevel, "silent">, number> = {
  debug: 10,
  log: 20,
  warn: 30,
  error: 40,
};

function resolveDefaultLevel(): SdkLogLevel {
  const fromEnv = (process.env.LENOVO_SDK_LOG_LEVEL ?? "").toLowerCase();
  if (
    fromEnv === "debug" ||
    fromEnv === "log" ||
    fromEnv === "warn" ||
    fromEnv === "error" ||
    fromEnv === "silent"
  ) {
    return fromEnv;
  }
  return "log";
}

let currentLevel: SdkLogLevel = resolveDefaultLevel();

/** 判断某条日志在当前级别下是否应输出。 */
function enabled(method: Exclude<SdkLogLevel, "silent">): boolean {
  if (currentLevel === "silent") return false;
  return LEVEL_ORDER[method] >= LEVEL_ORDER[currentLevel];
}

/** 默认实现：按级别过滤后落到 console。 */
const consoleLogger: SdkLogger = {
  debug: (...a) => enabled("debug") && console.debug(...a),
  log: (...a) => enabled("log") && console.log(...a),
  warn: (...a) => enabled("warn") && console.warn(...a),
  error: (...a) => enabled("error") && console.error(...a),
};

/** 当前生效的 logger（默认 consoleLogger，可被 setSdkLogger 替换）。 */
let active: SdkLogger = consoleLogger;

/**
 * 注入自定义 logger，接管全部 SDK 内部日志。传 null 恢复默认 console 实现。
 * 注入后级别过滤交给自定义实现自行决定（setSdkLogLevel 只影响默认实现）。
 */
export function setSdkLogger(custom: SdkLogger | null): void {
  active = custom ?? consoleLogger;
}

/** 设置默认 console 实现的日志级别（对注入的自定义 logger 无效）。 */
export function setSdkLogLevel(level: SdkLogLevel): void {
  currentLevel = level;
}

/** SDK 内部统一日志入口。内部文件 import 此对象使用。 */
export const logger: SdkLogger = {
  debug: (...a) => active.debug(...a),
  log: (...a) => active.log(...a),
  warn: (...a) => active.warn(...a),
  error: (...a) => active.error(...a),
};
