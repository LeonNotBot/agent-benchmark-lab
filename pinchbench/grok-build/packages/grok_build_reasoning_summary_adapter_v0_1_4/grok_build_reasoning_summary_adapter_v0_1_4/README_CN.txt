Grok Build / OpenRouter Reasoning Summary Adapter v0.1.4
================================================================

Observed real failure
---------------------
The real task requests were already flat. The rejected requests contained:
- type=reasoning history items;
- type=web_search_call history items;
- normal function_call/function_call_output history.

OpenRouter's validation error identified the actual invalid field:
    path: ["summary"]
    expected array, received undefined

Grok Build replayed streamed reasoning items without the summary array required
by OpenRouter's stateless Responses input schema.

Fix
---
Adapter v0.1.4:
1. Adds summary=[] to a reasoning item only when summary is absent/null.
2. Converts a scalar string summary to a one-element array.
3. Applies the repair both to streamed upstream responses and outgoing requests.
4. Preserves reasoning IDs/content, web-search history and local tool history.
5. Retains all v0.1.3 search and structured-tool compatibility behavior.

Validation order
----------------
1. Install.
2. Restart Window A.
3. Run 07_run_reasoning_summary_protocol_canary.ps1.
4. Run 08_run_task_deep_research_isolated.ps1.
5. Only after the real isolated task passes, run
   09_prepare_reasoning_summary_failures_for_resume.ps1 against the original run.
6. Resume the original run.

The isolated canary writes to C:\pinchbench-grok-build\canary-runs and never
changes the original full-run progress.
