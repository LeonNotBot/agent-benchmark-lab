# LocalClaw × PinchBench

This directory contains the LocalClaw / LocalCoding integration used to run PinchBench with a Smart Hybrid Qwen → Kimi routing strategy.

## Configuration

- Default model: `qwen/qwen3.6-27b`
- Upgrade model: `moonshotai/kimi-k3`
- Judge model: `openrouter/anthropic/claude-opus-5`
- Environment: Windows + PowerShell
- Local server: `http://127.0.0.1:10086`

## Directory layout

```text
pinchbench/LocalClaw/
├── README.md
├── framework/
│   └── localclaw-localcoding-dev/
├── runner/
│   ├── 00_preflight_our_framework_windows.ps1
│   ├── 01_start_our_framework_server_windows.ps1
│   ├── 03_run_pinchbench_our_framework_windows.py
│   └── 05_stop_our_framework_server_windows.ps1
├── hybrid-v5d-final/
│   ├── classify_replacement_attempt.py
│   ├── merge_replacements_and_recount_tokens.py
│   ├── replacement_task_ids.txt
│   ├── run_v5d_replacements_final.ps1
│   ├── start_fresh_v5d_replacements.ps1
│   ├── test_classifier.py
│   ├── verify_v5d_bundle.ps1
│   └── watch_v5d_replacements.ps1
└── patches/
    └── optional Smart Hybrid patch / rollback files
```

## Core framework code

The LocalClaw source is under:

```text
framework/localclaw-localcoding-dev/
```

Important Smart Hybrid files include:

```text
packages/sdk/src/capability/routing/smart-hybrid.service.ts
packages/sdk/src/capability/routing/routing.service.ts
packages/sdk/src/capability/runner/runner-spawn.service.ts
packages/sdk/src/capability/runner/task-snapshot-watcher.service.ts
```

The routing policy is:

1. Each new turn starts on Qwen.
2. The agent declares criticality through `TaskCreate` / `TaskUpdate`.
3. `critical: true` can upgrade execution to Kimi.
4. Model switching happens at a safe tool-result boundary.
5. Critical work can later de-escalate to Qwen.
6. No benchmark task ID or category is hard-coded to force Kimi.

## Build

```powershell
Set-Location "C:\pinchbench-our-framework\framework\localclaw-localcoding-dev"
pnpm install
pnpm build:server
```

## Start the server

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\pinchbench-our-framework\runner\01_start_our_framework_server_windows.ps1"
```

Health check:

```powershell
Invoke-RestMethod "http://127.0.0.1:10086/api/health" -Proxy $null
```

## Run PinchBench

Full suite:

```powershell
& "C:\pinchbench-our-framework\.venv\Scripts\python.exe" "C:\pinchbench-our-framework\runner\03_run_pinchbench_our_framework_windows.py" --skill-dir "C:\pinchbench-our-framework\skill" --tasks-dir "C:\pinchbench-our-framework\skill\tasks" --mode hybrid --suite all --judge-model "openrouter/anthropic/claude-opus-5" --results-dir "C:\pinchbench-our-framework\results" --keep-workspaces --clear-judge-cache --timeout-multiplier 6 --network-timeout 600 --infra-retries 3
```

Single task:

```powershell
& "C:\pinchbench-our-framework\.venv\Scripts\python.exe" "C:\pinchbench-our-framework\runner\03_run_pinchbench_our_framework_windows.py" --skill-dir "C:\pinchbench-our-framework\skill" --tasks-dir "C:\pinchbench-our-framework\skill\tasks" --mode hybrid --suite "task_pricing_research" --judge-model "openrouter/anthropic/claude-opus-5" --results-dir "C:\pinchbench-our-framework\results" --keep-workspaces --clear-judge-cache --timeout-multiplier 6 --network-timeout 600 --infra-retries 3
```

## Replacement / salvage workflow

Final replacement tooling is under:

```text
hybrid-v5d-final/
```

Policy:

```text
clean success -> accept
clean benchmark timeout -> accept
429 / 502 / 504 infrastructure failure -> retry
unknown error -> review
```

A genuine low score is never rerun simply to improve the benchmark score.

## Merge final results and recount tokens

```powershell
& "C:\pinchbench-our-framework\.venv\Scripts\python.exe" "C:\pinchbench-our-framework\hybrid-v5d-final\merge_replacements_and_recount_tokens.py" --original-run "C:\pinchbench-our-framework\hybrid-v5c-full-all\our_framework_hybrid_20260821_175422" --replacement-manifest "C:\pbv5d\replacement_manifest.json" --output-dir "C:\pinchbench-our-framework\hybrid-v5d-final-merged"
```

Final token accounting is reconstructed from raw SDK assistant messages, deduplicated by `(session_id, assistant message.id)`.

Expected integrity checks:

```text
task_count = 143
replacement_count = 10
missing_transcripts = 0
token_identity_mismatches = 0
effective_tokens.identity_ok = true
```

## Benchmark methodology

- No benchmark-specific task IDs are used to force Kimi.
- Clean benchmark timeouts are valid outcomes.
- Only proven infrastructure/framework failures are retried.
- Original results and replacement provenance are preserved.
- Final Qwen/Kimi token counts are rebuilt from raw SDK messages.

## Do not commit

Do not commit:

```text
.venv/
node_modules/
dist/
build/
logs/
transcripts/
workspaces/
infra_attempts/
config/
settings.json
.env
.env.*
*.key
*.pem
*.log
```

Never commit API keys or private configuration.

## Reproducibility artifacts

Useful result artifacts include:

```text
run_config.json
results.json
final_results_merged_recounted.json
final_results_merged_recounted.csv
final_summary_recounted.json
replacement_provenance.json
replacement_manifest.json
```

Large raw transcripts should normally be archived separately instead of being committed to Git.
