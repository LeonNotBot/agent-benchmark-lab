/**
 * 构建 VSCode 扩展。步骤:
 *  1. esbuild 打包 src/extension.ts → dist/extension.js(platform=node, external vscode)
 *  2. 准备可分发资源(dev 态用软链/拷贝,package 态实际拷入):
 *     - dist-server/         ← 仓库根 dist-server(server.cjs)
 *     - resources/claude-cli ← packages/claude-cli/dist
 *     - resources/builtin-*  ← 仓库 resources / 内置目录
 *
 * 用法:
 *   node scripts/build-ext.cjs           # 仅打包 extension.js
 *   node scripts/build-ext.cjs --assets  # 打包 + 拷贝资源(出 vsix 前用)
 */
const esbuild = require("esbuild");
const path = require("path");
const fs = require("fs");
const { execFileSync } = require("child_process");

const EXT_DIR = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(EXT_DIR, "..", "..");
const withAssets = process.argv.includes("--assets");

/**
 * 确保原生 webview 前端已构建(webview-dist/main.js)。缺失则跑 build-webview.cjs。
 * 改 webview 源码后需手动 `node scripts/build-webview.cjs` 重编(此处仅保证不缺失,
 * 避免 F5 白屏);--assets(打 vsix)时强制重编,保证产物最新。
 */
function ensureWebview() {
  const out = path.join(EXT_DIR, "webview-dist", "main.js");
  if (fs.existsSync(out) && !withAssets) return;
  console.log("[build-ext] 构建原生 webview 前端…");
  execFileSync("node", [path.join(REPO_ROOT, "scripts", "build-webview.cjs")], {
    stdio: "inherit",
  });
}

async function buildExtension() {
  console.log("[build-ext] bundling extension.ts…");
  await esbuild.build({
    entryPoints: [path.join(EXT_DIR, "src", "extension.ts")],
    bundle: true,
    platform: "node",
    target: "node18",
    format: "cjs",
    outfile: path.join(EXT_DIR, "out", "extension.js"),
    external: ["vscode"],
    sourcemap: true,
    minify: false,
  });
  console.log("[build-ext] extension.js done → out/");
}

/** 递归拷贝目录(存在才拷,缺失只告警不中断——便于 dev 态增量验证)。 */
function copyDir(src, dest, label) {
  if (!fs.existsSync(src)) {
    console.warn(`[build-ext] 跳过缺失资源: ${label} (${src})`);
    return;
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(src, dest, { recursive: true });
  console.log(`[build-ext] 拷贝 ${label} → ${path.relative(EXT_DIR, dest)}`);
}

/**
 * 拷贝前端 SPA(仓库根 dist,含 index.html)到扩展 dist/。
 * server.cjs 的 ServeStaticModule 找的是 __dirname/../dist,即 dist-server/../dist,
 * 正好命中扩展根的 dist/。extension.js 已改到 out/,不再与前端 SPA 抢 dist/。
 */
function copyFrontend() {
  const src = path.join(REPO_ROOT, "dist");
  if (!fs.existsSync(path.join(src, "index.html"))) {
    console.warn("[build-ext] 前端 SPA 未构建(缺 dist/index.html),请先跑 build-frontend.cjs");
    return;
  }
  copyDir(src, path.join(EXT_DIR, "dist"), "前端 SPA(dist)");
}

function copyAssets() {
  console.log("[build-ext] 拷贝可分发资源…");
  // 前端 SPA(供 server 的 ServeStatic(../dist) 托管)
  copyFrontend();
  // server 打包产物
  copyDir(
    path.join(REPO_ROOT, "dist-server"),
    path.join(EXT_DIR, "dist-server"),
    "dist-server",
  );
  // claude-cli
  copyDir(
    path.join(REPO_ROOT, "packages", "claude-cli", "dist"),
    path.join(EXT_DIR, "resources", "claude-cli"),
    "claude-cli",
  );
  // 内置 skills / templates
  copyDir(
    path.join(REPO_ROOT, "resources", "builtin-skills"),
    path.join(EXT_DIR, "resources", "builtin-skills"),
    "builtin-skills",
  );
  copyDir(
    path.join(REPO_ROOT, "resources", "builtin-templates"),
    path.join(EXT_DIR, "resources", "builtin-templates"),
    "builtin-templates",
  );
}

async function main() {
  ensureWebview();
  await buildExtension();
  if (withAssets) copyAssets();
}

main().catch((e) => {
  console.error("[build-ext] failed:", e);
  process.exit(1);
});
