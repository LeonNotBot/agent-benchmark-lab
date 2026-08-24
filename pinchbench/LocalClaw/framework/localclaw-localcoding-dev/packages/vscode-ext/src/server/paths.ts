import * as path from "path";
import * as fs from "fs";
import type { ExtensionContext } from "vscode";

/**
 * VSCode 扩展版的资源路径解析,对应 Electron 的 cli-path.cjs + main.cjs 里的
 * resolveBundledResourceDir。差异:扩展没有 process.resourcesPath / app.getPath,
 * 资源全部打进 vsix,以 context.extensionPath 为根;用户数据落 globalStorage。
 */

/** vsix 内打包资源根:<extension>/resources/<name>。dev 态回退到仓库 resources/。 */
export function resolveBundledResourceDir(ctx: ExtensionContext, name: string): string {
  const packed = path.join(ctx.extensionPath, "resources", name);
  if (fs.existsSync(packed)) return packed;
  // dev: packages/vscode-ext/../../resources/<name>
  return path.join(ctx.extensionPath, "..", "..", "resources", name);
}

/** server 打包产物入口:<extension>/dist-server/server.cjs;dev 回退仓库根。 */
export function getServerEntry(ctx: ExtensionContext): string {
  const packed = path.join(ctx.extensionPath, "dist-server", "server.cjs");
  if (fs.existsSync(packed)) return packed;
  const dev = path.join(ctx.extensionPath, "..", "..", "dist-server", "server.cjs");
  return fs.existsSync(dev) ? dev : packed;
}

/** claude-cli 入口脚本路径。优先 env 覆盖,再 vsix 内 claude-cli/,最后 dev。 */
export function getClaudeCliPath(ctx: ExtensionContext): string {
  if (process.env.CLAUDE_CLI_PATH && fs.existsSync(process.env.CLAUDE_CLI_PATH)) {
    return process.env.CLAUDE_CLI_PATH;
  }
  const packed = path.join(ctx.extensionPath, "resources", "claude-cli", "cli-node.js");
  if (fs.existsSync(packed)) return packed;
  const dev = path.join(ctx.extensionPath, "..", "claude-cli", "dist", "cli-node.js");
  if (fs.existsSync(dev)) return dev;
  return "";
}

/**
 * 运行 CLI 脚本的 node 可执行文件。
 * 扩展宿主本身跑在 VSCode 的 Electron 里:用 process.execPath + ELECTRON_RUN_AS_NODE=1
 * 即可当 node 用(env 注入见 ServerManager)。若系统有 node 则优先用系统 node,避免
 * 依赖 VSCode 版本的 ABI。
 */
export function getClaudeCliExecutable(): string {
  if (process.env.CLAUDE_CLI_EXECUTABLE) return process.env.CLAUDE_CLI_EXECUTABLE;
  if (isNodeInPath()) return "node";
  return process.execPath;
}

function isNodeInPath(): boolean {
  try {
    const { execSync } = require("child_process");
    execSync(process.platform === "win32" ? "where node" : "which node", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/**
 * 解析系统 node 的绝对路径,用作 fork server 子进程的 execPath。
 *
 * 关键:VSCode 扩展宿主里 fork() 默认用 Code.exe(靠 ELECTRON_RUN_AS_NODE 退化成 node),
 * 但其 Node ABI 与系统 node 不同,加载为系统 node 编译的 better-sqlite3 会立刻崩溃退出。
 * 故显式指定系统 node,让原生模块 ABI 对齐。找不到则返回空(回退 Code.exe + 提示用户)。
 */
export function resolveSystemNode(): string {
  if (process.env.LOCALCODING_NODE_PATH && fs.existsSync(process.env.LOCALCODING_NODE_PATH)) {
    return process.env.LOCALCODING_NODE_PATH;
  }
  try {
    const { execSync } = require("child_process");
    const cmd = process.platform === "win32" ? "where node" : "which node";
    const out = String(execSync(cmd, { stdio: ["ignore", "pipe", "ignore"] }));
    // where 可能返回多行,取第一条存在的。
    for (const line of out.split(/\r?\n/)) {
      const p = line.trim();
      if (p && fs.existsSync(p)) return p;
    }
  } catch {
    /* ignore */
  }
  return "";
}
