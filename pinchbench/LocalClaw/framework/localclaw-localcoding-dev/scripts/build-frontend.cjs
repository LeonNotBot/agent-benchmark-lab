const esbuild = require("esbuild");
const path = require("path");
const fs = require("fs");

const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "packages", "client", "src");
const DIST = path.join(ROOT, "dist");

// Clean dist
if (fs.existsSync(DIST)) {
    fs.rmSync(DIST, { recursive: true });
}
fs.mkdirSync(DIST, { recursive: true });

// 1. Bundle frontend JS/TSX with esbuild
async function buildJS() {
    console.log("[build] Bundling frontend JS...");
    await esbuild.build({
        entryPoints: [path.join(SRC, "frontend.tsx")],
        bundle: true,
        platform: "browser",
        target: "es2020",
        format: "esm",
        outfile: path.join(DIST, "frontend.js"),
        minify: true,
        sourcemap: "external",
        external: ["mermaid", "mammoth/mammoth.browser"],
        define: {
            "process.env.NODE_ENV": '"production"',
        },
        jsx: "automatic",
        loader: {
            ".tsx": "tsx",
            ".ts": "ts",
        },
        plugins: [
            {
                name: "ignore-css",
                setup(build) {
                    build.onResolve({ filter: /\.css$/ }, () => ({
                        path: "css-stub",
                        namespace: "css-stub",
                    }));
                    build.onLoad({ filter: /.*/, namespace: "css-stub" }, () => ({
                        contents: "",
                        loader: "js",
                    }));
                },
            },
        ],
    });
}

// 2. Process CSS with Tailwind v4 compile API
console.log("[build] Processing CSS with Tailwind...");

async function buildCSS() {
    const twPath = path.dirname(require.resolve("tailwindcss/package.json", { paths: [SRC] }));
    const tw = require(path.join(twPath, "dist", "lib.js"));
    const cssInput = fs.readFileSync(path.join(SRC, "index.css"), "utf8");

    const compiled = await tw.compile(cssInput, {
        base: SRC,
        loadStylesheet: async (id, base) => {
            const candidates = [
                path.resolve(base, id),
                path.resolve(base, id + ".css"),
            ];
            try {
                const pkgPath = require.resolve(id + "/package.json", { paths: [base, SRC] });
                const pkgDir = path.dirname(pkgPath);
                const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
                if (pkg.style) candidates.push(path.join(pkgDir, pkg.style));
                candidates.push(path.join(pkgDir, "index.css"));
            } catch { }
            try {
                candidates.push(require.resolve(id, { paths: [base, SRC] }));
            } catch { }
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

    // Scan source files for Tailwind class candidates
    const candidates = scanCandidates(SRC);
    const css = compiled.build(candidates);
    fs.writeFileSync(path.join(DIST, "index.css"), css);
}

function scanCandidates(dir) {
    const classes = new Set();
    const exts = [".tsx", ".ts", ".html", ".jsx", ".js"];

    function walk(d) {
        for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
            const full = path.join(d, entry.name);
            if (entry.isDirectory() && entry.name !== "node_modules") {
                walk(full);
            } else if (exts.some((e) => entry.name.endsWith(e))) {
                const content = fs.readFileSync(full, "utf8");
                // Extract potential class names (Tailwind candidate pattern)
                // Must include [] for arbitrary values like ml-[280px]
                const matches = content.match(/[\w/:@.\-\[\]#%,]+/g);
                if (matches) matches.forEach((m) => classes.add(m));
            }
        }
    }
    walk(dir);
    return Array.from(classes);
}

async function main() {
    await buildJS();
    await buildCSS();

    // 3. Copy static assets
    console.log("[build] Copying static assets...");
    const assets = ["logo.png", "arrow-icons.png"];
    for (const file of assets) {
        const src = path.join(SRC, file);
        if (fs.existsSync(src)) {
            fs.copyFileSync(src, path.join(DIST, file));
        }
    }

    // Copy assets directory
    const assetsDir = path.join(SRC, "assets");
    if (fs.existsSync(assetsDir)) {
        const distAssetsDir = path.join(DIST, "assets");
        if (!fs.existsSync(distAssetsDir)) {
            fs.mkdirSync(distAssetsDir, { recursive: true });
        }
        const assetFiles = fs.readdirSync(assetsDir);
        for (const file of assetFiles) {
            const src = path.join(assetsDir, file);
            const dest = path.join(distAssetsDir, file);
            const stat = fs.statSync(src);
            if (stat.isDirectory()) {
                // Handle directory: recursively copy
                if (!fs.existsSync(dest)) {
                    fs.mkdirSync(dest, { recursive: true });
                }
                const subFiles = fs.readdirSync(src);
                for (const subFile of subFiles) {
                    const subSrc = path.join(src, subFile);
                    const subDest = path.join(dest, subFile);
                    if (fs.statSync(subSrc).isFile()) {
                        fs.copyFileSync(subSrc, subDest);
                    }
                }
            } else {
                fs.copyFileSync(src, dest);
            }
        }
    }

    // 4. Generate index.html with updated references
    console.log("[build] Generating index.html...");
    let html = fs.readFileSync(path.join(SRC, "index.html"), "utf8");
    html = html.replace(
        '<script type="module" src="./frontend.tsx"></script>',
        '<script type="module" src="./frontend.js"></script>'
    );
    fs.writeFileSync(path.join(DIST, "index.html"), html);

    console.log("[build] Frontend build complete -> dist/");
}

main().catch((err) => {
    console.error("[build] Error:", err);
    process.exit(1);
});
