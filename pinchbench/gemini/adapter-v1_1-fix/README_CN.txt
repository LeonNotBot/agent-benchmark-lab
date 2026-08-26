Gemini CLI -> OpenRouter Adapter v1.1 transport fix
====================================================

Diagnosis
---------
The uploaded canary diagnostic shows that OpenRouter requests completed and
DeepSeek V4 Pro returned valid text/tool calls. Gemini CLI 0.52.0 then retried
the same request and failed with:

    Incomplete JSON segment at the end

The failure is therefore in the adapter-to-Gemini SSE transport, not the
OpenRouter key, proxy, model availability, or request translation.

Fix
---
OpenRouter is still consumed as an SSE stream internally. The adapter now
aggregates one model turn and emits exactly one complete Gemini SSE data event,
with Content-Length and Connection: close. This matches the earlier contract
probe transport that Gemini CLI successfully parsed.

Run order
---------
1. Stop the currently running adapter window with Ctrl+C.
2. Run 01_apply_adapter_v1_1.ps1.
3. Restart the adapter with the existing 02_start_adapter.ps1.
4. In window B run 02_run_text_canary_v1_1.ps1.
5. Only after the text canary passes, rerun the existing five canaries.
