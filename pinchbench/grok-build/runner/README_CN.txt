Grok Build PinchBench Windows Runner v1.0.1
================================================

Fixed environment
- Root: C:\pinchbench-grok-build
- Grok Build: 0.2.118, SHA256 8b365d13...
- Benchmark GROK_HOME: C:\pinchbench-grok-build\benchmark-home
- Model alias: deepseek-v4-pro-openrouter
- Actual model: deepseek/deepseek-v4-pro
- Search adapter: http://127.0.0.1:8767 v0.1.2
- Proxy: http://127.0.0.1:10090
- Judge: openrouter/anthropic/claude-opus-5

Important fixes carried forward from earlier projects
- UTF-8 prompt file and Python UTF-8 stdout parsing; no PowerShell native redirection for Agent output.
- Prompt is never passed as a long Windows argv string.
- Exact CLI version, executable SHA, PinchBench commit and manifest SHA are preflight gates.
- Non-zero usage/model-call evidence is required for model mismatch, avoiding zero-token false positives.
- Raw Judge responses are retained; null/truncated responses retry with 2048/4096/8192/16384 budgets.
- Hybrid automated breakdown is retained when Judge fails.
- Atomic JSON writes with Windows sharing-violation retry.
- progress.jsonl + results.partial.json + heartbeat.json support monitoring and interrupted-run resume.
- Existing results are never overwritten by a new run; resume validates task list and model first.
- Isolated benchmark GROK_HOME disables Claude/Cursor compatibility scans so user rules, skills, MCP and hooks cannot leak into the run.
- Full run clears the Judge cache; resume never clears it.

Order
1. Keep search adapter v0.1.2 running in window A.
2. Install 00_install_grok_build_runner.ps1.
3. Run 01_preflight_grok_build.ps1.
4. Run 02_run_grok_build_smoke.ps1.
5. After smoke validation, run 04_run_grok_build_full.ps1.
6. Monitor with 03_monitor_pinchbench_grok_build_windows.ps1.
7. Resume an interrupted run with 05_resume_grok_build_run.ps1 -RunDir <path>.


v1.0.1 installer hotfix
- Renamed the installer variable `$Home` to `$BenchmarkHome`. Windows PowerShell variable names are case-insensitive, so `$Home` collided with the read-only automatic variable `$HOME`.
- Renamed launch-script `$args` variables to `$ProcessArguments` to avoid using a PowerShell automatic variable.
