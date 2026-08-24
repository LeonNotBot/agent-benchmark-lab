const { app, BrowserWindow, Menu, ipcMain, dialog, globalShortcut, session, shell } = require("electron");
const { fork, spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const http = require("http");
const net = require("net");
const { fileURLToPath } = require("url");
const { getClaudeCliPath, getClaudeCliExecutable } = require("./cli-path.cjs");
const { getOllamaPath, getOllamaSource, getOllamaModelsDir } = require("./ollama-path.cjs");
const { getOrCreateInstanceId, reportFromMain } = require("./telemetry.cjs");

// 锁死 userData 目录名为 localcoding，与 SDK 的 ~/.localcoding 及 product 名统一。
// 必须在任何 app.getPath("userData") 调用前执行（否则 dev 态回退到 "Electron"、
// 打包态用 productName，两者不一致）。此后 Roaming/localcoding 是唯一 userData 目录。
app.setName("localcoding");

// 端口策略：动态端口 + 单实例锁（见 app.requestSingleInstanceLock）。
// PREFERRED_PORT 是首选端口（与文档、multica-agent 默认值一致，向后兼容）；
// 若被占用则由 pickFreePort 自动改用 OS 分配的空闲端口，彻底消除「10086 被占
// 就打不开」与「无差别 taskkill 误杀第三方进程」两类问题。
// PORT 在 app.whenReady 中确定后赋值，SERVER_URL/HEALTH_URL 随之派生。
const PREFERRED_PORT = Number(process.env.LOCALCLAW_PORT) || 10086;
let PORT = PREFERRED_PORT;

// 运行时 .env 加载器：生产 main.cjs 此前只 ...process.env 透传，没有任何 .env 加载，
// 故凭据（如 RAGFLOW_KEY）只能靠硬编码进源码才生效——这正是凭据泄露的根。
// 收口后改由此处把 .env 注入 process.env，再随 fork 传给 server 进程。
// 不引第三方 dotenv，复用 electron-dev.cjs 已验证的手写解析（仅在 key 未设时填充，
// 不覆盖外部已注入的环境变量——对齐企业镜像/CI 注入优先）。
function loadDotEnv() {
    // 候选位置：打包态用 userData（每安装实例的配置家目录）；开发态用仓库根。
    const candidates = [];
    try { if (app.isPackaged) candidates.push(path.join(app.getPath("userData"), ".env")); } catch {}
    candidates.push(path.join(__dirname, "..", ".env"));
    for (const envPath of candidates) {
        if (!fs.existsSync(envPath)) continue;
        try {
            const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed || trimmed.startsWith("#")) continue;
                const eqIdx = trimmed.indexOf("=");
                if (eqIdx === -1) continue;
                const key = trimmed.slice(0, eqIdx).trim();
                let val = trimmed.slice(eqIdx + 1).trim();
                // 去掉成对的首尾引号（与值内引号无关）
                if (val.length >= 2 && ((val[0] === '"' && val[val.length - 1] === '"') || (val[0] === "'" && val[val.length - 1] === "'"))) {
                    val = val.slice(1, -1);
                }
                if (key && !(key in process.env)) process.env[key] = val;
            }
        } catch { /* 加载失败不阻断启动，server 侧缺 key 会自行告警 */ }
    }
}
loadDotEnv();

const EXTERNAL_SERVER_URL = process.env.LOCAL_CLAW_EXTERNAL_SERVER_URL || "";
const USE_EXTERNAL_SERVER = process.env.LOCAL_CLAW_USE_EXTERNAL_SERVER === "1" || !!EXTERNAL_SERVER_URL;
// 自托管模式下 SERVER_URL/HEALTH_URL 依赖最终确定的 PORT，故在 whenReady 里
// resolveServerUrls() 重算；外部 server 模式 PORT 不参与，直接用 EXTERNAL_SERVER_URL。
let SERVER_URL = EXTERNAL_SERVER_URL || `http://127.0.0.1:${PORT}`;
let HEALTH_URL = `${SERVER_URL}/api/health`;
function resolveServerUrls() {
    SERVER_URL = EXTERNAL_SERVER_URL || `http://127.0.0.1:${PORT}`;
    HEALTH_URL = `${SERVER_URL}/api/health`;
}

let serverProcess = null;
let mainWindow = null;
let startupLogPath = null;
// 匿名设备 ID：首次访问时从 userData/telemetry-id.json 读取或生成，模块级缓存。
// startServer(注入 env)与 app:info IPC(dev 态不 fork server)共用同一来源。
let cachedInstanceId = null;
function instanceId() {
    if (cachedInstanceId) return cachedInstanceId;
    cachedInstanceId = getOrCreateInstanceId(app.getPath("userData"));
    return cachedInstanceId;
}

// 主进程埋点:补公共字段后 POST 到本地 server。server 侧做 release/开关双闸门。
// dev 态(external server)server 的 isRelease() 为 false 会丢弃,安全。
function reportTelemetry(type, payload) {
    reportFromMain(PORT, {
        type,
        ts: Date.now(),
        instanceId: instanceId(),
        version: app.getVersion(),
        platform: process.platform,
        payload,
    });
}

// crash stack 路径脱敏:去掉绝对路径里的用户名段,避免 PII 外泄。
function sanitizePath(s) {
    if (!s || typeof s !== "string") return undefined;
    return s
        .replace(/[A-Za-z]:\\Users\\[^\\]+/g, "C:\\Users\\<user>")
        .replace(/\/(?:home|Users)\/[^/]+/g, "/<home>/<user>");
}
// 服务进程一旦自行退出，记录退出码/信号。waitForServer 据此「进程已死」立即失败，
// 不再傻等满超时——把「真崩溃」和「慢启动」区分开。
let serverExited = null;

function getStartupLogPath() {
    if (startupLogPath) return startupLogPath;

    const fallbackDir = path.join(process.cwd(), "logs");
    try {
        const logDir = path.join(app.getPath("userData"), "logs");
        fs.mkdirSync(logDir, { recursive: true });
        startupLogPath = path.join(logDir, "startup.log");
    } catch {
        fs.mkdirSync(fallbackDir, { recursive: true });
        startupLogPath = path.join(fallbackDir, "startup.log");
    }

    return startupLogPath;
}

function formatLogValue(value) {
    if (value instanceof Error) {
        return value.stack || value.message;
    }
    if (typeof value === "string") {
        return value;
    }
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}

function writeStartupLog(level, ...values) {
    const message = values.map(formatLogValue).join(" ");
    const line = `[${new Date().toISOString()}] [${level}] ${message}\n`;
    try {
        fs.appendFileSync(getStartupLogPath(), line, "utf8");
    } catch {
        // Swallow logging errors to avoid masking startup failures.
    }
}

function logInfo(...values) {
    console.log(...values);
    writeStartupLog("INFO", ...values);
}

function logError(...values) {
    console.error(...values);
    writeStartupLog("ERROR", ...values);
}

function getPackagedServerEntry() {
    return path.join(process.resourcesPath || "", "app.asar", "dist-server", "server.cjs");
}

function getServerEntry() {
    // In packaged app, the server bundle lives inside app.asar.
    const packed = getPackagedServerEntry();
    const dev = path.join(__dirname, "..", "dist-server", "server.cjs");
    if (fs.existsSync(packed)) return packed;
    return dev;
}

function getServerCwd() {
    if (app.isPackaged) {
        const userDataDir = app.getPath("userData");
        fs.mkdirSync(userDataDir, { recursive: true });
        return userDataDir;
    }
    return path.join(__dirname, "..");
}

function resolveBundledResourceDir(name) {
    const packed = path.join(process.resourcesPath || "", name);
    if (fs.existsSync(packed)) return packed;
    return path.join(__dirname, "..", "resources", name);
}

// 兜底清理：fork 新服务前，杀掉可能残留的占用 PORT 的进程（典型为上次未及时
// 退出的旧 server）。仅 unix 用 lsof；win 用 netstat。失败/超时均静默跳过，
// 不阻塞启动——真正占用时后续 listenWithRetry 仍会重试并最终报错。
// 选一个可监听的端口：优先 preferred（默认 10086，保持向后兼容），被占用则
// 退到 OS 分配的随机空闲端口（listen 0）。取代旧的 killStaleProcessesOnPort —
// 不再无差别 taskkill 占用方（那会误杀第三方进程，且占用方杀不掉时仍打不开）。
function canListen(port) {
    return new Promise((resolve) => {
        const tester = net.createServer();
        tester.once("error", () => resolve(false));
        tester.once("listening", () => {
            tester.close(() => resolve(true));
        });
        // 与 server 的 host 保持一致（127.0.0.1），避免「回环可监听但 0.0.0.0 被占」的误判。
        tester.listen(port, "127.0.0.1");
    });
}

function getRandomFreePort() {
    return new Promise((resolve, reject) => {
        const srv = net.createServer();
        srv.once("error", reject);
        srv.listen(0, "127.0.0.1", () => {
            const { port } = srv.address();
            srv.close(() => resolve(port));
        });
    });
}

async function pickFreePort(preferred) {
    if (await canListen(preferred)) return preferred;
    logInfo(`[main] preferred port ${preferred} is busy, falling back to a random free port`);
    return getRandomFreePort();
}

function startServer() {
    const entry = getServerEntry();
    const serverCwd = getServerCwd();
    serverExited = null;

    const cliPath = getClaudeCliPath();
    const cliExec = getClaudeCliExecutable();
    const ollamaPath = getOllamaPath();
    const ollamaModelsDir = getOllamaModelsDir();
    const ollamaSource = getOllamaSource();
    const builtinSkillsDir = resolveBundledResourceDir("builtin-skills");
    const builtinTemplatesDir = resolveBundledResourceDir("builtin-templates");
    const dbPath = path.join(app.getPath("userData"), "webui.db");
    const appInstanceId = instanceId();

    logInfo(`[main] Server entry: ${entry}`);
    logInfo(`[main] Server cwd: ${serverCwd}`);
    logInfo(`[main] DB path: ${dbPath}`);

    // CLI_PATH 解析详情日志
    const cliPathEnv = process.env.CLAUDE_CLI_PATH || "(not set)";
    const cliPathPacked = process.resourcesPath ? path.join(process.resourcesPath, "claude-cli", "cli-node.js") : "(not packaged)";
    const cliPathDev = path.join(__dirname, "..", "packages", "claude-cli", "dist", "cli-node.js");
    logInfo(`[main] CLI_PATH resolution:`);
    logInfo(`  - CLAUDE_CLI_PATH env: ${cliPathEnv}`);
    logInfo(`  - Packed path: ${cliPathPacked} exists=${fs.existsSync(cliPathPacked)}`);
    logInfo(`  - Dev path: ${cliPathDev} exists=${fs.existsSync(cliPathDev)}`);
    logInfo(`  - Resolved CLI path: ${cliPath}`);
    logInfo(`[main] CLI executable: ${cliExec}`);
    logInfo(`[main] Ollama: ${ollamaPath || "not found"} (source: ${ollamaSource})`);
    logInfo(`[main] Builtin skills: ${builtinSkillsDir}`);
    logInfo(`[main] Builtin templates: ${builtinTemplatesDir}`);

    // Ensure the CLI directory is in PATH so golembot's ClaudeCodeEngine can find "claude"
    const cliDir = path.dirname(cliPath);
    const currentPath = process.env.PATH || "";
    const updatedPath = cliDir + path.delimiter + currentPath;
    logInfo(`[main] CLI directory added to PATH: ${cliDir}`);

    serverProcess = fork(entry, [], {
        cwd: serverCwd,
        stdio: ["pipe", "pipe", "pipe", "ipc"],
        env: {
            ...process.env,
            NODE_ENV: "production",
            // 动态端口：把主进程最终选定的 PORT 显式注入 server 进程，server 内所有
            // process.env.PORT ?? 10086 的消费者（main.ts listen、cron/secret registrar）
            // 据此对齐到同一端口；CLI 子进程再经 server 继承同一 PORT。
            PORT: String(PORT),
            // 打包态默认日志级别降到 error（平时安静、出错仍留痕）。
            // 仅在用户/外部未显式设置时填充——用户可在 %APPDATA%/<App>/.env 写
            // LENOVO_SDK_LOG_LEVEL=debug 覆盖它来排障（debug 会自动落盘到 logs/）。
            ...(app.isPackaged && !process.env.LENOVO_SDK_LOG_LEVEL
                ? { LENOVO_SDK_LOG_LEVEL: "error" }
                : {}),
            CLAUDE_CODE_WEBUI_USE_DIST: "1",
            CLAUDE_CLI_PATH: cliPath,
            CLAUDE_CLI_EXECUTABLE: cliExec,
            CLAUDE_RUNNER_MODE: "spawn",
            OLLAMA_EXECUTABLE: ollamaPath || "",
            OLLAMA_MODELS_DIR: ollamaModelsDir,
            OLLAMA_USER_DATA: app.getPath("userData"),
            OLLAMA_SOURCE: ollamaSource,
            DB_PATH: dbPath,
            BUILTIN_SKILLS_DIR: builtinSkillsDir,
            BUILTIN_TEMPLATES_DIR: builtinTemplatesDir,
            // Telemetry：唯一真相源 app.isPackaged 经 env 扩散到 server。
            // dev 态 APP_IS_PACKAGED="0",server isRelease() 为 false,采集/外发全关。
            APP_IS_PACKAGED: app.isPackaged ? "1" : "0",
            APP_VERSION: app.getVersion(),
            APP_PLATFORM: process.platform,
            APP_INSTANCE_ID: appInstanceId,
            // 注:上报地址不在此注入。URL 唯一真相源在 server config/telemetry-endpoint.ts
            // (默认指向阿里云,APP_TELEMETRY_URL 可覆盖)。是否真外发由 isRelease() 决定:
            // dev 态 APP_IS_PACKAGED="0" 不外发;打包态自动外发。...process.env 已透传外部覆盖。
            // Add CLI directory to PATH so golembot can find "claude" binary
            PATH: updatedPath,
        },
    });

    serverProcess.stdout.on("data", (data) => {
        const text = data.toString().trim();
        if (text) logInfo(`[server] ${text}`);
    });

    serverProcess.stderr.on("data", (data) => {
        const text = data.toString().trim();
        if (text) logError(`[server] ${text}`);
    });

    serverProcess.on("error", (err) => {
        logError("Failed to start server:", err);
    });

    serverProcess.on("exit", (code, signal) => {
        logInfo(`Server exited with code ${code}, signal ${signal || "none"}`);
        serverExited = { code, signal };
        serverProcess = null;
        // 注:server 异常退出时上报通道(server 自身)已不可用,故不在此 POST,
        // 由上面的 logInfo 落盘兜底(startup.log)。
    });
}

function waitForServer(maxRetries = 120, interval = 500) {
    return new Promise((resolve, reject) => {
        let retries = 0;
        const check = () => {
            // 进程已自行退出（崩溃/ABI不匹配/异常）——立即失败，不必等满超时。
            // 仅自托管服务才有 serverProcess；external server 模式下 serverExited 恒为 null。
            if (!USE_EXTERNAL_SERVER && serverExited) {
                reject(new Error(
                    `Server process exited before becoming healthy ` +
                    `(code ${serverExited.code}, signal ${serverExited.signal || "none"})`
                ));
                return;
            }
            const req = http.get(HEALTH_URL, (res) => {
                if (res.statusCode === 200) {
                    resolve();
                } else {
                    retry();
                }
            });
            req.on("error", () => retry());
            req.setTimeout(1000, () => {
                req.destroy();
                retry();
            });
        };
        const retry = () => {
            if (++retries >= maxRetries) {
                // 超时退出前留一条诊断：进程仍存活=慢启动（应再放宽超时），
                // 进程已退出=真崩溃（前面的 serverExited 分支通常已先行捕获）。
                const alive = !USE_EXTERNAL_SERVER && serverProcess && !serverProcess.killed;
                logError(
                    `[main] Health check timed out after ${(maxRetries * interval / 1000)}s. ` +
                    `Server process ${alive ? `still alive (pid ${serverProcess.pid}) — likely slow startup, not a crash` : "is NOT alive — likely crashed"}.`
                );
                reject(new Error("Server failed to start (health check timed out)"));
                return;
            }
            setTimeout(check, interval);
        };
        check();
    });
}

function createWindow() {
    Menu.setApplicationMenu(null);

    mainWindow = new BrowserWindow({
        width: 1280,
        height: 860,
        title: "LocalCoding",
        // macOS：隐藏标题栏但保留左上角红绿灯（关闭/最小化/最大化）
        // Windows/Linux：完全无边框，使用前端自定义窗口按钮
        ...(process.platform === "darwin"
            ? { titleBarStyle: "hiddenInset" }
            : { frame: false }),
        webPreferences: {
            preload: path.join(__dirname, "preload.cjs"),
            contextIsolation: true,
            nodeIntegration: false,
            webviewTag: true,
        },
    });

    // webview 安全：禁止 webview 内的 window.open 弹出新窗口，改为系统浏览器
    mainWindow.webContents.on("did-attach-webview", (_e, wc) => {
        wc.setWindowOpenHandler(({ url }) => {
            shell.openExternal(url).catch(() => { });
            return { action: "deny" };
        });
    });

    mainWindow.loadURL(SERVER_URL);

    // Devtools 快捷键：F12 / Ctrl+Shift+I （主窗口聚焦时生效）
    mainWindow.webContents.on("before-input-event", (event, input) => {
        if (input.type !== "keyDown") return;
        const isF12 = input.key === "F12" && !input.control && !input.alt && !input.meta && !input.shift;
        const isCtrlShiftI = input.control && input.shift && (input.key === "I" || input.key === "i");
        if (isF12 || isCtrlShiftI) {
            mainWindow.webContents.toggleDevTools();
            event.preventDefault();
        }
    });

    if (process.env.LOCAL_CLAW_OPEN_DEVTOOLS === "1") {
        mainWindow.webContents.openDevTools({ mode: "detach" });
    }

    mainWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
        logError(`[window] did-fail-load code=${errorCode} url=${validatedURL} desc=${errorDescription}`);
    });

    mainWindow.webContents.on("render-process-gone", (_event, details) => {
        logError("[window] render-process-gone", details);
        reportTelemetry("crash", {
            name: "render_process_gone",
            reason: details?.reason,
            exitCode: details?.exitCode,
        });
    });

    mainWindow.on("closed", () => {
        mainWindow = null;
    });
}

function killServer(timeoutMs = 6000) {
    return new Promise((resolve) => {
        const proc = serverProcess;
        if (!proc || proc.killed) {
            serverProcess = null;
            resolve();
            return;
        }

        let settled = false;
        const done = () => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            serverProcess = null;
            resolve();
        };

        // 等待服务进程真正退出，而非发出 SIGTERM 后立即认为已关闭。
        // 否则旧进程仍占着 10086 端口，新实例启动必撞 EADDRINUSE。
        proc.once("exit", done);

        // 超时仍未退出 → 强杀，避免父进程退出流程被卡死。
        const timer = setTimeout(() => {
            if (!proc.killed) {
                if (process.platform === "win32") {
                    spawn("taskkill", ["/pid", String(proc.pid), "/f", "/t"]);
                } else {
                    try { proc.kill("SIGKILL"); } catch { /* already gone */ }
                }
            }
            done();
        }, timeoutMs);

        if (process.platform === "win32") {
            spawn("taskkill", ["/pid", String(proc.pid), "/f", "/t"]);
        } else {
            try { proc.kill("SIGTERM"); } catch { done(); }
        }
    });
}

// 单实例锁：保证同一时刻只有一个 LocalCoding 实例在跑。第二次启动（再次双击图标）
// 会拿不到锁 → 直接退出，并把已有窗口唤到前台。这从根上消除「自己起多份、多个 server
// 抢同一端口」的冲突；配合动态端口，端口问题不再会让用户打不开应用。
// 外部 server 模式（连远端 server，不在本机 fork）无需互斥，故跳过。
let isSecondaryInstance = false;
if (!USE_EXTERNAL_SERVER && !app.requestSingleInstanceLock()) {
    isSecondaryInstance = true;
    app.quit();
} else {
    app.on("second-instance", () => {
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.focus();
        }
    });
}

app.whenReady().then(async () => {
    // 第二实例已在上面 app.quit()，但 whenReady 仍可能先行触发；此处守住，
    // 绝不让它 fork server / 抢端口 / 建窗口。
    if (isSecondaryInstance) return;
    const startupT0 = Date.now();
    logInfo(`[main] Startup log: ${getStartupLogPath()}`);

    // Window control IPC handlers
    ipcMain.on("window:minimize", () => mainWindow?.minimize());
    ipcMain.on("window:maximize", () => {
        if (mainWindow?.isMaximized()) mainWindow.unmaximize();
        else mainWindow?.maximize();
    });
    ipcMain.on("window:close", () => mainWindow?.close());
    ipcMain.handle("window:isMaximized", () => mainWindow?.isMaximized() ?? false);
    // 应用环境信息：前端首选经此拿到(无网络往返)。release 判别、匿名设备 ID、
    // 版本、平台。telemetryEnabled 由前端再走 /api/app-info 取(开关存 server 侧 settings)。
    ipcMain.handle("app:info", () => ({
        release: app.isPackaged,
        version: app.getVersion(),
        platform: process.platform,
        instanceId: instanceId(),
    }));
    ipcMain.handle("dialog:openFolder", async () => {
        const result = await dialog.showOpenDialog(mainWindow, {
            properties: ["openDirectory"],
        });
        if (result.canceled || !result.filePaths.length) return null;
        return result.filePaths[0];
    });

    // 内嵌浏览器（webview）：清除 cookie / 缓存。partition 固定为 "persist:webview"
    ipcMain.handle("browser:clearCookies", async () => {
        try {
            await session.fromPartition("persist:webview").clearStorageData({ storages: ["cookies"] });
            return true;
        } catch (err) { logError("[browser] clearCookies", err); return false; }
    });
    ipcMain.handle("browser:clearCache", async () => {
        try {
            await session.fromPartition("persist:webview").clearCache();
            return true;
        } catch (err) { logError("[browser] clearCache", err); return false; }
    });
    // 用系统默认浏览器/应用打开外链。file:// 走 openPath（openExternal 在 Windows 上对 file 协议常静默失败）
    ipcMain.handle("browser:openExternal", async (_e, url) => {
        const target = String(url);
        try {
            if (/^file:\/\//i.test(target)) {
                const filePath = fileURLToPath(target);
                const err = await shell.openPath(filePath);
                if (err) { logError("[browser] openPath", err); return false; }
                return true;
            }
            await shell.openExternal(target);
            return true;
        }
        catch (err) { logError("[browser] openExternal", err); return false; }
    });

    if (USE_EXTERNAL_SERVER) {
        logInfo(`[main] Using external server: ${SERVER_URL}`);
    } else {
        // 动态端口：优先用 PREFERRED_PORT（10086），被占用则退到 OS 分配的空闲端口。
        // 配合单实例锁后，正常不会出现自家进程抢端口；这里覆盖「第三方占用 10086」的场景，
        // 既不打不开、也不误杀对方进程。确定端口后重算 SERVER_URL/HEALTH_URL 再启动。
        PORT = await pickFreePort(PREFERRED_PORT);
        resolveServerUrls();
        logInfo(`[main] Server port: ${PORT} (preferred ${PREFERRED_PORT})`);
        startServer();
    }
    try {
        await waitForServer();
    } catch (err) {
        logError("Server failed to become healthy:", err);
        dialog.showErrorBox("Local Claw 启动失败", `服务进程未能成功启动。\n请查看日志：${getStartupLogPath()}`);
        app.quit();
        return;
    }
    const serverReadyMs = Date.now() - startupT0;
    createWindow();
    // 启动耗时 perf:server 就绪段 + 首窗加载完成段。窗口 did-finish-load 时上报。
    mainWindow?.webContents.once("did-finish-load", () => {
        reportTelemetry("perf", {
            name: "app_startup",
            serverReadyMs,
            totalMs: Date.now() - startupT0,
            externalServer: USE_EXTERNAL_SERVER,
        });
    });

    app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

// 标记是否已完成服务清理：避免 before-quit 与 window-all-closed 重复触发，
// 也用于在清理完成后放行真正的退出。
let cleanupDone = false;

app.on("window-all-closed", () => {
    // 实际退出交给 before-quit 统一处理（会等待服务进程退出后再放行）。
    app.quit();
});

app.on("before-quit", (event) => {
    if (cleanupDone) return;
    // 阻止立即退出，先等服务进程优雅关闭、端口释放，再真正退出。
    event.preventDefault();
    killServer().then(() => {
        cleanupDone = true;
        app.quit();
    });
});

process.on("uncaughtException", (err) => {
    logError("[main] uncaughtException", err);
    reportTelemetry("crash", {
        name: "main_uncaught_exception",
        message: sanitizePath(err && err.message),
        stack: sanitizePath(err && err.stack),
    });
});

process.on("unhandledRejection", (reason) => {
    logError("[main] unhandledRejection", reason);
    reportTelemetry("crash", {
        name: "main_unhandled_rejection",
        message: sanitizePath(reason && (reason.message || String(reason))),
        stack: sanitizePath(reason && reason.stack),
    });
});
