const path = require("path");
const fs = require("fs");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const version = packageJson.version || "0.1.0";

function findISCC() {
  const localAppData = process.env.LOCALAPPDATA || "";
  const candidates = [
    "C:\\Program Files (x86)\\Inno Setup 6\\ISCC.exe",
    "C:\\Program Files\\Inno Setup 6\\ISCC.exe",
    "C:\\Program Files (x86)\\Inno Setup 5\\ISCC.exe",
    // winget 的 user-scope 安装(JRSoftware.InnoSetup)会落到 LOCALAPPDATA,
    // 且只在 HKCU 写卸载项,下面的 HKLM 注册表查询命中不到,必须显式列出。
    localAppData && path.join(localAppData, "Programs", "Inno Setup 6", "ISCC.exe"),
    "ISCC.exe",
  ].filter(Boolean);
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }

  // Query Uninstall registry via PowerShell to find Inno Setup install location.
  // HKCU 分支覆盖 winget user-scope 安装,HKLM 覆盖机器级安装。
  try {
    const psScript = 'Get-ItemProperty "HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*", "HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*", "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*" -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -like "*Inno Setup*" } | Select-Object -ExpandProperty InstallLocation';
    const ps = spawnSync("powershell", ["-NoProfile", "-Command", psScript], {
      encoding: "utf8", stdio: "pipe", timeout: 15000,
    });
    if (ps.status === 0 && ps.stdout) {
      const loc = ps.stdout.trim();
      if (loc) {
        const isccPath = path.join(loc, "ISCC.exe");
        if (fs.existsSync(isccPath)) return isccPath;
      }
    }
  } catch (_) { /* ignore registry errors */ }

  return null;
}

function main() {
  const iscc = process.env.ISCC_PATH || findISCC();
  if (!iscc) {
    console.warn("[inno-build] ISCC.exe not found, skipping Inno Setup packaging.");
    console.warn("[inno-build] Install Inno Setup for Windows installer: https://jrsoftware.org/isinfo.php");
    process.exit(0);
  }

  const issPath = path.join(ROOT, "scripts", "installer.iss");
  if (!fs.existsSync(issPath)) {
    console.warn(`[inno-build] Installer script not found, skipping: ${issPath}`);
    process.exit(0);
  }

  const unpackedDir = path.join(ROOT, "release", "win-unpacked");
  if (!fs.existsSync(unpackedDir)) {
    console.warn(`[inno-build] win-unpacked not found, skipping: ${unpackedDir}`);
    process.exit(0);
  }

  const args = [issPath, `/DMyAppVersion=${version}`];
  console.log(`[inno-build] Running: "${iscc}" ${args.join(" ")}`);
  console.log(`[inno-build] Version: ${version}`);

  const result = spawnSync(iscc, args, {
    cwd: ROOT,
    stdio: "inherit",
    encoding: "utf8",
  });

  if (result.error) {
    console.error("[inno-build] Failed to run ISCC:", result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`[inno-build] ISCC exited with code ${result.status}`);
    process.exit(1);
  }

  console.log("[inno-build] Inno Setup installer created successfully.");
}

main();
