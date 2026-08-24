#!/usr/bin/env node
/**
 * pack-standalone.cjs — 打一个「自包含」tarball 供外部用户 npm i -g 安装。
 *
 * 外部用户访问不了私仓，故不能靠 registry 拉 @lenovo/claude-cli 依赖。
 * 本脚本把该依赖（含 72M vendor 物料）实体化进 node_modules 后用 npm pack +
 * bundleDependencies 打进 tarball，用户装的时候零 registry 依赖。
 *
 * pnpm 的 node_modules 是软链（claude-cli -> .pnpm/...），npm pack 的 bundle
 * 逻辑不跟随软链，故打包前须把软链换成实体目录，打完再恢复软链（finally 保证）。
 * 恢复时用已解析的【绝对实体路径】重建 junction——不复用 readlinkSync 的原始
 * 目标（pnpm 下可能是相对 POSIX 路径，Windows junction 无法原样重建）。
 */
"use strict";
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const CLI_ROOT = path.resolve(__dirname, "..");
const LINK = path.join(CLI_ROOT, "node_modules", "@lenovo", "claude-cli");

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

/** 目录体积（MB，粗略）。 */
function duMB(dir) {
  let total = 0;
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else total += fs.statSync(p).size;
    }
  };
  walk(dir);
  return Math.round(total / 1024 / 1024);
}

function main() {
  // 真实实体包根（穿透 pnpm 软链，绝对路径）。既用于实体拷贝，也用于恢复 junction。
  const pkgJson = require.resolve("@lenovo/claude-cli/package.json", { paths: [CLI_ROOT] });
  const realRoot = path.dirname(fs.realpathSync(pkgJson));

  // 先编译，确保 dist 最新。tsc 走 node 直调其 JS 入口，跨平台稳妥。
  execFileSync(process.execPath, [
    path.join(CLI_ROOT, "node_modules", "typescript", "bin", "tsc"),
    "-p", path.join(CLI_ROOT, "tsconfig.json"),
  ], { stdio: "inherit" });

  let tgz = "";
  try {
    // 软链 → 实体目录：npm pack 才能 bundle 进去。
    fs.rmSync(LINK, { recursive: true, force: true });
    copyDir(realRoot, LINK);
    console.log(`[pack] 已实体化 @lenovo/claude-cli（${duMB(LINK)} MB），开始打包…`);

    // Windows 上 npm 是 npm.cmd，execFileSync 需 shell:true 才能解析。
    const out = execFileSync("npm", ["pack", "--pack-destination", CLI_ROOT], {
      cwd: CLI_ROOT,
      encoding: "utf8",
      shell: true,
    });
    tgz = out.trim().split(/\r?\n/).pop();
  } finally {
    // 恢复软链：删实体目录，用绝对实体路径重建 junction，绝不污染 pnpm 工作区。
    fs.rmSync(LINK, { recursive: true, force: true });
    fs.symlinkSync(realRoot, LINK, "junction");
    console.log("[pack] 已恢复 claude-cli 软链。");
  }

  if (tgz) {
    console.log(`[pack] 生成 tarball：${path.join(CLI_ROOT, tgz)}`);
    console.log(`[pack] 外部用户安装：npm i -g ${tgz}`);
  }
}

main();
