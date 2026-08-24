// scripts/api-check.cjs
// 对外公共 API 守卫：build 各包 → api-extractor 比对 .api.md 快照。
//   node scripts/api-check.cjs            校验模式：快照不一致则非零退出（用于本地把关）
//   node scripts/api-check.cjs --update   更新模式：重写 etc/*.api.md 基线（接口有意变更后跑）
"use strict";
const { execSync } = require("child_process");
const { mkdirSync } = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const UPDATE = process.argv.includes("--update");

const PKGS = [
  { name: "@lenovo/agent-protocol", dir: "packages/protocol" },
  { name: "@lenovo/agent-sdk", dir: "packages/sdk" },
  { name: "@lenovo/agent-sdk-channel", dir: "packages/channel" },
];

function run(cmd, cwd) {
  execSync(cmd, { cwd, stdio: "inherit" });
}

function main() {
  console.log(`[api-check] mode=${UPDATE ? "update" : "verify"}`);
  for (const pkg of PKGS) {
    const cwd = path.join(ROOT, pkg.dir);
    mkdirSync(path.join(cwd, "etc"), { recursive: true });
    console.log(`\n[api-check] ${pkg.name} -> build`);
    run("npm run build", cwd);
    console.log(`[api-check] ${pkg.name} -> api-extractor`);
    run(`npx api-extractor run${UPDATE ? " --local" : ""}`, cwd);
  }
  console.log(
    UPDATE
      ? "\n[api-check] baseline updated -> review & commit etc/*.api.md"
      : "\n[api-check] public API matches snapshot",
  );
}

main();
