/**
 * SDK build — 产出 dist/index.js (ESM bundle) + dist/*.d.ts (类型声明)。
 *
 * 运行时依赖全部 external（由消费方 host 提供或 host 的 bundler 再解析），
 * 保证 SDK 产物轻量且避免 NestJS/native binding 双实例问题。
 *
 * 用法：node scripts/build.cjs
 */
const esbuild = require("esbuild");
const { execSync } = require("child_process");
const { cpSync, rmSync } = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const outDir = path.join(root, "dist");

// 1. 清理
rmSync(outDir, { recursive: true, force: true });

// 2. esbuild — ESM bundle，全部 bare import external
esbuild.buildSync({
  entryPoints: [path.join(root, "src/index.ts")],
  bundle: true,
  platform: "node",
  target: "node18",
  format: "esm",
  outdir: outDir,
  splitting: true,
  // ESM 产物没有 __dirname/__filename/require。SDK 多处用 __dirname 解析
  // 运行时资产路径（CLI、MCP 脚本），用 banner 注入 ESM 兼容 shim。
  banner: {
    js: [
      "import { createRequire as __sdkCreateRequire } from 'module';",
      "import { fileURLToPath as __sdkFileURLToPath } from 'url';",
      "import { dirname as __sdkDirname } from 'path';",
      "const require = __sdkCreateRequire(import.meta.url);",
      "const __filename = __sdkFileURLToPath(import.meta.url);",
      "const __dirname = __sdkDirname(__filename);",
    ].join("\n"),
  },
  // 强制 emit decorator metadata：SDK 当前全用显式 @Inject(Token) 不依赖反射，
  // 但保留 design:paramtypes 可防御未来新增裸类型注入，且对 NestJS 更稳妥。
  tsconfigRaw: {
    compilerOptions: {
      experimentalDecorators: true,
      emitDecoratorMetadata: true,
    },
  },
  // external: 所有 peer + dependencies + Node built-in
  external: [
    "@nestjs/*",
    "better-sqlite3",
    "reflect-metadata",
    "rxjs",
    "ws",
    "@anthropic-ai/claude-agent-sdk",
    "@lenovo/agent-protocol",
    "@lenovo/claude-cli",
    "adm-zip",
    "diff",
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

// 3. tsc — 仅出类型声明（emitDeclarationOnly）
execSync("npx tsc -p tsconfig.build.json", { cwd: root, stdio: "inherit" });

// 4. 拷贝 .mjs MCP server 资产（运行时 spawn 脚本，tsc 不处理）
// 渠道相关 mcp 已随 @lenovo/agent-sdk-channel 子包迁出，这里只剩 scheduled-task。
const mcpDirs = [
  "src/capability/scheduled-task/mcp-servers",
];
for (const rel of mcpDirs) {
  const src = path.join(root, rel);
  const dest = path.join(outDir, rel.replace(/^src\//, ""));
  try {
    cpSync(src, dest, { recursive: true });
  } catch { /* dir may not exist in minimal SDK (channel split out) */ }
}

console.log("[sdk/build] done → dist/");
