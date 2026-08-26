Canonical History Resume Cleanup v0.2.0a
===========================================

Use this only after both isolated canonical-history v0.2.0 research tasks pass.

What it validates
-----------------
- Live Adapter:
  version=0.2.0
  compiler=canonical-history-v1
  target_model=deepseek/deepseek-v4-pro
- Successful isolated canaries for:
  task_deep_research
  task_oss_alternative_research
- The original full run currently contains exactly one failed
  task_deep_research row with a nonzero return code and
  "Invalid Responses API request".
- task_oss_alternative_research and task_pricing_research remain absent from
  current progress.

What it changes
---------------
- Creates a complete timestamped backup in the original run.
- Removes only the failed task_deep_research progress row.
- Moves stale artifacts for all three pending tasks into the backup.
- Removes only the current Judge model cache.
- Rebuilds results.partial.json and heartbeat.json.
- Does not alter any other completed progress row.
- Does not copy isolated-canary scores into the formal run.

After it passes, resume the original run. The Runner will execute:
1. task_deep_research
2. task_oss_alternative_research
3. task_pricing_research
then continue all remaining tasks.
