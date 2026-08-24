const { spawnSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const ROOT = path.resolve(__dirname, "..");

function getSignToolPath() {
    return process.env.SIGN_TOOL_PATH || "C:\\GitLab-Runner\\sign.exe";
}

function signDirectory(dir) {
    const signExe = getSignToolPath();
    if (!fs.existsSync(signExe)) {
        console.warn(`[sign] sign.exe not found at ${signExe}, skipping.`);
        return;
    }

    const psCmd = `& "${signExe}" -dir "${dir.replace(/\\+$/, '')}"`;
    console.log(`[sign] Executing: ${psCmd}`);

    const result = spawnSync("powershell", ["-Command", psCmd], {
        cwd: ROOT,
        stdio: "inherit",
        shell: true,
    });

    if (result.status !== 0) {
        throw new Error(`[sign] Failed with exit code ${result.status}`);
    }
}

function signFile(filePath) {
    const signExe = getSignToolPath();
    if (!fs.existsSync(signExe)) {
        console.warn(`[sign] sign.exe not found at ${signExe}, skipping.`);
        return;
    }

    const psCmd = `& "${signExe}" "${filePath}"`;
    console.log(`[sign] Executing: ${psCmd}`);

    const result = spawnSync("powershell", ["-Command", psCmd], {
        cwd: ROOT,
        stdio: "inherit",
        shell: true,
    });

    if (result.status !== 0) {
        throw new Error(`[sign] Failed with exit code ${result.status}`);
    }
}

module.exports = { signDirectory, signFile, getSignToolPath };