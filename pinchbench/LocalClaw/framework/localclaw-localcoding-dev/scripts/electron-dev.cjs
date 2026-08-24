const path = require("path");
const fs = require("fs");
const http = require("http");
const { spawn, spawnSync } = require("child_process");

// Load .env.local if present
const envLocalPath = path.resolve(__dirname, "..", ".env.local");
if (fs.existsSync(envLocalPath)) {
    const lines = fs.readFileSync(envLocalPath, "utf8").split(/\r?\n/);
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eqIdx = trimmed.indexOf("=");
        if (eqIdx === -1) continue;
        const key = trimmed.slice(0, eqIdx).trim();
        const val = trimmed.slice(eqIdx + 1).trim();
        if (key && !(key in process.env)) process.env[key] = val;
    }
}

const ROOT = path.resolve(__dirname, "..");
const SERVER_URL = "http://127.0.0.1:10086";
const HEALTH_URL = `${SERVER_URL}/api/health`;
const SERVER_PORT = 10086;
const LOCK_FILE = path.join(__dirname, ".electron-dev.lock");

function acquireLock() {
    if (fs.existsSync(LOCK_FILE)) {
        const prevPid = parseInt(fs.readFileSync(LOCK_FILE, "utf8").trim(), 10);
        if (prevPid && !isNaN(prevPid) && prevPid !== process.pid) {
            console.log(`[electron-dev] Terminating previous instance (PID ${prevPid})`);
            try {
                if (process.platform === "win32") {
                    spawnSync("taskkill", ["/pid", String(prevPid), "/f", "/t"], { shell: false, stdio: "ignore" });
                } else {
                    spawnSync("kill", ["-9", String(prevPid)], { shell: false, stdio: "ignore" });
                }
            } catch {}
        }
    }
    fs.writeFileSync(LOCK_FILE, String(process.pid), "utf8");
    const releaseLock = () => { try { fs.unlinkSync(LOCK_FILE); } catch {} };
    process.on("exit", releaseLock);
    process.on("SIGINT", () => { releaseLock(); process.exit(130); });
    process.on("SIGTERM", () => { releaseLock(); process.exit(143); });
}

function killPortProcess(port) {
    try {
        if (process.platform === "win32") {
            const result = spawnSync("netstat", ["-ano"], { encoding: "utf8", shell: false });
            if (result.stdout) {
                const lines = result.stdout.split("\n");
                for (const line of lines) {
                    if (line.includes(`:${port} `) && line.includes("LISTENING")) {
                        const parts = line.trim().split(/\s+/);
                        const pid = parts[parts.length - 1];
                        if (pid && /^\d+$/.test(pid) && pid !== "0") {
                            console.log(`[electron-dev] Killing stale server on port ${port} (PID ${pid})`);
                            spawnSync("taskkill", ["/pid", pid, "/f", "/t"], { shell: false, stdio: "ignore" });
                        }
                    }
                }
            }
        } else {
            const result = spawnSync("lsof", ["-ti", `:${port}`], { encoding: "utf8", shell: false });
            if (result.stdout && result.stdout.trim()) {
                for (const pid of result.stdout.trim().split("\n")) {
                    if (/^\d+$/.test(pid)) {
                        console.log(`[electron-dev] Killing stale server on port ${port} (PID ${pid})`);
                        spawnSync("kill", ["-9", pid], { shell: false, stdio: "ignore" });
                    }
                }
            }
        }
    } catch {
        // ignore — best-effort cleanup
    }
}

function sleepMs(ms) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// Attempt to actually bind to the port; more reliable than netstat parsing.
function isPortBindable(port) {
    const code = `
const net = require('net');
const s = net.createServer();
s.listen(${port}, '0.0.0.0', () => { s.close(() => process.exit(0)); });
s.on('error', () => process.exit(1));
`;
    const result = spawnSync(process.execPath, ["-e", code], { timeout: 3000, shell: false });
    return result.status === 0;
}

function waitForPortFree(port, maxRetries = 30, intervalMs = 300) {
    for (let i = 0; i < maxRetries; i++) {
        if (isPortBindable(port)) return;
        console.log(`[electron-dev] Port ${port} still occupied, waiting... (${i + 1}/${maxRetries})`);
        sleepMs(intervalMs);
    }
    console.log(`[electron-dev] Warning: port ${port} may still be in use, proceeding anyway`);
}

function run(command, args, label, env = process.env) {
    const display = [command, ...args].join(" ");
    console.log(`[electron-dev] ${label}: ${display}`);
    const result = spawnSync(command, args, {
        cwd: ROOT,
        stdio: "inherit",
        shell: false,
        env,
    });

    if (result.error) {
        throw result.error;
    }
    if (result.status !== 0) {
        throw new Error(`${label} failed with exit code ${result.status}`);
    }
}

function waitForHealth(maxRetries = 60, interval = 500) {
    return new Promise((resolve, reject) => {
        let retries = 0;

        const check = () => {
            const req = http.get(HEALTH_URL, (res) => {
                if (res.statusCode === 200) {
                    res.resume();
                    resolve();
                    return;
                }
                res.resume();
                retry();
            });

            req.on("error", retry);
            req.setTimeout(1000, () => {
                req.destroy();
                retry();
            });
        };

        const retry = () => {
            if (++retries >= maxRetries) {
                reject(new Error(`Server did not become healthy: ${HEALTH_URL}`));
                return;
            }
            setTimeout(check, interval);
        };

        check();
    });
}

function terminate(child) {
    if (!child || child.killed) return;

    if (process.platform === "win32") {
        spawnSync("taskkill", ["/pid", String(child.pid), "/f", "/t"], {
            cwd: ROOT,
            stdio: "ignore",
            shell: false,
        });
        return;
    }

    child.kill("SIGTERM");
}

async function main() {
    const electronPkg = require("electron");
    const electronBinary = electronPkg.path || electronPkg;
    const electronVersion = electronPkg.version;
    let serverProcess = null;
    let shuttingDown = false;

    try {
        acquireLock();
        // 先确保上一实例的 Node server 已退出且端口释放，再跑构建。
        // build-server → copy-runtime-deps 会删除 dist-server/node_modules，
        // 若旧 server/MCP 子进程仍持有该目录句柄会抛 ENOTEMPTY。等端口空出
        // 是「进程已死、句柄大概率已释放」的可靠信号。
        killPortProcess(SERVER_PORT);
        waitForPortFree(SERVER_PORT);

        run(process.execPath, [path.join("scripts", "stage-cli.cjs")], "Stage CLI");
        run(process.execPath, [path.join("scripts", "build-frontend.cjs")], "Build frontend");
        run(process.execPath, [path.join("scripts", "build-server.cjs")], "Build server");

        console.log("[electron-dev] Start standalone Node server");
        serverProcess = spawn(process.execPath, [path.join("scripts", "start-node.cjs")], {
            cwd: ROOT,
            stdio: "inherit",
            shell: false,
            env: process.env,
        });

        serverProcess.on("exit", (code, signal) => {
            if (shuttingDown) {
                return;
            }
            console.log(`[electron-dev] Node server exited with code ${code}, signal ${signal || "none"}`);
        });

                await waitForHealth();

        // IDE（VSCode/Trae 系）会注入 ELECTRON_RUN_AS_NODE=1，使 Electron 以纯 Node 模式运行，
        // 导致 app/BrowserWindow 等 API 为 undefined。启动真正的 Electron 前必须清除它。
        const electronEnv = { ...process.env };
        delete electronEnv.ELECTRON_RUN_AS_NODE;
        delete electronEnv.ELECTRON_FORCE_IS_PACKAGED;

        run(
            electronBinary,
            [path.join("electron", "main.cjs")],
            "Start Electron",
            {
                ...electronEnv,
                LOCAL_CLAW_USE_EXTERNAL_SERVER: "1",
                LOCAL_CLAW_EXTERNAL_SERVER_URL: SERVER_URL,
            }
        );
    } finally {
        shuttingDown = true;
        terminate(serverProcess);
    }
}

main().catch((error) => {
    console.error("[electron-dev] Error:", error.stack || error.message);
    process.exit(1);
});
