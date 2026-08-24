import tailwind from "bun-plugin-tailwind";

const result = await Bun.build({
  entrypoints: ["./src/index.html"],
  outdir: "./dist",
  target: "browser",
  minify: true,
  sourcemap: "external",
  define: {
    "process.env.NODE_ENV": "\"production\"",
  },
  env: "BUN_PUBLIC_*",
  plugins: [tailwind],
});

if (!result.success) {
  for (const message of result.logs) {
    console.error(message);
  }
  process.exit(1);
}
