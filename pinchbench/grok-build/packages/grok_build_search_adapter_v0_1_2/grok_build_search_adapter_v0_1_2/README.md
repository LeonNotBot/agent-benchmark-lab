# Grok Build Search Adapter v0.1.2

This patch is based on the exact v0.1.1 adapter source.

Observed v0.1.1 result:
- target model forcing passed;
- `openrouter:web_search` -> `web_search_call` passed;
- missing `action` injection passed;
- Grok Build then failed on the non-JSON SSE terminator `data: [DONE]`.

v0.1.2 suppresses only `data: [DONE]` and its immediately following empty
separator line. It preserves all JSON Responses API events, including
`response.completed`.

It does not modify PinchBench Runner files.

Upgrade order:
1. Stop the v0.1.1 adapter in Window A.
2. Run `00_upgrade_to_v0_1_2.ps1`.
3. Restart `01_start_search_adapter.ps1` in Window A.
4. Run `03_run_web_search_adapter_canary.ps1` in Window B.
