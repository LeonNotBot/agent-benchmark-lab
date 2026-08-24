// server 端日志初始化：可选地开启 debug 级别 + 把 stdout/stderr 落到日志文件。
//
// 由环境变量按需开启，默认不改变任何行为（生产不被刷屏）：
//   - LENOVO_SDK_LOG_LEVEL=debug  → SDK 门面 logger 输出 debug 级别
//   - LOCALCLAW_LOG_FILE=1        → 把进程 stdout/stderr tee 一份到日志文件
// 二者任一开启即落盘；级别为 debug 时默认也落盘（debug 量大，留档才有意义）。
//
// 文件落在 agentHomeDir/logs/server-YYYY-MM-DD.log（与现有配置目录一致，按天分文件）。
// tee 在 process.stdout/stderr.write 层做：NestJS Logger（底层走 stdout.write）、
// SDK logger、以及散落的 console.* 全部能抓到，无需逐处改造。
//
// 写入时若文件不存在（被外部删除）或已跨天，按需重新创建——见 ensureFile()。
import { createWriteStream, existsSync, mkdirSync, type WriteStream } from "fs";
import { join } from "path";
import { getAgentHomeDir, setSdkLogLevel, type SdkLogLevel } from "@lenovo/agent-sdk";

let installed = false;

// 当前日志文件流及其路径。文件被删 / 跨天后按需重建（见 ensureFile）。
let logDir = "";
let currentPath = "";
let currentFile: WriteStream | null = null;
let lastCheck = 0;
// 写入很频繁，限流避免每行都 existsSync（仅在被删后最多滞后这么久才重建）。
const CHECK_INTERVAL_MS = 1000;

function todayStamp(): string {
  // 本地时区 YYYY-MM-DD（按天分文件，便于排查“今天的日志”）。
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function resolveLevel(): SdkLogLevel | null {
  const v = (process.env.LENOVO_SDK_LOG_LEVEL ?? "").toLowerCase();
  if (v === "debug" || v === "log" || v === "warn" || v === "error" || v === "silent") return v;
  return null;
}

/**
 * 返回当前应写入的日志文件流，按需创建：
 *  - 首次调用、或日期已跨天（文件名按日期）→ 新建对应文件的流，旧流收尾；
 *  - 文件被外部删除 → 重新创建（限流：最多每 CHECK_INTERVAL_MS 检测一次，避免逐行 stat）。
 * 任何失败都不抛出，沿用旧引用（可能为 null），保证不影响正常输出。
 */
function ensureFile(): WriteStream | null {
  const filePath = join(logDir, `server-${todayStamp()}.log`);
  // 跨天或还没有流：建新流（旧流收尾）。
  if (filePath !== currentPath || !currentFile) {
    try {
      mkdirSync(logDir, { recursive: true });
      const next = createWriteStream(filePath, { flags: "a" });
      const old = currentFile;
      currentFile = next;
      currentPath = filePath;
      lastCheck = Date.now();
      if (old) try { old.end(); } catch { /* ignore */ }
    } catch {
      /* 建失败就沿用旧的（可能为 null） */
    }
    return currentFile;
  }
  // 同一天：限流检测文件是否被删，删了就重建。
  const now = Date.now();
  if (now - lastCheck >= CHECK_INTERVAL_MS) {
    lastCheck = now;
    if (!existsSync(currentPath)) {
      try {
        mkdirSync(logDir, { recursive: true });
        currentFile = createWriteStream(currentPath, { flags: "a" });
      } catch {
        /* 保留旧引用 */
      }
    }
  }
  return currentFile;
}

/** 把 stream.write 包一层：原样输出的同时复制一份到（按需重建的）文件流。 */
function tee(stream: NodeJS.WriteStream): void {
  const original = stream.write.bind(stream);
  // 覆盖 write：先写文件（去掉 ANSI 颜色码，文件里更干净），再走原始输出。
  // 保持原签名与返回值，避免影响背压判断。
  (stream as NodeJS.WriteStream).write = ((chunk: any, encoding?: any, cb?: any) => {
    try {
      const file = ensureFile();
      if (file) {
        const text = typeof chunk === "string" ? chunk : chunk?.toString?.("utf8") ?? "";
        // eslint-disable-next-line no-control-regex
        file.write(text.replace(/\[[0-9;]*m/g, ""));
      }
    } catch {
      /* 落盘失败不能影响正常输出 */
    }
    return original(chunk, encoding, cb);
  }) as typeof stream.write;
}

/**
 * 初始化日志：按环境变量开启 debug 级别与文件落盘。幂等。
 * 必须在任何 SDK Service 实例化、任何日志产生前调用（main.ts 顶部）。
 */
export function initLogging(): void {
  if (installed) return;
  installed = true;

  const level = resolveLevel();
  if (level) setSdkLogLevel(level);

  const wantFile = process.env.LOCALCLAW_LOG_FILE === "1" || level === "debug";
  if (!wantFile) return;

  try {
    logDir = join(getAgentHomeDir(), "logs");
    const file = ensureFile(); // 首次创建（含 mkdir）
    if (file) {
      file.write(`\n===== server start ${new Date().toISOString()} (pid=${process.pid}, level=${level ?? "default"}) =====\n`);
    }
    tee(process.stdout);
    tee(process.stderr);
    // 经原始 console 直接报一行落盘位置（此时 tee 已装好，这行也会进文件）。
    console.log(`[logging] debug log file: ${currentPath}`);
  } catch (e: any) {
    console.error(`[logging] failed to init log file: ${e?.message ?? e}`);
  }
}
