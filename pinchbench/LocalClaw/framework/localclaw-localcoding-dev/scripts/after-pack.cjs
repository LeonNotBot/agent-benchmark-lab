// after-pack.cjs — electron-builder afterPack 钩子（③「包内正确性」承重墙）。
//
// 每个目标平台 pack 完后回调。按【当前打包目标平台】校验包内 ripgrep：
//   - 文件存在
//   - SHA256 匹配 resources/ripgrep-vendor/manifest.json
//   - 执行位 0755（仅 unix 构建机校验——NTFS 无 exec bit，Windows 主机上 mode 断言无意义）
// 任一不满足 → throw（构建直接失败）。这是防「无声丢平台」复发的结构性保障。
//
// 只校验当前目标平台那一条（②管全集 / ③管单目标，职责分层），不跨平台断言，
// 避免 Windows 打包时误断言 darwin 而 fail。

const fs = require("fs");
const path = require("path");
const { createHash } = require("crypto");

// electron platform name → CLI 侧 <arch>-<platform> 目录名 + 二进制名
function resolvePlatformDir(electronPlatformName, arch) {
  // electron-builder Arch 枚举: ia32=0, x64=1, armv7l=2, arm64=3, universal=4
  const archName = arch === 3 ? "arm64" : arch === 1 ? "x64" : null;
  if (archName === null) {
    // localcoding target 仅 x64/arm64；其它（ia32/armv7l/universal）暂不支持，显式报错而非静默误判
    throw new Error(`[after-pack] 不支持的 arch 枚举值: ${arch}（仅支持 x64=1 / arm64=3）`);
  }
  if (electronPlatformName === "win32") return { dir: `${archName}-win32`, bin: "rg.exe", isWin: true };
  if (electronPlatformName === "darwin") return { dir: `${archName}-darwin`, bin: "rg", isWin: false };
  if (electronPlatformName === "linux") return { dir: `${archName}-linux`, bin: "rg", isWin: false };
  return null;
}

// 在 appOutDir 下定位打包后的 claude-cli/vendor/ripgrep 根
// win/linux: <appOutDir>/resources/claude-cli/...
// darwin:    <appOutDir>/<Product>.app/Contents/Resources/claude-cli/...
function findPackagedRgRoot(appOutDir, electronPlatformName) {
  if (electronPlatformName === "darwin") {
    const entries = fs.readdirSync(appOutDir, { withFileTypes: true });
    const appDir = entries.find((e) => e.isDirectory() && e.name.endsWith(".app"));
    if (!appDir) return null;
    return path.join(appOutDir, appDir.name, "Contents", "Resources", "claude-cli", "vendor", "ripgrep");
  }
  return path.join(appOutDir, "resources", "claude-cli", "vendor", "ripgrep");
}

function sha256(file) {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

exports.default = async function afterPack(context) {
  const { appOutDir, electronPlatformName, arch } = context;
  const projectRoot = path.resolve(__dirname, "..");
  const manifestPath = path.join(projectRoot, "resources", "ripgrep-vendor", "manifest.json");

  if (!fs.existsSync(manifestPath)) {
    throw new Error(`[after-pack] 缺 manifest: ${manifestPath}（先跑 fetch-ripgrep）`);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

  const target = resolvePlatformDir(electronPlatformName, arch);
  if (!target) {
    console.log(`[after-pack] 跳过未知平台 ${electronPlatformName}`);
    return;
  }

  const expected = manifest.binaries[target.dir];
  if (!expected) {
    throw new Error(`[after-pack] manifest 缺平台 ${target.dir}，无法校验`);
  }

  const rgRoot = findPackagedRgRoot(appOutDir, electronPlatformName);
  if (!rgRoot) throw new Error(`[after-pack] 找不到打包后的 ripgrep 根 (${electronPlatformName} @ ${appOutDir})`);

  const rgBin = path.join(rgRoot, target.dir, target.bin);

  // 1) 存在
  if (!fs.existsSync(rgBin)) {
    throw new Error(`[after-pack] 包内缺 ripgrep: ${rgBin}（无声丢平台！）`);
  }
  // 2) hash
  const got = sha256(rgBin);
  if (got !== expected.sha256) {
    throw new Error(`[after-pack] ${target.dir} hash 不符: 期望 ${expected.sha256.slice(0, 12)}… 实得 ${got.slice(0, 12)}…`);
  }
  // 3) exec bit —— 仅 unix 构建机校验（Windows 主机 NTFS 无 exec bit，恒假/无意义）
  if (!target.isWin && process.platform !== "win32") {
    const mode = fs.statSync(rgBin).mode;
    if ((mode & 0o111) === 0) {
      throw new Error(`[after-pack] ${target.dir}/${target.bin} 缺执行位 (mode ${(mode & 0o777).toString(8)})，mac/Linux 上无法执行`);
    }
  }

  console.log(`[after-pack] ✅ ${electronPlatformName}/${target.dir}: ripgrep 存在 + hash 匹配${target.isWin || process.platform === "win32" ? "" : " + 0755"}`);

  // --- ripgrep 平台瘦身：校验通过后，删非当前打包平台目录（省 ~19MB）---
  // injectRipgrep 故意注入全 5 平台（多平台通用 dist），但单平台安装包只需当前平台。
  // 必须放在上方 hash 校验【之后】，避免裁掉后校验失败。
  pruneRipgrepPlatforms(rgRoot, target.dir);

  // --- Windows PortableGit（git-bash 强依赖）断言：仅 win32 目标校验 ---
  if (electronPlatformName === "win32") {
    assertPackagedGitBash(appOutDir, arch, projectRoot);
  }

  // --- locales 瘦身：只保留中/英，省 ~40MB（win/linux）---
  pruneLocales(appOutDir, electronPlatformName);
};

/**
 * 校验包内最小 bash 集的 usr/bin/bash.exe 存在且 hash 匹配 manifest。
 * 仅 win32 目标调用（mac/Linux 自带 bash，不打包）。不分架构：x64/arm64 包共用同一份
 * minimal-bash（arm64 靠 WOW64 模拟）。任一不满足 → throw。
 */
function assertPackagedGitBash(appOutDir, _arch, projectRoot) {
  const manifestPath = path.join(projectRoot, "resources", "portablegit-vendor", "manifest.json");
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`[after-pack] 缺 manifest: ${manifestPath}（先跑 fetch-portablegit）`);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const dir = manifest.dir || "minimal-bash";
  const bashRel = manifest.bashRelPath || "usr/bin/bash.exe";

  // win 包布局：<appOutDir>/resources/claude-cli/vendor/portablegit/minimal-bash/usr/bin/bash.exe
  const bash = path.join(appOutDir, "resources", "claude-cli", "vendor", "portablegit", dir, bashRel);
  if (!fs.existsSync(bash)) {
    throw new Error(`[after-pack] 包内缺最小 bash 集: ${bash}（git-bash 强依赖丢失！）`);
  }
  const got = sha256(bash);
  if (got !== manifest.sha256) {
    throw new Error(`[after-pack] bash.exe hash 不符: 期望 ${String(manifest.sha256).slice(0, 12)}… 实得 ${got.slice(0, 12)}…`);
  }
  console.log(`[after-pack] ✅ win32: 最小 bash 集 bash.exe 存在 + hash 匹配`);
}

// ── locales 瘦身 ──
// Chromium 默认随包附带 55 个 .pak 语言包（~42MB）。本应用 UI 仅中/英，
// 只保留 en-US（Chromium 缺失语言时的回退基准，删不得）+ zh-CN。其余全删，
// 解压体积省 ~40MB。每平台 pack 后调用：
//   win/linux: <appOutDir>/locales/*.pak
//   darwin:    <Product>.app/Contents/Frameworks/Electron Framework.framework/
//              Versions/A/Resources/*.lproj —— 由 electronLanguages 配置处理，这里只管 *.pak
const KEEP_LOCALES = new Set(["en-US.pak", "zh-CN.pak"]);

function pruneLocales(appOutDir, electronPlatformName) {
  // mac 的 .pak 在 Framework 内，路径深且由 electronLanguages 管控；这里专治 win/linux
  const localesDir =
    electronPlatformName === "darwin" ? null : path.join(appOutDir, "locales");
  if (!localesDir || !fs.existsSync(localesDir)) {
    return;
  }
  let removed = 0;
  let freed = 0;
  for (const name of fs.readdirSync(localesDir)) {
    if (!name.endsWith(".pak") || KEEP_LOCALES.has(name)) continue;
    const p = path.join(localesDir, name);
    try {
      freed += fs.statSync(p).size;
      fs.rmSync(p);
      removed++;
    } catch (e) {
      console.warn(`[after-pack] 删除 locale 失败 ${name}: ${e.message}`);
    }
  }
  console.log(
    `[after-pack] ✅ locales 瘦身: 删 ${removed} 个 .pak，省 ${(freed / 1024 / 1024).toFixed(1)}MB，保留 ${[...KEEP_LOCALES].join("/")}`,
  );
}

// ── ripgrep 平台瘦身 ──
// copy-cli 的 injectRipgrep 注入全 5 平台二进制（x64/arm64 × win32/darwin/linux 的子集），
// 供多平台通用 dist 使用。单平台安装包只需当前平台那份，其余 4 个删掉省 ~19MB。
// keepDir 为当前平台目录名（如 x64-win32），由 resolvePlatformDir 得出。
function pruneRipgrepPlatforms(rgRoot, keepDir) {
  if (!rgRoot || !fs.existsSync(rgRoot)) {
    return;
  }
  let removed = 0;
  let freed = 0;
  for (const name of fs.readdirSync(rgRoot)) {
    if (name === keepDir) continue;
    const p = path.join(rgRoot, name);
    let st;
    try {
      st = fs.statSync(p);
    } catch {
      continue;
    }
    if (!st.isDirectory()) continue;
    try {
      freed += dirSize(p);
      fs.rmSync(p, { recursive: true, force: true });
      removed++;
    } catch (e) {
      console.warn(`[after-pack] 删除 ripgrep 平台失败 ${name}: ${e.message}`);
    }
  }
  console.log(
    `[after-pack] ✅ ripgrep 瘦身: 删 ${removed} 个非当前平台目录，省 ${(freed / 1024 / 1024).toFixed(1)}MB，保留 ${keepDir}`,
  );
}

// 递归累加目录字节数（仅供瘦身日志统计）。
function dirSize(dir) {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    try {
      if (entry.isDirectory()) total += dirSize(p);
      else total += fs.statSync(p).size;
    } catch {
      /* ignore */
    }
  }
  return total;
}

// 导出供测试单独验证（不耦合 ripgrep 断言）。
exports.assertPackagedGitBash = assertPackagedGitBash;
exports.pruneLocales = pruneLocales;
exports.pruneRipgrepPlatforms = pruneRipgrepPlatforms;
