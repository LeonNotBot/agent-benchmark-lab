const esbuild = require("esbuild");
const path = require("path");
const fs = require("fs");

esbuild.buildSync({
  entryPoints: [path.join(__dirname, "..", "packages", "server", "src", "main.ts")],
  bundle: true,
  platform: "node",
  target: "node18",
  format: "cjs",
  outfile: path.join(__dirname, "..", "dist-server", "server.cjs"),
  external: [
    "better-sqlite3",
    "ssh2",
    "cpu-features",
    "@nestjs/microservices",
    "@nestjs/microservices/microservices-module",
    "@nestjs/platform-socket.io",
    "@fastify/static",
    "class-transformer",
    "class-validator",
    // GolemBot uses dynamic importPeer() to load IM SDKs from its own
    // node_modules. Bundling breaks that resolution; keep it external so
    // the require chain stays intact at runtime.
    "golembot",
    "@larksuiteoapi/node-sdk",
    "grammy",
    "@slack/bolt",
    "dingtalk-stream",
    // chokidar 5 纯 ESM + 可能有 native 依赖（fsevents），保持 external
    "chokidar",
  ],
  define: {
    "import.meta.url": "__importMetaUrl",
  },
  banner: {
    js: [
      'const __importMetaUrl = require("url").pathToFileURL(__filename).href;',
      'require("reflect-metadata");',
    ].join("\n"),
  },
  sourcemap: false,
  minify: false,
  // NestJS uses decorators — esbuild handles them natively with tsconfigRaw
  tsconfigRaw: JSON.stringify({
    compilerOptions: {
      experimentalDecorators: true,
      emitDecoratorMetadata: true,
    },
  }),
});

console.log("Server bundled to dist-server/server.cjs");

// Copy design prompt txt to dist-server/ for runtime reading
const designPromptSrc = path.join(__dirname, "..", "docs", "design", "Claude-Design-Sys-Prompt.txt");
const designPromptDst = path.join(__dirname, "..", "dist-server", "Claude-Design-Sys-Prompt.txt");
if (fs.existsSync(designPromptSrc)) {
  fs.copyFileSync(designPromptSrc, designPromptDst);
  console.log("Design prompt copied to dist-server/");
}

// Copy MCP server scripts to dist-server/mcp-servers/
// channel 已拆为独立子包 @lenovo/agent-sdk-channel；scheduled-task 在 SDK 核心。
const mcpSources = [
  path.join(__dirname, "..", "packages", "channel", "src", "mcp-servers"),
  path.join(__dirname, "..", "packages", "sdk", "src", "capability", "scheduled-task", "mcp-servers"),
  path.join(__dirname, "..", "packages", "sdk", "src", "capability", "secret", "mcp-servers"),
];
const mcpDst = path.join(__dirname, "..", "dist-server", "mcp-servers");
if (fs.existsSync(mcpDst)) fs.rmSync(mcpDst, { recursive: true });
fs.mkdirSync(mcpDst, { recursive: true });
for (const src of mcpSources) {
  if (!fs.existsSync(src)) continue;
  for (const file of fs.readdirSync(src)) {
    fs.copyFileSync(path.join(src, file), path.join(mcpDst, file));
  }
}
console.log(`MCP servers copied from [channel(pkg), scheduled-task(sdk), secret(sdk)]`);

// Copy runtime deps (golembot + IM SDKs etc.) into dist-server/node_modules so
// that bundled server.cjs can require them at runtime.
require("./copy-runtime-deps.cjs");
