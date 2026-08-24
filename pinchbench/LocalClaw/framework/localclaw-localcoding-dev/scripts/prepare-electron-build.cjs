const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const productName = packageJson.build?.productName || packageJson.name || "app";
const outputDirName = packageJson.build?.directories?.output || "release";
const outputDir = path.join(ROOT, outputDirName);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stopRunningPackagedApp() {
  if (process.platform === "win32") {
    try {
      execFileSync("taskkill", ["/IM", `${productName}.exe`, "/F", "/T"], {
        stdio: "ignore",
      });
      console.log(`[prepare-electron-build] Stopped running ${productName}.exe`);
    } catch {
      console.log(`[prepare-electron-build] No running ${productName}.exe process found`);
    }
    return;
  }

  if (process.platform === "darwin") {
    try {
      execFileSync("pkill", ["-x", productName], { stdio: "ignore" });
      console.log(`[prepare-electron-build] Stopped running ${productName}`);
    } catch {
      console.log(`[prepare-electron-build] No running ${productName} process found`);
    }
  }
}

async function removePathWithRetry(targetPath, label) {
  if (!fs.existsSync(targetPath)) {
    console.log(`[prepare-electron-build] ${label} not found, skip cleanup: ${targetPath}`);
    return true;
  }

  let lastError = null;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      fs.rmSync(targetPath, { recursive: true, force: true, maxRetries: 0 });
      console.log(`[prepare-electron-build] Cleaned ${label}: ${targetPath}`);
      return true;
    } catch (error) {
      lastError = error;
      console.warn(
        `[prepare-electron-build] Cleanup attempt ${attempt}/5 failed: ${error.message}`
      );
      await sleep(1000 * attempt);
    }
  }

  return lastError;
}

function getFallbackOutputDir() {
  return path.join(ROOT, `${outputDirName}-build-${Date.now()}`);
}

async function ensureOutputDirectoryReady(options = {}) {
  const { allowFallback = false } = options;

  const cleanupResult = await removePathWithRetry(outputDir, "output directory");
  if (cleanupResult === true) {
    return { outputDir, usedFallback: false };
  }

  const details = `${cleanupResult.name}: ${cleanupResult.message}`;
  if (!allowFallback) {
    throw new Error(
      `Failed to clean build output "${outputDir}". ` +
      `A running process is likely still locking files such as app.asar. Details: ${details}`
    );
  }

  const fallbackOutputDir = getFallbackOutputDir();
  await removePathWithRetry(fallbackOutputDir, "fallback output directory");
  console.warn(
    `[prepare-electron-build] Output directory is locked, falling back to: ${fallbackOutputDir}`
  );
  return { outputDir: fallbackOutputDir, usedFallback: true, cleanupError: cleanupResult };
}

async function main() {
  stopRunningPackagedApp();
  await sleep(1500);
  const result = await ensureOutputDirectoryReady();
  console.log(`[prepare-electron-build] Ready output directory: ${result.outputDir}`);
}

module.exports = {
  ROOT,
  outputDir,
  stopRunningPackagedApp,
  ensureOutputDirectoryReady,
  getFallbackOutputDir,
};

if (require.main === module) {
  main().catch((error) => {
    console.error("[prepare-electron-build] Error:", error.stack || error.message);
    process.exit(1);
  });
}
