import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const gatewayPath = join(
  import.meta.dirname,
  "..",
  "packages",
  "server",
  "src",
  "modules",
  "websocket",
  "websocket.gateway.ts",
);

test("websocket gateway imports GitService when injecting it", () => {
  const source = readFileSync(gatewayPath, "utf8");
  assert.match(
    source,
    /@Inject\(GitService\)/,
    "expected gateway to inject GitService",
  );
  assert.match(
    source,
    /import\s+\{\s*GitService\s*\}\s+from\s+"\.\.\/git\/git\.service";/,
    "expected gateway to import GitService",
  );
});
