#!/usr/bin/env node
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import process from "node:process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const entry = resolve(__dirname, "../src/index.tsx");
const bunBin = process.env.BUN ?? "bun";

const child = spawn(bunBin, [entry, ...process.argv.slice(2)], {
  stdio: "inherit",
});

child.on("error", (error) => {
  if (error && error.code === "ENOENT") {
    console.error("Bun is required to run local-claw. Install it from https://bun.sh and retry.");
  } else {
    console.error(error);
  }
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
