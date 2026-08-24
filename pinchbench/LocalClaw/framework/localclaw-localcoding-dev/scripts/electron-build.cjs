const path = require("path");
const { spawnSync } = require("child_process");
const fs = require("fs");
const {
  ROOT,
  ensureOutputDirectoryReady
} = require("./prepare-electron-build.cjs");

const electronBuilderCli = path.join("node_modules", "electron-builder", "cli.js");

function run(command, args) {
  const display = [command, ...args].join(" ");
  console.log(`[electron-build] ${display}`);
  const result = spawnSync(command, args, {
    cwd: ROOT,
    stdio: "inherit",
    shell: false,
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`Command failed with exit code ${result.status}: ${display}`);
  }
}

function removeDirSync(dirPath) {
  if (!fs.existsSync(dirPath)) return;

  const tryRemove = (target) => {
    try {
      fs.rmSync(target, { recursive: true, force: true });
      return true;
    } catch {
      return false;
    }
  };

  // Fast path: normal deletion
  if (tryRemove(dirPath)) {
    console.log(`[electron-build] Removed: ${dirPath}`);
    return;
  }

  // Windows workaround: rename the locked directory, then delete the renamed copy.
  // On Windows, MoveFileEx can rename files even when they are locked by a running
  // process, but DeleteFile cannot. This is the standard workaround for native
  // .node modules held open by dlopen / LoadLibrary.
  const tmpDir = dirPath + '_old_' + Date.now();
  try {
    fs.renameSync(dirPath, tmpDir);
    console.log(`[electron-build] Renamed locked dir: ${path.basename(tmpDir)}`);
    if (tryRemove(tmpDir)) {
      console.log(`[electron-build] Removed: ${dirPath}`);
    } else {
      console.warn(
        `[electron-build] Could not delete ${path.basename(tmpDir)} (will be cleaned on next build)`
      );
    }
  } catch (renameErr) {
    // Both deletion and rename failed — likely a still-running process
    console.error(
      `[electron-build] Cannot remove ${dirPath}: file is locked by another process.\n` +
      `[electron-build] A likely cause is a running dev server holding better_sqlite3.node.\n` +
      `[electron-build] Close any "npm run start:node" / "electron:dev" sessions and retry.`
    );
    throw renameErr;
  }
}

async function main() {
  const targets = process.argv.slice(2);
  if (!targets.length) {
    throw new Error("Missing build target. Example: node scripts/electron-build.cjs --win");
  }

  const { outputDir, usedFallback } = await ensureOutputDirectoryReady({ allowFallback: true });
  const outputArg = `--config.directories.output=${path.basename(outputDir)}`;

  run(process.execPath, [path.join("scripts", "stage-cli.cjs")]);
  run(process.execPath, [path.join("scripts", "build-frontend.cjs")]);
  
  removeDirSync(path.join(ROOT, "node_modules", "better-sqlite3", "build"));

  // Use electron-rebuild directly with --only to avoid rebuilding optional native
  // deps (e.g. cpu-features) that require Visual Studio and are not needed at runtime.
  const electronVersion = require("../node_modules/electron/package.json").version;
  const electronRebuildCli = path.join(
    "node_modules", "@electron", "rebuild", "lib", "cli.js"
  );
  run(process.execPath, [
    electronRebuildCli,
    "--version", electronVersion,
    "--only", "better-sqlite3",
  ]);
  run(process.execPath, [path.join("scripts", "build-server.cjs")]);
  run(process.execPath, [electronBuilderCli, ...targets, outputArg]);

  if (targets.some((t) => t === "--win" || t === "-w" || t === "--win,linux" || t === "--win,mac")) {
    // Run ISCC to generate setup.exe (code signing disabled)
    run(process.execPath, [path.join("scripts", "build-inno.cjs")]);
  }

  console.log(`[electron-build] Build completed: ${outputDir}`);
  if (usedFallback) {
    console.warn(
      `[electron-build] The default release directory was locked, so artifacts were written to: ${outputDir}`
    );
  }
}

main().catch((error) => {
  console.error("[electron-build] Error:", error.stack || error.message);
  process.exit(1);
});