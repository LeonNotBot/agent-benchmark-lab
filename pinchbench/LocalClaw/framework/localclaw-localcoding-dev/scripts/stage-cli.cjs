#!/usr/bin/env node
/**
 * stage-cli.cjs —— electron 打包前，把 registry 版 @lenovo/claude-cli 的 dist
 * 暂存到固定中转目录 .cli-dist/，供 electron-builder 的 extraResources 引用。
 *
 * 背景：主工程已不再维护本地 packages/claude-cli，改为从私仓消费
 * @lenovo/claude-cli（见 sdk/channel/cli 的 ^0.1.x 依赖）。该包自包含完整
 * dist/（cli.js + 全平台 vendor/ripgrep + minimal-bash + audio-capture），
 * 由其所在仓库 local-claw-core 在发布前用 copy-cli 注入齐全，主工程无需再注入。
 *
 * 为什么要中转而非直接指 node_modules：pnpm 下该包实际位于
 * node_modules/.pnpm/@lenovo+claude-cli@<版本>/...，路径含版本号会变，
 * electron-builder 的 extraResources.from 需要稳定路径。故用 require.resolve
 * 动态解析真实包根，整目录拷到 .cli-dist/（固定），extraResources 指向它。
 *
 * 幂等：每次清空重建 .cli-dist/。
 */
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const DEST = path.join(ROOT, ".cli-dist");

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

function main() {
  // 从 registry 包解析真实包根（穿透 pnpm 的 .pnpm 软链与版本 hash）。
  // pnpm 严格模式下根 node_modules 不提升该包，只有其消费方（sdk/channel/cli）
  // 的 node_modules 里有软链，故从这些包目录解析。
  const resolveBases = [
    path.join(ROOT, "packages", "sdk"),
    path.join(ROOT, "packages", "channel"),
    path.join(ROOT, "packages", "cli"),
    ROOT,
  ];
  let pkgJson;
  try {
    pkgJson = require.resolve("@lenovo/claude-cli/package.json", { paths: resolveBases });
  } catch {
    console.error(
      "[stage-cli] 无法解析 @lenovo/claude-cli。请先 pnpm install（主工程已改为从私仓消费该包）。",
    );
    process.exit(1);
  }
  const pkgRoot = path.dirname(pkgJson);
  const srcDist = path.join(pkgRoot, "dist");
  if (!fs.existsSync(srcDist)) {
    console.error(`[stage-cli] 包内缺 dist: ${srcDist}`);
    process.exit(1);
  }

  // 关键完整性断言：registry 包必须自带全平台 vendor（发布前已注入）。
  const rgRoot = path.join(srcDist, "vendor", "ripgrep");
  const rgPlatforms = fs.existsSync(rgRoot)
    ? fs.readdirSync(rgRoot).filter((n) => fs.statSync(path.join(rgRoot, n)).isDirectory())
    : [];
  if (rgPlatforms.length !== 5) {
    console.error(
      `[stage-cli] registry 包 ripgrep 平台数 ${rgPlatforms.length} ≠ 5，物料不完整（发布侧未注入齐全？）。`,
    );
    process.exit(1);
  }
  const bashExe = path.join(srcDist, "vendor", "portablegit", "minimal-bash", "usr", "bin", "bash.exe");
  if (!fs.existsSync(bashExe)) {
    console.error(`[stage-cli] registry 包缺最小 bash 集 bash.exe: ${bashExe}`);
    process.exit(1);
  }

  fs.rmSync(DEST, { recursive: true, force: true });
  copyDir(srcDist, DEST);

  const version = JSON.parse(fs.readFileSync(pkgJson, "utf8")).version;
  console.log(
    `[stage-cli] 已暂存 @lenovo/claude-cli@${version} 的 dist → .cli-dist（ripgrep ${rgPlatforms.length}/5 平台 + bash.exe 完整）。`,
  );
}

main();
