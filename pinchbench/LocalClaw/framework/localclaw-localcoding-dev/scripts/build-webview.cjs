/**
 * 构建 VSCode 原生 Webview 前端。
 * 入口 client/src/webview/main.tsx → 输出 packages/vscode-ext/webview-dist/
 *   main.js + index.css + assets。HTML 由宿主 renderHtml 动态生成(注入
 *   SERVER_URL/nonce/CSP/asWebviewUri),故此处不产出 index.html。
 * CSS 复用桌面版 tailwind 编译(扫描 client/src),色板明暗由 vscodeTheme 同步。
 */
const esbuild = require("esbuild");
const path = require("path");
const fs = require("fs");

const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "packages", "client", "src");
const OUT = path.join(ROOT, "packages", "vscode-ext", "webview-dist");

if (fs.existsSync(OUT)) fs.rmSync(OUT, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });

async function buildJS() {
  console.log("[webview] bundling main.tsx...");
  await esbuild.build({
    entryPoints: [path.join(SRC, "webview", "main.tsx")],
    bundle: true,
    platform: "browser",
    target: "es2020",
    format: "esm",
    outfile: path.join(OUT, "main.js"),
    minify: true,
    sourcemap: "external",
    external: ["mermaid", "mammoth/mammoth.browser"],
    define: { "process.env.NODE_ENV": '"production"' },
    jsx: "automatic",
    loader: { ".tsx": "tsx", ".ts": "ts" },
    plugins: [
      {
        name: "ignore-css",
        setup(build) {
          build.onResolve({ filter: /\.css$/ }, () => ({ path: "css-stub", namespace: "css-stub" }));
          build.onLoad({ filter: /.*/, namespace: "css-stub" }, () => ({ contents: "", loader: "js" }));
        },
      },
    ],
  });
}

async function buildCSS() {
  console.log("[webview] compiling tailwind CSS...");
  const twPath = path.dirname(require.resolve("tailwindcss/package.json", { paths: [SRC] }));
  const tw = require(path.join(twPath, "dist", "lib.js"));
  const cssInput = fs.readFileSync(path.join(SRC, "index.css"), "utf8");
  const compiled = await tw.compile(cssInput, {
    base: SRC,
    loadStylesheet: async (id, base) => {
      const candidates = [path.resolve(base, id), path.resolve(base, id + ".css")];
      try {
        const pkgPath = require.resolve(id + "/package.json", { paths: [base, SRC] });
        const pkgDir = path.dirname(pkgPath);
        const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
        if (pkg.style) candidates.push(path.join(pkgDir, pkg.style));
        candidates.push(path.join(pkgDir, "index.css"));
      } catch { }
      try { candidates.push(require.resolve(id, { paths: [base, SRC] })); } catch { }
      for (const p of candidates) {
        if (fs.existsSync(p) && fs.statSync(p).isFile()) {
          return { content: fs.readFileSync(p, "utf8"), base: path.dirname(p) };
        }
      }
      throw new Error("Cannot resolve stylesheet: " + id + " from " + base);
    },
    loadModule: async (id, base) => {
      const resolved = path.resolve(base, id);
      const mod = require(resolved);
      return { module: mod.default || mod, base: path.dirname(resolved) };
    },
  });
  const css = compiled.build(scanCandidates(SRC));
  fs.writeFileSync(path.join(OUT, "index.css"), css);
}

function scanCandidates(dir) {
  const classes = new Set();
  const exts = [".tsx", ".ts", ".html", ".jsx", ".js"];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory() && e.name !== "node_modules") walk(full);
      else if (exts.some((x) => e.name.endsWith(x))) {
        const m = fs.readFileSync(full, "utf8").match(/[\w/:@.\-\[\]#%,]+/g);
        if (m) m.forEach((c) => classes.add(c));
      }
    }
  })(dir);
  return Array.from(classes);
}

function copyAssets() {
  const assetsDir = path.join(SRC, "assets");
  if (!fs.existsSync(assetsDir)) return;
  fs.cpSync(assetsDir, path.join(OUT, "assets"), { recursive: true });
  for (const f of ["logo.png", "arrow-icons.png"]) {
    const s = path.join(SRC, f);
    if (fs.existsSync(s)) fs.copyFileSync(s, path.join(OUT, f));
  }
}

async function main() {
  await buildJS();
  await buildCSS();
  copyAssets();
  console.log("[webview] build complete -> packages/vscode-ext/webview-dist/");
}

main().catch((e) => { console.error("[webview] Error:", e); process.exit(1); });
