V5d FINAL replacement controller - single retry layer

Why this exists
---------------
The original PinchBench runner already enforces the per-turn deadline. Historical V5c
task_pricing_research discarded infra attempts ended at ~600.016s, 600.093s and
600.031s. R8 passed --infra-retries 3 inside each outer attempt, so one Python
process could contain several 600s internal attempts. The watcher incorrectly showed
the whole process lifetime (for example 885s) as if it were one attempt.

Final design
------------
- Invoke the original runner with --infra-retries 0.
- One Python process == one benchmark attempt.
- Keep --timeout-multiplier 6 and --network-timeout 600 unchanged.
- External controller owns exactly MaxInfraRetries retries (default 3), therefore
  maximum total attempts = 4, matching the original runner's max_retries_per_task=3.
- Raw SDK classifier decides:
    success -> accept
    clean benchmark timeout -> accept
    429/502/504 infra contamination -> retry while budget remains
    unknown error -> review; no automatic rerun
- current_attempt.json makes monitoring unambiguous:
    current attempt number, attempt elapsed seconds, task cumulative seconds, PID.
- No second hidden retry layer exists.

Start fresh:
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\pinchbench-our-framework\hybrid-v5d-final\start_fresh_v5d_replacements.ps1" -ResultsRoot "C:\pbv5d" -MaxInfraRetries 3

Watch:
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\pinchbench-our-framework\hybrid-v5d-final\watch_v5d_replacements.ps1" -ResultsRoot "C:\pbv5d"
