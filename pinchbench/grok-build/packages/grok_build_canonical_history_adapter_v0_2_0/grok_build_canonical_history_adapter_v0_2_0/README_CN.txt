Canonical History Adapter v0.2.0
================================

Root cause confirmed from the uploaded current-state diagnostic bundle
---------------------------------------------------------------------
The failed full-run request contained:
- 14 web_search_call history items;
- no reasoning item in the failing request;
- several search actions whose `sources` value was null.

The earlier error response was a union-validator report. The `reasoning.summary`
branch was not necessarily the failing item. The actual request showed that a
provider-specific web-search history object could violate the strict action
schema, notably `sources: null`.

Architecture in v0.2.0
----------------------
This is not another one-field patch. The Adapter now has a schema-aware history
compiler:

1. Canonical native pass
   - messages are normalized by role/content;
   - function/custom calls and outputs are normalized;
   - web_search_call requires canonical id/status/action;
   - search query/queries/sources are normalized as complete arrays/strings;
   - null and scalar list fields are repaired;
   - unknown provider-specific items become portable standard messages;
   - the full result is validated locally before transmission.

2. General portable fallback
   - if OpenRouter still returns `400 invalid_prompt` for provider-specific
     web-search/reasoning history, the Adapter automatically performs one retry;
   - web-search history is compiled to standard assistant messages;
   - reasoning items are compiled to summaries or dropped when empty;
   - standard messages and local function-call history remain intact.

3. Diagnostics
   - every upstream 400 writes the full local normalized request and full error
     under:
       C:\pinchbench-grok-build\logs\adapter-diagnostics
   - no Authorization header or API key is written.

Validation budget
-----------------
No full run should be resumed yet.

Offline tests do not call a real model.

Run at most these two real isolated tasks:
1. task_deep_research
2. task_oss_alternative_research

Each isolated run is written under:
  C:\pinchbench-grok-build\canary-runs\canonical-history-v0.2.0

The original full-run progress is not modified by installation or isolated tests.

Usage order
-----------
1. Install 00_install_canonical_history_adapter_v0_2_0.ps1.
2. Restart Window A.
3. Run 07_run_canonical_history_protocol_canary.ps1.
4. Run 08_run_research_task_isolated_v0_2_0.ps1 -TaskId task_deep_research.
5. Only if step 4 passes, run the same script with
   -TaskId task_oss_alternative_research.
6. Stop and report both outputs. Do not resume the full run yet.
