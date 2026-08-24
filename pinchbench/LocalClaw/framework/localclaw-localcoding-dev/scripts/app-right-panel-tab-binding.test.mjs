import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const appPath = join(
  import.meta.dirname,
  "..",
  "packages",
  "client",
  "src",
  "App.tsx",
);

test("App reads rightPanelTab from the store before using it in URL sync", () => {
  const source = readFileSync(appPath, "utf8");
  assert.match(
    source,
    /panelTab:\s*rightPanelTab/,
    "expected App to use rightPanelTab when building URL state",
  );
  assert.match(
    source,
    /const\s+rightPanelTab\s*=\s*useAppStore\(\(s\)\s*=>\s*s\.rightPanelTab\);/,
    "expected App to read rightPanelTab from the store",
  );
});
