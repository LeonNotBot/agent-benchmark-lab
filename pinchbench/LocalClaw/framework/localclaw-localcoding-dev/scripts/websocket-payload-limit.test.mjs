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

test("websocket gateway raises ws maxPayload above the default limit", () => {
  const source = readFileSync(gatewayPath, "utf8");

  assert.match(
    source,
    /@WebSocketGateway\(\{[^}]*maxPayload:\s*WEBSOCKET_MAX_PAYLOAD_BYTES[^}]*\}\)/s,
    "expected websocket gateway to configure ws maxPayload",
  );

  const payloadLimit = source.match(
    /const\s+WEBSOCKET_MAX_PAYLOAD_BYTES\s*=\s*(\d+)\s*\*\s*1024\s*\*\s*1024\s*;/,
  );
  assert.ok(
    payloadLimit,
    "expected websocket payload limit constant to be defined in MiB",
  );
  assert.ok(
    Number(payloadLimit[1]) >= 200,
    "expected websocket payload limit to be at least 200 MiB",
  );
});
