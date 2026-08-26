# Grok Build Search Adapter v0.1.1

This patch is based on the uploaded v0.1.0 evidence.

Confirmed v0.1.0 behavior:
- forced the web-search subcall from `grok-4.5` to `deepseek/deepseek-v4-pro`;
- translated `openrouter:web_search` to `web_search_call`;
- then Grok Build rejected the in-progress item because `action` was missing.

v0.1.1 additionally injects a schema-shaped placeholder action only when a
`web_search_call` item has no action:

```json
{
  "type": "search",
  "query": "",
  "queries": [],
  "sources": []
}
```

A real action received later is preserved unchanged.

The installer validates the exact uploaded v0.1.0 adapter SHA-256 before
replacement, backs it up, installs v0.1.1, and runs a local normalization test.

Old SHA-256: 4e33c038652b5d3c8df9a18caec3c3e515e47b1e87427b1030a8e78bb6662653
New SHA-256: 2ac246b1470fea24acae8c609f425004c720f06c9bedb3a15cdecc2c0b8304f2

PinchBench Runner files are not modified.
