/**
 * @lenovo/agent-sdk-channel build — dist/index.js (ESM bundle) + dist/*.d.ts。
 *
 * 核心 SDK / protocol / golembot / nest 等全部 external，由消费方 host 解析。
 * .mjs MCP server 脚本（运行时 spawn）拷贝到 dist。
 */
const esbuild = require("esbuild");
const { execSync } = require("child_process");
const { cpSync, rmSync } = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const outDir = path.join(root, "dist");

rmSync(outDir, { recursive: true, force: true });

esbuild.buildSync({
  entryPoints: [path.join(root, "src/index.ts")],
  bundle: true,
  platform: "node",
  target: "node18",
  format: "esm",
  outdir: outDir,
  splitting: true,
  banner: {
    js: [
      "import { createRequire as __chCreateRequire } from 'module';",
      "import { fileURLToPath as __chFileURLToPath } from 'url';",
      "import { dirname as __chDirname } from 'path';",
      "const require = __chCreateRequire(import.meta.url);",
      "const __filename = __chFileURLToPath(import.meta.url);",
      "const __dirname = __chDirname(__filename);",
    ].join("\n"),
  },
  external: [
    "@lenovo/agent-sdk",
    "@lenovo/agent-protocol",
    "@lenovo/claude-cli",
    "@nestjs/*",
    "better-sqlite3",
    "reflect-metadata",
    "rxjs",
    "golembot",
    "golembot/*",
    "qrcode",
    "events",
    "crypto",
    "fs",
    "os",
    "path",
    "readline",
    "child_process",
    "https",
    "url",
    "util",
    "net",
    "stream",
    "node:*",
  ],
});

execSync("npx tsc -p tsconfig.build.json", { cwd: root, stdio: "inherit" });

try {
  cpSync(
    path.join(root, "src/mcp-servers"),
    path.join(outDir, "mcp-servers"),
    { recursive: true },
  );
} catch { /* no mcp assets */ }

console.log("[channel/build] done → dist/");
