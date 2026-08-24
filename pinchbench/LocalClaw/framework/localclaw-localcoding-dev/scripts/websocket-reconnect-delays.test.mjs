import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const hookPath = join(
  import.meta.dirname,
  "..",
  "packages",
  "client",
  "src",
  "hooks",
  "useWebSocket.ts",
);

test("websocket reconnect delays are capped at 5 seconds", () => {
  const source = readFileSync(hookPath, "utf8");
  const match = source.match(/const\s+RECONNECT_DELAYS\s*=\s*\[([^\]]+)\]/);
  assert.ok(match, "expected reconnect delays constant to exist");

  const delays = match[1]
    .split(",")
    .map((value) => Number.parseInt(value.trim(), 10))
    .filter(Number.isFinite);

  assert.ok(delays.length > 0, "expected at least one reconnect delay");
  assert.ok(
    delays.every((delay) => delay <= 5000),
    "expected all reconnect delays to stay within 5 seconds",
  );
});
