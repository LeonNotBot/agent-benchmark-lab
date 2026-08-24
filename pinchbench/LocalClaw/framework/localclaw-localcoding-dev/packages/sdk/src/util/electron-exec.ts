/**
 * 判断给定可执行文件是否为 Electron 二进制（@public）。
 *
 * 用途：用 Electron 二进制跑 JS（CLI / MCP 子进程）时，必须以
 * `ELECTRON_RUN_AS_NODE=1` 启动，否则会被 macOS/Windows 当成完整 GUI app 拉起，
 * 在 Dock / 任务栏弹出图标（用户可见的「终端工具 / exec」窗口）。
 *
 * 不靠产品名硬匹配（改名后必失效，如 Local Claw → LocalCoding）。判定依据：
 *  1) 与当前进程的 execPath 相同 —— server 由 Electron fork，process.execPath 即
 *     Electron 二进制；复用同一执行体时必然也是 Electron。
 *  2) process.versions.electron 存在（运行在 Electron 运行时内）且执行体不是裸 node。
 *  3) 路径特征兜底：含 "electron"，或位于 macOS .app bundle 内（/Contents/MacOS/），
 *     或以 .exe 结尾但不是 node.exe（Windows 打包二进制）。
 */
export function isElectronExecutable(execPath: string | undefined | null): boolean {
  if (!execPath || execPath === "node") return false;
  const lower = execPath.toLowerCase();
  const base = lower.replace(/\\/g, "/").split("/").pop() || "";
  // 裸 node / node.exe：明确不是 Electron。
  if (base === "node" || base === "node.exe") return false;
  // 1) 与当前 Electron 进程执行体相同。
  if (process.execPath && execPath === process.execPath) return true;
  // 2) 运行在 Electron 运行时内，且执行体非裸 node。
  if ((process as { versions?: { electron?: string } }).versions?.electron) return true;
  // 3) 路径特征兜底。
  if (lower.includes("electron")) return true;
  if (lower.includes("/contents/macos/")) return true; // macOS .app bundle
  if (lower.endsWith(".exe")) return true; // Windows 打包二进制（已排除 node.exe）
  return false;
}
