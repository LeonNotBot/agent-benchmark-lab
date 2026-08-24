const path = require("path");
const fs = require("fs");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const BETTER_SQLITE3_DIR = path.dirname(
    require.resolve("better-sqlite3/package.json", { paths: [ROOT] }),
);

function resolvePrebuildInstallBin() {
    try {
        return require.resolve("prebuild-install/bin.js", {
            paths: [BETTER_SQLITE3_DIR, ROOT],
        });
    } catch {
        return null;
    }
}

const PREBUILD_INSTALL_BIN = resolvePrebuildInstallBin();

function run(command, args, label) {
    const display = [command, ...args].join(" ");
    console.log(`[start-node] ${label}: ${display}`);
    const result = spawnSync(command, args, {
        cwd: ROOT,
        stdio: "inherit",
        shell: false,
        env: process.env,
    });

    if (result.error) {
        throw result.error;
    }
    if (result.status !== 0) {
        throw new Error(`${label} failed with exit code ${result.status}`);
    }
}

function canLoadBetterSqlite3WithNode(nodePath) {
    const probe = spawnSync(
        nodePath,
        ["-e", "new (require('better-sqlite3'))(':memory:').close()"],
        { cwd: ROOT, stdio: "ignore", shell: false, env: process.env },
    );
    return probe.status === 0;
}

function tryPrebuildInstall(nodePath) {
    if (!PREBUILD_INSTALL_BIN || !fs.existsSync(PREBUILD_INSTALL_BIN)) {
        console.log("[start-node] prebuild-install not found in node_modules, skipping");
        return false;
    }
    console.log(`[start-node] Running prebuild-install with ${nodePath} (${PREBUILD_INSTALL_BIN})`);
    const result = spawnSync(nodePath, [PREBUILD_INSTALL_BIN], {
        cwd: BETTER_SQLITE3_DIR,
        stdio: "inherit",
        shell: false,
        env: process.env,
    });
    return result.status === 0;
}

function tryNodeGypRebuild(nodePath) {
    const nodeGypBin = path.join(ROOT, "node_modules", ".bin", "node-gyp");
    const nodeGypJs = path.join(
        ROOT,
        "node_modules",
        "node-gyp",
        "bin",
        "node-gyp.js",
    );
    const gypFile = fs.existsSync(nodeGypJs) ? nodeGypJs : null;
    if (!gypFile && !fs.existsSync(nodeGypBin)) return false;

    console.log(`[start-node] Attempting node-gyp rebuild for ${nodePath}`);
    const target = spawnSync(nodePath, ["--version"], { encoding: "utf8" });
    const nodeVersion = (target.stdout || "").trim().replace(/^v/, "");
    if (!nodeVersion) return false;

    const args = gypFile
        ? [gypFile, "rebuild", "--release", `--target=${nodeVersion}`]
        : ["rebuild", "--release", `--target=${nodeVersion}`];
    const cmd = gypFile ? nodePath : nodeGypBin;

    const result = spawnSync(cmd, args, {
        cwd: BETTER_SQLITE3_DIR,
        stdio: "inherit",
        shell: false,
        env: process.env,
    });
    return result.status === 0;
}

function findNvmNodeVersions() {
    const nvmDir = process.env.NVM_HOME || process.env.NVM_DIR;
    if (!nvmDir) return [];

    let versionDirs;
    try {
        versionDirs = fs.readdirSync(nvmDir).filter((d) => /^v?\d+/.test(d));
    } catch {
        return [];
    }

    const nodes = [];
    for (const dir of versionDirs.sort().reverse()) {
        const nodePath = path.join(nvmDir, dir, "node.exe");
        if (fs.existsSync(nodePath)) {
            nodes.push(nodePath);
        }
    }
    return nodes;
}

function rebuildForNode(nodePath) {
    if (tryPrebuildInstall(nodePath)) return true;
    if (tryNodeGypRebuild(nodePath)) return true;
    return false;
}

function startServer(nodePath) {
    const serverModuleDir = path.join(ROOT, "packages", "server", "node_modules");
    const env = { ...process.env };
    if (fs.existsSync(serverModuleDir)) {
        const existing = env.NODE_PATH ? env.NODE_PATH + path.delimiter : "";
        env.NODE_PATH = existing + serverModuleDir;
    }
    // 注入 CLAUDE_CLI_PATH：standalone node 模式下 server.cjs 跑在 dist-server，
    // 既不在 Electron resourcesPath 也无法从那里 require.resolve @lenovo/claude-cli，
    // 故与 main.cjs 一致，由启动器解析好 CLI 路径注入（尊重已有 env 覆盖）。
    if (!env.CLAUDE_CLI_PATH) {
        try {
            const { getClaudeCliPath } = require("../electron/cli-path.cjs");
            const cliPath = getClaudeCliPath();
            if (cliPath) env.CLAUDE_CLI_PATH = cliPath;
        } catch { /* 解析失败则交由 server 自身兜底/报错 */ }
    }
    console.log(`[start-node] Start server: ${nodePath} dist-server/server.cjs`);
    console.log(`[start-node] CLAUDE_CLI_PATH=${env.CLAUDE_CLI_PATH || "(unresolved)"}`);
    const result = spawnSync(
        nodePath,
        [path.join("dist-server", "server.cjs")],
        { cwd: ROOT, stdio: "inherit", shell: false, env },
    );
    if (result.error) throw result.error;
    if (result.status !== 0) {
        throw new Error(`Start server failed with exit code ${result.status}`);
    }
}

function main() {
    const nodeAbi = process.versions.modules;
    console.log(`[start-node] Current Node: ${process.version} ABI=${nodeAbi}`);

    let sqliteCompatible = false;
    try {
        const Database = require("better-sqlite3");
        const db = new Database(":memory:");
        db.close();
        console.log("[start-node] better-sqlite3 is compatible, skipping rebuild");
        sqliteCompatible = true;
    } catch (e) {
        console.log(`[start-node] better-sqlite3 incompatible: ${e.message}`);
    }

    if (sqliteCompatible) {
        startServer(process.execPath);
        return;
    }

    console.log(
        "[start-node] better-sqlite3 binary missing or ABI mismatch, attempting prebuild-install...",
    );

    if (rebuildForNode(process.execPath)) {
    if (canLoadBetterSqlite3WithNode(process.execPath)) {
        console.log(
            "[start-node] better-sqlite3 rebuilt successfully for current Node",
        );
        startServer(process.execPath);
        return;
    }
}

console.log(
    "[start-node] No prebuilt binary for current Node, searching for compatible Node...",
);
const nvmNodes = findNvmNodeVersions();
for (const nodePath of nvmNodes) {
    if (nodePath === process.execPath) continue;

    if (canLoadBetterSqlite3WithNode(nodePath)) {
        const ver = spawnSync(nodePath, ["--version"], { encoding: "utf8" });
        console.log(
            `[start-node] Found compatible Node: ${nodePath} (${(ver.stdout || "").trim()})`,
        );
        startServer(nodePath);
        return;
    }

    console.log(`[start-node] Trying prebuild-install for ${nodePath}...`);
    if (rebuildForNode(nodePath) && canLoadBetterSqlite3WithNode(nodePath)) {
        const ver = spawnSync(nodePath, ["--version"], { encoding: "utf8" });
        console.log(
            `[start-node] Rebuilt for ${nodePath} (${(ver.stdout || "").trim()})`,
        );
        startServer(nodePath);
        return;
    }
}

console.error(
    "[start-node] ERROR: Cannot load better-sqlite3 with any available Node version.\n" +
    "[start-node] Current Node " +
    process.version +
    " (ABI " +
    nodeAbi +
    ") has no prebuilt binary.\n" +
    "[start-node] Fix options:\n" +
    "[start-node]   1. Install Node v22 LTS: nvm install 22 && nvm use 22\n" +
    "[start-node]   2. Install Visual Studio Build Tools and run: npx prebuild-install (in node_modules/better-sqlite3)",
);
process.exit(1);
}

try {
    main();
} catch (error) {
    console.error("[start-node] Error:", error.stack || error.message);
    process.exit(1);
}
