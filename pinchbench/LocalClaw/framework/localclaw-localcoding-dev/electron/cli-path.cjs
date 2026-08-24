const path = require("path");
const fs = require("fs");

/**
 * 解析 Electron Helper 二进制路径（macOS 专用）。
 *
 * 为什么不用主二进制 process.execPath：主 App 的 Info.plist 没有 LSUIElement，
 * 用它（即便带 ELECTRON_RUN_AS_NODE=1）跑 CLI 子进程时，macOS LaunchServices 仍会
 * 在 Dock 弹出图标（用户看到的 "exec" 窗口）。而 Helper.app 的 Info.plist 带
 * LSUIElement=1（agent 类型，无 Dock/菜单栏），用它跑 node 脚本完全静默。
 *
 * 主进程的 process.execPath = .../Contents/MacOS/<Product>
 * 目标 Helper      = .../Contents/Frameworks/<Product> Helper.app/Contents/MacOS/<Product> Helper
 */
function getElectronHelperExecutable() {
  const execPath = process.execPath || "";
  // 仅 macOS .app bundle 结构适用；非该结构（dev / 其他平台）返回空，由调用方回退。
  const macosIdx = execPath.indexOf("/Contents/MacOS/");
  if (macosIdx === -1) return "";
  const appRoot = execPath.slice(0, macosIdx); // .../<Product>.app
  const productName = path.basename(execPath); // <Product>
  const helper = path.join(
    appRoot,
    "Contents",
    "Frameworks",
    `${productName} Helper.app`,
    "Contents",
    "MacOS",
    `${productName} Helper`,
  );
  return fs.existsSync(helper) ? helper : "";
}

/**
 * Resolve Claude Code CLI path for both dev and packaged Electron app.
 * Priority: env var > packaged resources > project-local claude-cli/
 */
function getClaudeCliPath() {
  // 1. Env var override
  if (process.env.CLAUDE_CLI_PATH && fs.existsSync(process.env.CLAUDE_CLI_PATH)) {
    return process.env.CLAUDE_CLI_PATH;
  }

  // 2. Packaged Electron app: resources/claude-cli/
  if (process.resourcesPath) {
    const packed = path.join(process.resourcesPath, "claude-cli", "cli-node.js");
    if (fs.existsSync(packed)) return packed;
  }

  // 3. Dev / standalone-node mode: 从私仓包 @lenovo/claude-cli 解析（主工程已不再
  //    维护本地 packages/claude-cli，改为从 registry 消费）。pnpm 严格模式下该包不在
  //    根 node_modules，需从确实依赖它的工作区包（packages/sdk）起解析到 .pnpm 实体。
  try {
    const resolved = require.resolve("@lenovo/claude-cli/cli-node.js", {
      paths: [path.join(__dirname, "..", "packages", "sdk")],
    });
    if (fs.existsSync(resolved)) return resolved;
  } catch {
    /* 未安装或解析失败，落到下方兜底 */
  }

  // 4. 旧布局兜底：本地 packages/claude-cli/dist/（迁出前的历史结构）
  const dev = path.join(__dirname, "..", "packages", "claude-cli", "dist", "cli-node.js");
  if (fs.existsSync(dev)) return dev;

  return "";
}

/**
 * Get the Node.js executable path for running CLI scripts.
 *
 * Problem: In packaged Electron apps on Windows, "node" may not be in PATH.
 * Solution: Use Electron's bundled node.exe when available.
 *
 * macOS 额外要求：用 Helper 二进制（LSUIElement=1）而非主二进制，否则即便带
 * ELECTRON_RUN_AS_NODE=1，CLI 子进程仍会在 Dock 弹图标。见 getElectronHelperExecutable。
 *
 * Priority:
 * 1. CLAUDE_CLI_EXECUTABLE env var (if set to a valid file)
 * 2. Electron Helper 二进制（macOS，静默无 Dock）
 * 3. process.execPath (Electron's own executable — can run node scripts with ELECTRON_RUN_AS_NODE)
 * 4. "node" from system PATH (fallback)
 */
function getElectronNodeExecutable() {
  // macOS：优先 Helper 二进制（无 Dock）；其余平台/dev 回退主 execPath。
  return getElectronHelperExecutable() || process.execPath;
}

function getClaudeCliExecutable() {
  // 1. Env var override
  if (process.env.CLAUDE_CLI_EXECUTABLE) {
    const envPath = process.env.CLAUDE_CLI_EXECUTABLE;
    // If it's "node" and node isn't in PATH, use Electron Helper
    if (envPath === "node" && !isNodeInPath()) {
      return getElectronNodeExecutable();
    }
    return envPath;
  }

  // 2. Check if "node" is available in PATH
  if (!isNodeInPath()) {
    // Fallback to Electron's Helper executable (works as node replacement, no Dock)
    return getElectronNodeExecutable();
  }

  // 3. Default to system node
  return "node";
}

/**
 * Check if "node" command is available in PATH.
 */
function isNodeInPath() {
  try {
    const { execSync } = require("child_process");
    if (process.platform === "win32") {
      execSync("where node", { stdio: "ignore" });
    } else {
      execSync("which node", { stdio: "ignore" });
    }
    return true;
  } catch {
    return false;
  }
}

module.exports = { getClaudeCliPath, getClaudeCliExecutable };
