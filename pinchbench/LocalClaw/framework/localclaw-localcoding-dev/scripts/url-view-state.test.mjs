import test from "node:test";
import assert from "node:assert/strict";

import {
  buildUrlSearch,
  parseUrlState,
} from "../packages/client/src/navigation/urlState.js";

test("parseUrlState reads chat session from query string", () => {
  assert.deepEqual(parseUrlState("?view=chat&session=session-123"), {
    view: "chat",
    sessionId: "session-123",
    panelOpen: false,
    panelTab: "resources",
  });
});

test("parseUrlState falls back to chat for unknown views", () => {
  assert.deepEqual(parseUrlState("?view=unknown"), {
    view: "chat",
    sessionId: null,
    panelOpen: false,
    panelTab: "resources",
  });
});

test("parseUrlState ignores session on non-chat views", () => {
  assert.deepEqual(parseUrlState("?view=skills&session=session-123"), {
    view: "skills",
    sessionId: null,
    panelOpen: false,
    panelTab: "resources",
  });
});

test("buildUrlSearch keeps session only for chat view", () => {
  assert.equal(
    buildUrlSearch({ view: "chat", sessionId: "session-123" }),
    "?view=chat&session=session-123",
  );
  assert.equal(
    buildUrlSearch({ view: "knowledge", sessionId: "session-123" }),
    "?view=knowledge",
  );
});

test("parseUrlState reads right panel state for chat view", () => {
  assert.deepEqual(
    parseUrlState("?view=chat&session=session-123&panel=1&tab=changes"),
    {
      view: "chat",
      sessionId: "session-123",
      panelOpen: true,
      panelTab: "changes",
    },
  );
});

test("buildUrlSearch writes right panel state and normalizes tab", () => {
  assert.equal(
    buildUrlSearch({
      view: "chat",
      sessionId: "session-123",
      panelOpen: true,
      panelTab: "files",
    }),
    "?view=chat&session=session-123&panel=1&tab=files",
  );
  assert.equal(
    buildUrlSearch({
      view: "chat",
      sessionId: "session-123",
      panelOpen: true,
      panelTab: "bad",
    }),
    "?view=chat&session=session-123&panel=1&tab=resources",
  );
});
