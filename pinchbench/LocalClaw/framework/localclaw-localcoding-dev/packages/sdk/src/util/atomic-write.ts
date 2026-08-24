import { writeFileSync, renameSync, unlinkSync } from "fs";
import { logger } from "./logger";

/**
 * 跨平台原子写文件（@public）。
 *
 * 模式：先写 `<path>.tmp.<pid>.<ts>` 再 renameSync 覆盖目标，保证读者永远看到
 * 完整内容、不会读到写一半的半截文件。
 *
 * Windows 加固：POSIX 的 rename 可覆盖「正被打开」的目标，但 Windows 在目标被
 * 占用时（杀毒/EDR 实时扫描短暂锁文件、上个进程句柄未释放、受控文件夹访问等）
 * 会抛 EPERM/EBUSY/EACCES。这类锁通常是**瞬时**的，故对 rename 做有限次退避重试；
 * 仍失败则清理临时文件后抛出原始错误，绝不残留 `.tmp.*` 垃圾。
 */

/** Windows 文件锁导致的可重试错误码。 */
const RETRYABLE_CODES = new Set(["EPERM", "EBUSY", "EACCES"]);
const MAX_RETRIES = 10;
const RETRY_DELAY_MS = 50;

/** 同步等待（不忙等 CPU）：用 Atomics.wait 阻塞当前线程指定毫秒。 */
function sleepSync(ms: number): void {
  const view = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(view, 0, 0, ms);
}

/**
 * 原子写入文件内容。失败时按需重试（针对 Windows 瞬时文件锁），
 * 最终失败会清理临时文件并抛出最后一次的错误。
 *
 * @param path     目标文件绝对/相对路径
 * @param content  要写入的字符串内容
 * @param encoding 编码，默认 utf8
 */
export function atomicWriteFile(
  path: string,
  content: string,
  encoding: BufferEncoding = "utf8",
): void {
  const tmp = `${path}.tmp.${process.pid}.${Date.now()}`;
  writeFileSync(tmp, content, encoding);

  let lastErr: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      renameSync(tmp, path);
      return;
    } catch (err) {
      lastErr = err;
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code && RETRYABLE_CODES.has(code) && attempt < MAX_RETRIES) {
        if (attempt === 0) {
          logger.warn(
            `[atomic-write] rename ${path} 失败(${code})，重试中（可能是杀毒/进程占用瞬时锁）`,
          );
        }
        sleepSync(RETRY_DELAY_MS);
        continue;
      }
      break;
    }
  }

  // 重试耗尽：清理临时文件（避免残留垃圾），再抛出原始错误供上层处理。
  try {
    unlinkSync(tmp);
  } catch {
    /* tmp 清理失败无所谓，忽略 */
  }
  throw lastErr;
}
