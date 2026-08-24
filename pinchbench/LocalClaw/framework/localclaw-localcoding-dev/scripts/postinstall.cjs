const path = require("path");
const fs = require("fs");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const BETTER_SQLITE3_DIR = path.join(ROOT, "node_modules", "better-sqlite3");
const PREBUILD_INSTALL_BIN = path.join(ROOT, "node_modules", "prebuild-install", "bin.js");

function hasBinary() {
  const buildDir = path.join(BETTER_SQLITE3_DIR, "build", "Release");
  if (!fs.existsSync(buildDir)) return false;
  try {
    const files = fs.readdirSync(buildDir);
    return files.some((f) => f.endsWith(".node"));
  } catch {
    return false;
  }
}

function runPrebuildInstall(nodePath) {
  let binPath = PREBUILD_INSTALL_BIN;
  let useNpx = false;
  if (!fs.existsSync(binPath)) {
    binPath = "prebuild-install";
    useNpx = true;
  }
  const cmd = useNpx ? "npx" : nodePath;
  const args = useNpx ? ["--yes", binPath] : [binPath];
  const result = spawnSync(cmd, args, {
    cwd: BETTER_SQLITE3_DIR,
    stdio: "inherit",
    shell: useNpx,
    env: process.env,
  });
  return result.status === 0;
}

function findNvmNodes() {
  const nvmDir = process.env.NVM_HOME || process.env.NVM_DIR;
  if (!nvmDir) return [];
  try {
    return fs.readdirSync(nvmDir)
      .filter((d) => /^v?\d+/.test(d))
      .map((d) => path.join(nvmDir, d, "node.exe"))
      .filter((p) => fs.existsSync(p));
  } catch {
    return [];
  }
}

function main() {
  if (!fs.existsSync(BETTER_SQLITE3_DIR)) return;
  if (hasBinary()) {
    console.log("[postinstall] better-sqlite3 native binary already present");
    return;
  }

  console.log("[postinstall] better-sqlite3 native binary missing, running prebuild-install...");

  if (runPrebuildInstall(process.execPath)) {
    console.log("[postinstall] better-sqlite3 prebuild-install succeeded");
    return;
  }

  for (const nodePath of findNvmNodes()) {
    if (nodePath === process.execPath) continue;
    if (runPrebuildInstall(nodePath)) {
      console.log(`[postinstall] better-sqlite3 prebuild-install succeeded with ${nodePath}`);
      return;
    }
  }

  console.warn(
    "[postinstall] WARNING: Could not install better-sqlite3 native binary.\n" +
    "[postinstall] The server will attempt auto-recovery at startup."
  );
}

main();
