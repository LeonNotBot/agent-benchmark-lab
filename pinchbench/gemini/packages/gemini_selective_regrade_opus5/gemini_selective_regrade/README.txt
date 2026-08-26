Gemini PinchBench selective frozen-output regrade

Scope
- Regrades exactly 22 tasks whose Judge grading failed or could not be parsed.
- Uses openrouter/anthropic/claude-opus-5.
- Does not rerun Gemini CLI or any Agent task.
- Does not modify the original run.
- Preserves task_git_rescue_recovery as automated-grader N/A.
- Corrects task_market_research model_mismatch only after verifying that
  gemini-3-flash-preview contributed zero tokens in the frozen transcript.

Judge transport safeguards inherited from the uploaded current regrader
- Completion budgets: 2048, 4096, 8192, 16384.
- Retries null/empty content and finish_reason=length.
- Saves every raw Judge response.
- 300-second Judge timeout and 480-second per-job hard timeout.

Install
Run 00_install_gemini_selective_regrade.ps1.

Run
Use 01_run_gemini_selective_regrade.ps1 in a PowerShell window that already
contains OPENROUTER_API_KEY.

Monitor
Use 02_monitor_gemini_selective_regrade.ps1 in another PowerShell window.

Outputs
- Evidence: C:\pinchbench-gemini\selective-regrades\smoke_*
- Corrected 143-task result: C:\pinchbench-gemini\regraded-results\...
- Original result remains unchanged.
