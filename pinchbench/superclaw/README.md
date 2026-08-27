# SuperClaw + Kimi K3 · PinchBench (Windows)

本目录保存 **Intel SuperClaw + OpenCode + LLMRouter + OpenRouter + Kimi K3** 在 Windows 环境下运行 PinchBench 的 benchmark-specific Runner、Windows/Grader 兼容层、基础设施恢复工具与实验工具。

这里不是 SuperClaw 产品本体的源码镜像，也不是正式 benchmark `runs/` 的结果仓库。SuperClaw 本身仍通过其 Windows + WSL + Docker runtime 运行；本目录只保存为了让该执行链可复现、可审计而产生的项目代码。

## 1. Final Benchmark Identity

| Item | Final value |
|---|---|
| Platform | Windows host + SuperClaw WSL/Docker backend |
| SuperClaw agent | `superclaw-default` |
| SuperClaw model slot | `llmrouter/cloud-model` |
| Actual cloud model | `openrouter/moonshotai/kimi-k3` |
| Judge | `openrouter/anthropic/claude-opus-5` |
| WSL distro | `superclaw-docker` |
| Docker container | `superclaw-backend` |
| LLMRouter endpoint | `http://127.0.0.1:18321` |
| Runner base revision string | `2026-08-13-superclaw-windows-headless-v1` |
| PinchBench commit | `819384ae830492365b8363fc26bc2602e73f216d` |
| Selected tasks | `143` |
| Default skipped | `4` external-integration tasks |
| Strict observed score | `0.740864` (`74.086%`) |
| Infrastructure-adjusted score | `0.775279` (`77.528%`) |
| Infrastructure-adjusted status | `112 success / 30 timeout / 1 error` |

The tested execution chain is:

```text
Windows PowerShell
    ↓
WSL distro: superclaw-docker
    ↓
Docker container: superclaw-backend
    ↓
opencode run
    ↓
agent: superclaw-default
    ↓
model slot: llmrouter/cloud-model
    ↓
OpenRouter
    ↓
moonshotai/kimi-k3
```

PinchBench grading remains on the Windows side.

## 2. Repository Layout

```text
agent-benchmark-lab/
└─ pinchbench/
   ├─ runtime/
   │  └─ shared Python + PinchBench environment definition
   │
   └─ superclaw/
      ├─ README.md
      ├─ .gitignore
      ├─ runner/
      │  ├─ run_pinchbench_superclaw_windows.py
      │  └─ run_pinchbench_opencode_kimi_windows.py
      ├─ grading-overrides/
      │  ├─ lib_agent.py
      │  └─ lib_grading.py
      ├─ tools/
      │  ├─ recovery/
      │  └─ infra-recovery/
      ├─ experiments/
      │  └─ timeout-sensitivity-2x/
      ├─ archive/
      │  └─ migration-patches/
      └─ manifests/
         └─ final-stack.txt
```

## 3. `runner/`

### `run_pinchbench_superclaw_windows.py`

Canonical SuperClaw-specific PinchBench Runner.

Its execution layer replaces direct native OpenCode execution with:

```text
Windows
→ WSL
→ Docker
→ OpenCode
→ SuperClaw agent
→ LLMRouter
```

while reusing the adjacent OpenCode/Kimi Runner for PinchBench task parsing, fixture staging, transcript normalization, grading helpers and report generation.

The file still contains the base revision string:

```text
2026-08-13-superclaw-windows-headless-v1
```

but the final local file contains later compatibility/reliability changes. The authoritative final compatibility gate is the eight-item audit described below.

### `run_pinchbench_opencode_kimi_windows.py`

This file is an explicit runtime dependency because the SuperClaw Runner imports it as:

```python
import run_pinchbench_opencode_kimi_windows as base
```

Both Python files must remain adjacent in `runner/`.

The other OpenCode/Kimi regrade and diagnostic scripts from the original working directory are maintained separately under the OpenCode/Kimi project and are not SuperClaw runtime dependencies.

## 4. Final Eight-Item Compatibility Stack

The final SuperClaw working tree is expected to pass:

```text
PASS  timeout CLI
PASS  Windows UTF-8 re-exec
PASS  targeted Agent infra retry
PASS  SuperClaw infra signatures v2
PASS  resume support
PASS  Judge 8192 budget
PASS  Judge parse retry
PASS  Windows Git Bash wrapper v2

Checks=8 Failures=0
Stack audit passed.
```

These checks span:

```text
runner/run_pinchbench_superclaw_windows.py
grading-overrides/lib_agent.py
grading-overrides/lib_grading.py
```

### Timeout CLI

The original baseline used:

```text
network timeout = 300 s
non-network timeout multiplier = 3.0
```

The separate timeout-sensitivity experiment changes timing only for that experiment.

### Windows UTF-8 Re-exec

The final Runner can re-exec itself with:

```text
python -X utf8
```

to avoid Windows CP936/GBK decoding failures.

### Targeted Agent Infrastructure Retry

At most one targeted fresh retry is allowed for narrow infrastructure failures such as zero-token terminal continuation, explicit server disconnect, and selected upstream 5xx failures.

Normal wrong answers and ordinary token-producing deadline timeouts are not infrastructure retries.

### SuperClaw Infra Signatures v2

The detector recognizes narrow orchestration signatures including:

```text
child completed → parent stops at continuation/step_start
zero-progress step_start timeout
extreme success + zero-token + empty-output anomaly
```

This is benchmark-layer detection/recovery, not a claim that SuperClaw's internal continuation state machine was repaired.

### Resume Support

Interrupted runs can continue from an existing run directory instead of restarting persisted tasks.

### Judge 8192 Budget

The PinchBench Judge completion budget was raised from 2048 to 8192 tokens so Claude Opus 5 can complete grading JSON. This does not change the rubric or Agent output.

### Judge Parse Retry

A deterministic grading control-flow bug was corrected so an unparsable first Judge response can reach the already-intended second attempt.

### Windows Git Bash Wrapper v2

POSIX grading commands that assumed `/bin/bash -c` are routed through Git for Windows Bash on Windows.

## 5. `grading-overrides/`

The final tested tree contains modified:

```text
lib_agent.py
lib_grading.py
```

based on the pinned PinchBench source.

They are stored as explicit overlays rather than copying the entire `skill/` checkout into this framework directory.

`lib_agent.py` carries the final Judge output-budget behavior.

`lib_grading.py` carries the final grading-side Windows/Judge fixes, including Judge parse retry and Windows Git Bash wrapper v2.

These overlays must be audited against the pinned PinchBench commit before use on a different PinchBench revision.

## 6. `tools/recovery/`

Current local files:

```text
check_pinchbench_grades_only.py
diagnose_openrouter_judge_one.py
patch_pinchbench_judge_budget_8192.py
patch_pinchbench_windows_bash_wrapper_v2.py
patch_superclaw_resume_run.py
regrade_superclaw_final_workflow.py
regrade_superclaw_partial_v2.py
```

`check_pinchbench_grades_only.py` performs grading-only checks against frozen Agent outputs.

`diagnose_openrouter_judge_one.py` captures focused Judge diagnostics.

The three `patch_*` files are historical installers for final compatibility behavior already represented in the canonical files.

`regrade_superclaw_partial_v2.py` supports controlled regrading of frozen Agent outputs.

`regrade_superclaw_final_workflow.py` is retained from the actual local recovery tool bundle as provenance/support; audit the script before reusing it on a different run.

These utilities are not automatically replayed when the canonical final Runner/grading overlays are already present.

## 7. `tools/infra-recovery/`

This directory preserves the strict infrastructure-recovery workflow:

```text
scan_superclaw_infra_anomalies.py
run_superclaw_infra_recovery.py
merge_superclaw_infra_recovery.py
pack_superclaw_infra_adjusted_report.py
patch_superclaw_infra_signatures_v2.py
```

The workflow keeps the strict observed result separate from the infrastructure-adjusted result instead of silently overwriting it.

Strict observed:

```text
74.086%
```

Infrastructure-adjusted:

```text
77.528%
```

The methodology uses a narrow anomaly detector and one fresh recovery for qualifying infrastructure anomalies; it is not repeated best-of-N sampling.

## 8. `experiments/timeout-sensitivity-2x/`

Separate experiment, not the baseline benchmark definition.

Current local files:

```text
audit_superclaw_timeout_stack.py
run_superclaw_timeout_sensitivity_2x.py
merge_superclaw_timeout_sensitivity_2x.py
regrade_timeout_sensitivity_grade_errors.py
pack_superclaw_timeout_sensitivity_2x.py
```

Experimental variable:

```text
baseline:
network timeout = 300 s
non-network multiplier = 3.0

2× experiment:
network timeout = 600 s
non-network multiplier = 6.0
```

Only timed-out tasks were targeted. Experimental results must remain labeled as timeout-sensitivity results.

## 9. `archive/migration-patches/`

Standalone patch files found on the tested machine:

```text
patch_superclaw_agent_infra_retry_only.py
patch_pinchbench_judge_parse_retry.py
patch_superclaw_windows_utf8_mode.py
patch_pinchbench_grading_windows_recovery.py
```

They are historical provenance, not a required sequential install chain.

An older combined patch named `patch_superclaw_runner_reliability.py` was explicitly superseded by narrower Agent-infrastructure and Judge-root-cause fixes and is not part of the canonical stack.

## 10. Why `SuperClawProjects/` Is Not the Canonical Benchmark Source

The machine also contained:

```text
C:\Users\leon\SuperClawProjects\
```

with development/smoke/run workspaces such as:

```text
kimi_proxy_test/
pinchbench_cloud_smoke/
pinchbench_smoke/
pinchbench_smoke2/
pinchbench_runs/
tmp/
```

Those are not the final benchmark source tree.

The benchmark-specific final working tree was under:

```text
C:\Users\leon\Downloads\pinchbench-superclaw-fixed-2.0.0
```

`SuperClawProjects\confidential` must never be committed.

The small `opencode.jsonc` found under `SuperClawProjects` is not required by the documented final Runner chain and is not part of the canonical upload unless separately audited and intentionally adopted later.

## 11. Shared PinchBench Runtime

The repository-wide shared environment lives under:

```text
agent-benchmark-lab/pinchbench/runtime/
```

A clean deployment should use the shared Python/PinchBench runtime rather than commit `.venv`, `runs`, or a duplicate full `skill` checkout.

The SuperClaw project keeps only the two grading overlays because those are part of the tested Windows/Judge compatibility state.

Pinned PinchBench commit:

```text
819384ae830492365b8363fc26bc2602e73f216d
```

## 12. Local Runtime Requirements Not Stored in Git

A reproducing machine still needs a working SuperClaw runtime providing:

```text
WSL distro: superclaw-docker
Docker container: superclaw-backend
OpenCode agent: superclaw-default
LLMRouter: http://127.0.0.1:18321
Cloud model slot: llmrouter/cloud-model
```

The cloud slot must resolve to:

```text
OpenRouter → moonshotai/kimi-k3
```

The repository does not store SuperClaw credentials, OpenRouter API keys, WSL images, Docker writable state, or router credentials.

## 13. Monitoring

The SuperClaw Runner persists:

```text
progress.jsonl
results.partial.json
results.partial.csv
```

after completed tasks.

A separate PowerShell process can tail `progress.jsonl` read-only, so a dedicated monitor source file is not required.

## 14. Result Interpretation

### Strict observed

```text
0.740864
74.086%
```

### Infrastructure-adjusted

```text
0.775279
77.528%
```

Infrastructure-adjusted status:

```text
143 tasks
112 success
30 timeout
1 error
0 remaining grade_error
```

The two scores must remain separately labeled.

## 15. Reproducibility Boundary

This project preserves:

```text
final SuperClaw-specific Runner
adjacent OpenCode/Kimi base Runner dependency
final grading overlays
Windows UTF-8 behavior
targeted Agent infra retry
infra signatures v2
resume behavior
Judge 8192 behavior
Judge parse retry
Windows Git Bash wrapper v2
strict infrastructure-recovery tooling
timeout-sensitivity experiment tooling
migration patch provenance
final benchmark identity
```

It deliberately does not preserve:

```text
.venv
formal runs
workspaces
transcripts
diagnostic ZIPs
SuperClawProjects/confidential
SuperClaw smoke workspaces
SuperClaw product credentials
OpenRouter keys
WSL/Docker runtime images
Python cache
*.bak Runner snapshots
```

The canonical benchmark source is the final current tree, not a requirement to replay every historical patch in chronological order.
