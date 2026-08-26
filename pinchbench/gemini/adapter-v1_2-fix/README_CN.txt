Gemini CLI -> OpenRouter Adapter v1.2 direct fix
=================================================

This package is based on the uploaded interrupted canary diagnostic.

Confirmed observations
----------------------
- Text, UTF-8 file, and Windows shell canaries passed under v1.1.
- The long request produced a valid OpenRouter response and tool call.
- v1.1 held the Gemini response body completely silent while waiting.
- Gemini CLI retried the idle request before the upstream turn completed.
- The abandoned client connection then caused WinError 10053 when v1.1
  attempted to write the result.

v1.2 changes
------------
1. Sends an immediate valid Gemini JSON SSE heartbeat.
2. Sends another complete heartbeat every 10 seconds while OpenRouter runs.
3. Never uses SSE comments, which can remain in @google/genai's JSON buffer.
4. Sends the final text or function call as one complete JSON SSE event.
5. Detects BrokenPipe, reset, and Windows ConnectionAbortedError.
6. Closes the OpenRouter response when the Gemini client disconnects.
7. Records client_disconnected instead of printing a server traceback.
8. Includes hard process timeouts and progress output for canaries.
9. Writes canary_state.json after every completed step.
10. Generates diagnostic manifests outside the staging directory before moving
    them into the ZIP, avoiding the self-hash file lock seen earlier.

Run order
---------
1. Stop the old adapter in window A with Ctrl+C.
2. Run 01_apply_adapter_v1_2.ps1.
3. In the window containing OPENROUTER_API_KEY, run:
   C:\pinchbench-gemini\adapter-v1\02_start_adapter_v1_2.ps1
4. In window B, run:
   C:\pinchbench-gemini\adapter-v1\03_run_remaining_canaries_v1_2.ps1
5. Bundle results with:
   C:\pinchbench-gemini\adapter-v1\04_bundle_v1_2_diagnostics.ps1
