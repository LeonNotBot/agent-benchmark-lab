const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { patchGolembotFeatures } = require("./patch-golembot.cjs");

const ROOT = path.join(__dirname, "..");
const SERVER_DIR = path.join(ROOT, "packages", "server");
const DEST = path.join(ROOT, "dist-server", "node_modules");
// 增量缓存戳：记录上次成功拷贝时的输入 hash。放在 DEST 外层，避免被 rmrf 连带删掉。
const STAMP_FILE = path.join(ROOT, "dist-server", ".runtime-deps.hash");
// 参与 hash 的输入文件：依赖清单（lockfile）+ 会影响拷贝结果的脚本本身。
// 其中任一变化都视为缓存失效，需重新全量拷贝。
const CACHE_INPUTS = [
  path.join(ROOT, "pnpm-lock.yaml"),
  __filename,
  path.join(__dirname, "patch-golembot.cjs"),
];

const SEARCH_BASES = [
  path.join(SERVER_DIR, "node_modules"),
  path.join(ROOT, "node_modules"),
  path.join(ROOT, "packages", "sdk", "node_modules"),
];

const REQUIRED = [
  "golembot",
  "commander",
  "js-yaml",
  // 文件监听能力（workspace-watcher）的运行期依赖：构建标为 external（chokidar 5
  // 纯 ESM + 可能带 native fsevents），故须在此显式复制到 dist-server/node_modules，
  // 否则打包后 server 启动即报 Cannot find module 'chokidar'。它是 sdk 的直接依赖，
  // 而 sdk 被打进 bundle 不在 REQUIRED 根集，递归扫不到，必须单列。
  "chokidar",
  // MCP servers (channel/cron/knowledge) need these at runtime in production
  "@modelcontextprotocol/sdk",
  "qrcode",
  // 飞书语音识别：IM 语音是 opus(ogg)，飞书 ASR 只接受 pcm，故运行时需用纯 WASM
  // 解码器把 opus 解成 PCM 再转写。golembot feishu.js 补丁通过动态 import 加载它，
  // 不在 bundle 依赖图中，必须显式复制到 dist-server/node_modules（含其子依赖）。
  "ogg-opus-decoder",
];

// @lenovo/claude-cli 不在 REQUIRED：electron 打包态运行时由 runner-spawn 优先命中
// extraResources 的 resources/claude-cli/cli-node.js（resolveCliPath 优先级 2），
// require.resolve("@lenovo/claude-cli") 兜底分支（优先级 3）在打包态永不执行。
// 若拷进 dist-server/node_modules 则是 74M 纯死代码（含全平台 vendor）。
// 纯库式 SDK 分发（非 electron）场景仍可通过 npm 依赖解析到该包，不依赖此副本。

const OPTIONAL = [
  "@larksuiteoapi/node-sdk",
  "@slack/bolt",
  "dingtalk-stream",
  "grammy",
];

const SKIP_DEPS = new Set([
  "sharp",
  "esbuild",
  "typescript",
  "@types/node",
]);

function resolvePkgDir(pkg, fromDir) {
  let dir = fromDir;
  while (true) {
    const candidate = path.join(dir, "node_modules", pkg);
    if (fs.existsSync(path.join(candidate, "package.json"))) {
      return fs.realpathSync(candidate);
    }
    // 检查 pnpm 的 .pnpm 目录结构
    const pnpmBase = path.join(dir, "node_modules", ".pnpm");
    if (fs.existsSync(pnpmBase)) {
      try {
        const entries = fs.readdirSync(pnpmBase, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory() && entry.name.startsWith(`${pkg}@`)) {
            const candidate = path.join(pnpmBase, entry.name, "node_modules", pkg);
            if (fs.existsSync(path.join(candidate, "package.json"))) {
              return fs.realpathSync(candidate);
            }
          }
        }
      } catch {
        // ignore
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  for (const base of SEARCH_BASES) {
    const candidate = path.join(base, pkg);
    if (fs.existsSync(path.join(candidate, "package.json"))) {
      return fs.realpathSync(candidate);
    }
    // 检查 pnpm 的 .pnpm 目录
    const pnpmBase = path.join(base, ".pnpm");
    if (fs.existsSync(pnpmBase)) {
      try {
        const entries = fs.readdirSync(pnpmBase, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory() && entry.name.startsWith(`${pkg}@`)) {
            const candidate = path.join(pnpmBase, entry.name, "node_modules", pkg);
            if (fs.existsSync(path.join(candidate, "package.json"))) {
              return fs.realpathSync(candidate);
            }
          }
        }
      } catch {
        // ignore
      }
    }
  }
  return null;
}

function readJSON(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function rmrf(p) {
  if (!fs.existsSync(p)) return;
  // Windows 下递归删除大目录易因句柄占用/删除竞态抛 ENOTEMPTY：electron-dev 用
  // taskkill /t 结束上一实例后，被杀进程树（server + 直接 require dist-server/
  // node_modules 的 MCP 子进程）不会同步释放文件句柄，taskkill 立即返回。
  // fs.rmSync 内建的 maxRetries/retryDelay（约 1s）不够，故外层再套一层更长的
  // 手动退避重试；仍失败则回退为「就地覆盖」——copyDir 用 mkdirSync recursive +
  // copyFileSync 覆盖，残留旧目录对 dev 构建无害，不必因此中断整个启动流程。
  const maxAttempts = 8;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      fs.rmSync(p, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
      return;
    } catch (e) {
      if (attempt === maxAttempts) {
        console.warn(
          `  [warn] 无法删除 ${p}（${e.code || e.message}），改为就地覆盖构建`
        );
        return;
      }
      const wait = Math.min(2000, 200 * attempt);
      console.log(
        `  [rmrf] ${e.code || "error"}，${wait}ms 后重试删除 node_modules (${attempt}/${maxAttempts})`
      );
      sleepMs(wait);
    }
  }
}

// Non-runtime files bloat the bundle and get force-unpacked from the asar
// (dist-server/node_modules is in asarUnpack so MCP child processes can require
// it). Skipping them keeps the package lean and avoids electron-builder choking
// on deeply-nested test trees (e.g. zod's src/**/*.test.ts) during packaging.
const SKIP_FILE_RE = /(\.(test|spec)\.[cm]?[jt]sx?|\.map)$/i;
const SKIP_DIR_NAMES = new Set(["node_modules", "__tests__", "__test__", ".github", "coverage"]);

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    let st;
    try {
      st = fs.statSync(s);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      if (SKIP_DIR_NAMES.has(entry.name)) continue;
      copyDir(s, d);
    } else if (st.isFile()) {
      if (SKIP_FILE_RE.test(entry.name)) continue;
      fs.copyFileSync(s, d);
    }
  }
}

function patchGolembotExports(dstDir) {
  // golembot 的源代码通过深度路径导入 (golembot/dist/gateway.js 等)，
  // 但 npm/pnpm store 里的 package.json 可能没有 "./dist/*" exports 条目，
  // 导致打包后报错 ERR_PACKAGE_PATH_NOT_EXPORTED。
  // 在复制到 dist-server/node_modules 后直接注入补丁，不依赖源目录状态。
  const pjPath = path.join(dstDir, "package.json");
  if (!fs.existsSync(pjPath)) return;
  try {
    const pj = readJSON(pjPath);
    if (pj.exports && pj.exports["./dist/*"]) return; // 已有补丁
    pj.exports = pj.exports || {};
    pj.exports["./dist/*"] = {
      import: "./dist/*",
      require: "./dist/*",
      default: "./dist/*",
      types: "./dist/*",
    };
    fs.writeFileSync(pjPath, JSON.stringify(pj, null, 2) + "\n", "utf8");
    console.log(`  [patch] golembot exports fixed`);
  } catch (e) {
    console.warn(`  [patch] golembot exports patch failed: ${e.message}`);
  }
}

function copyPackage(pkg, fromDir, visited) {
  if (visited.has(pkg)) return true;
  visited.add(pkg);
  const src = resolvePkgDir(pkg, fromDir);
  if (!src) return false;
  const dst = path.join(DEST, pkg);
  if (!fs.existsSync(dst)) {
    copyDir(src, dst);
  }
  let pj;
  try {
    pj = readJSON(path.join(src, "package.json"));
  } catch {
    return true;
  }
  // golembot 特殊处理：复制后强制注入 ./dist/* exports 补丁 + 4 项功能补丁
  if (pkg === "golembot") {
    patchGolembotExports(dst);
    patchGolembotFeatures(dst);
  }
  const deps = { ...(pj.dependencies || {}), ...(pj.peerDependencies || {}) };
  const peerMeta = pj.peerDependenciesMeta || {};
  for (const dep of Object.keys(deps)) {
    if (SKIP_DEPS.has(dep)) continue;
    const isPeer = !!(pj.peerDependencies && pj.peerDependencies[dep]);
    const optional = isPeer && peerMeta[dep] && peerMeta[dep].optional;
    const ok = copyPackage(dep, src, visited);
    if (!ok && !optional) {
      console.warn(`  [warn] missing dep ${dep} of ${pkg}`);
    }
  }
  return true;
}

// 计算缓存输入的联合 hash：任一输入文件内容变化都会导致 hash 变化。
// 缺失的输入文件（例如 patch 脚本被删）也计入，避免误命中旧缓存。
function computeInputsHash() {
  const h = crypto.createHash("sha256");
  for (const f of CACHE_INPUTS) {
    h.update(f);
    try {
      h.update(fs.readFileSync(f));
    } catch {
      h.update("<missing>");
    }
  }
  return h.digest("hex");
}

// 缓存命中要求：戳文件 hash 匹配 且 DEST 目录确实存在（防止手动删了 node_modules
// 但戳文件还在导致的假命中）。
function isCacheValid(hash) {
  if (!fs.existsSync(DEST)) return false;
  try {
    return fs.readFileSync(STAMP_FILE, "utf8").trim() === hash;
  } catch {
    return false;
  }
}

function main() {
  const hash = computeInputsHash();
  if (isCacheValid(hash)) {
    console.log("Runtime packages up-to-date (cache hit), skipping copy");
    return;
  }

  rmrf(DEST);
  fs.mkdirSync(DEST, { recursive: true });
  const visited = new Set();
  for (const pkg of REQUIRED) {
    if (!copyPackage(pkg, SERVER_DIR, visited)) {
      throw new Error(`required package not found: ${pkg}`);
    }
  }
  for (const pkg of OPTIONAL) copyPackage(pkg, SERVER_DIR, visited);
  // 全部拷贝成功后再写戳，确保中途失败不会留下命中下次的假缓存。
  fs.writeFileSync(STAMP_FILE, hash, "utf8");
  console.log(`Copied ${visited.size} runtime packages to dist-server/node_modules`);
}

main();
