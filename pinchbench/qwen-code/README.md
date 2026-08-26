# Qwen Code + DeepSeek V4 Pro · PinchBench (Windows Native)

This directory contains the reproducible Windows implementation used to benchmark **Qwen Code + OpenRouter + DeepSeek V4 Pro** with PinchBench.

It is not a copy of the installed Qwen Code `node_modules`, and it is not a benchmark-results archive. The repository keeps the benchmark-specific Runner, Windows compatibility behavior, non-secret environment identity, CLI package provenance, and useful preflight references required to understand and rebuild the tested stack.

The shared Python and PinchBench environment is maintained separately under `pinchbench/runtime/`.

---

## 1. Final Benchmark Identity

| Item | Final value |
|---|---|
| Platform | Windows Native |
| Qwen Code | `0.20.1` |
| Tested model | `deepseek/deepseek-v4-pro` |
| Provider / auth type | OpenRouter / `openai` |
| Approval mode | `yolo` |
| Safe Mode | enabled |
| Runner revision | `2026-07-24-qwen-code-windows-v2-session-first-turn-fix` |
| PinchBench commit | `819384ae830492365b8363fc26bc2602e73f216d` |
| Suite | `all` |
| Selected tasks | `143` |
| Worker | `1` |
| Task concurrency | `1` |
| Network timeout | `300 s` |
| Normal-task timeout | task timeout × `3.0` |
| Prompt transport | UTF-8 stdin |
| Output transport | Qwen Code `stream-json` |
| Original Runner Judge default | `openrouter/anthropic/claude-haiku-4.5` |
| Frozen-output regrade Judge | `openrouter/anthropic/claude-opus-5` |
| Windows Python mode | UTF-8 (`-X utf8`) |

Final Agent path:

```text
PinchBench
    ↓
Qwen Code Windows Runner v2
    ↓
Qwen Code 0.20.1
    ↓
OpenRouter
    ↓
deepseek/deepseek-v4-pro
```

---

## 2. Repository Layout

```text
agent-benchmark-lab/
└─ pinchbench/
   ├─ runtime/
   │  └─ shared Python + PinchBench environment definition
   │
   └─ qwen-code/
      ├─ README.md
      ├─ .gitignore
      ├─ runner/
      ├─ manifests/
      │  ├─ environment/
      │  └─ qwen-cli/
      └─ support/
         └─ preflight-reference/
```

The repository separates:

```text
Canonical benchmark code
└─ runner/

Reproducibility / version identity
└─ manifests/

Historical setup and manual validation reference
└─ support/preflight-reference/
```

---

## 3. `runner/` — Canonical Windows Runner

The current local Runner directory contains the benchmark-specific source and wrappers used by the final Qwen Code run.

Important files include:

```text
run_pinchbench_qwen_code_windows.py
run_qwen_code_smoke.ps1
monitor_pinchbench_qwen_code_windows.ps1
README_QWEN_CODE_WINDOWS_RUNNER*
```

All current README variants in the tested Runner directory are retained as package/provenance documentation. They are not separate runtime layers.

### `run_pinchbench_qwen_code_windows.py`

This is the core benchmark Runner.

It is responsible for:

- loading the pinned PinchBench task manifest;
- staging isolated workspaces;
- invoking the pinned Qwen Code executable;
- explicitly selecting `--auth-type openai`;
- explicitly selecting `deepseek/deepseek-v4-pro`;
- using `stream-json`;
- separating/normalizing Qwen events;
- capturing `session_id`;
- handling multi-turn resume;
- applying task/network timeouts;
- collecting token and tool-call metadata;
- invoking PinchBench grading;
- writing JSON / CSV / XLSX results;
- writing `progress.jsonl`;
- preserving workspaces and transcripts.

Canonical Runner revision:

```text
2026-07-24-qwen-code-windows-v2-session-first-turn-fix
```

---

## 4. Runner v2 Session Fix

The original multi-session implementation failed because the first executable turn of a multi-session task could incorrectly be treated as requiring an existing session.

The v2 Runner establishes the final behavior:

```text
First executable turn:
fresh Qwen session

Later turn:
resume previous session_id

Metadata explicitly requesting new_session:
start a new session
```

Conceptually:

```text
Turn 1
initial implementation
    ↓
fresh session
    ↓
capture session_id

Turn 2
follow-up
    ↓
--resume <session_id>

Turn 3
follow-up
    ↓
--resume <session_id>
```

This is not an optional historical patch. It is part of the current canonical Python Runner.

The old Runner is therefore not required as a runtime dependency.

---

## 5. Windows UTF-8 Execution Requirement

A second important Windows-specific finding was that:

```python
os.environ.setdefault("PYTHONUTF8", "1")
```

inside the Python file is too late to change the current Python interpreter's default text encoding.

The final Windows execution therefore launches the Runner with:

```text
python -X utf8
```

and also uses:

```text
PYTHONUTF8=1
PYTHONIOENCODING=utf-8
```

This is an environment-compatibility requirement, not a benchmark-behavior modification.

It does not change:

- task prompts;
- model;
- grader;
- task weights;
- workspace;
- timeouts;
- Agent policy.

It only ensures UTF-8 task files and generated text are handled correctly on Windows systems whose legacy default encoding may otherwise be CP936.

---

## 6. `run_qwen_code_smoke.ps1`

Smoke-test wrapper for the canonical Runner.

It is used before a full run to verify:

- Qwen CLI startup;
- OpenRouter route;
- DeepSeek model identity;
- Qwen JSON event parsing;
- file/tool execution;
- multi-session behavior;
- grader integration.

The final smoke must exercise both ordinary and multi-session behavior.

---

## 7. `monitor_pinchbench_qwen_code_windows.ps1`

Read-only progress monitor.

It discovers the active/latest:

```text
qwen_code_*
```

run directory and reports benchmark progress.

The monitor does not alter the Runner, workspace, task state, or score.

`Ctrl+C` stops only the monitor.

---

## 8. Safe Mode

The final Runner uses Qwen Code Safe Mode.

Safe Mode disables user customizations such as:

```text
hooks
extensions
skills
MCP servers
QWEN.md
```

This is important for framework comparability because the benchmark is intended to evaluate the default Qwen Code Agent/tool behavior rather than a user-personalized Qwen environment.

The canonical run must not add:

```text
--no-safe-mode
```

unless intentionally running a different experimental configuration.

---

## 9. Qwen Code Authentication

OpenRouter is used through Qwen Code's OpenAI-compatible provider route.

Canonical authentication mode:

```text
--auth-type openai
```

The Runner passes the auth type explicitly in non-interactive mode rather than depending on mutable `qwen-home` settings.

This was necessary because an invalid `settings.json` could be automatically reset, after which headless Qwen Code no longer knew which auth type to use.

The benchmark repository therefore does not rely on a committed `qwen-home`.

---

## 10. `manifests/environment/`

This directory preserves the non-secret environment identity captured during setup.

The original tested machine created files such as:

```text
qwen_requested_version.txt
qwen_installed_version.txt
qwen_package_metadata.json
environment_non_secret.json
```

These describe:

- requested Qwen Code version;
- installed Qwen Code version;
- npm package metadata;
- non-secret Windows/runtime identity.

These files are provenance, not runtime configuration.

No API key or authentication token should be stored here.

---

## 11. `manifests/qwen-cli/`

The installed directory:

```text
C:\pinchbench-qwen-code\qwen-cli
```

contains the local npm installation and `node_modules`, so it is not copied into this repository.

Instead, the repository preserves the package-definition files that identify the exact installation:

```text
package.json
package-lock.json
version.txt
```

This gives a reproducible npm dependency lock without vendoring the entire installed dependency tree.

Canonical version:

```text
0.20.1
```

The actual executable used by the tested machine was:

```text
C:\pinchbench-qwen-code\qwen-cli\node_modules\.bin\qwen.cmd
```

The path itself is local-machine state; the version/lock is the reproducibility asset.

---

## 12. `support/preflight-reference/`

The original setup used manual preflight workspaces before the final Runner was validated.

Examples included:

```text
basic/
tool_write/
session_resume/
```

These were used to establish:

- Qwen CLI could call DeepSeek successfully;
- `stream-json` contained a valid session ID;
- file-writing tools worked;
- session resume worked independently of the PinchBench Runner.

These files are retained as validation reference, not as part of the 143-task formal run.

They are useful when diagnosing a future regression because they separate:

```text
Qwen CLI/provider problem
vs.
Runner implementation problem
vs.
PinchBench task behavior
```

---

## 13. Directories Not Stored as Project Source

The local tested machine also contains:

```text
environment/
logs/
preflight/
qwen-cli/
qwen-home/
qwen-runtime/
runner/
runs/
skill/
```

Only the source/provenance portions are represented in this repository.

### `qwen-home/`

Not committed.

It contains mutable local Qwen configuration and may contain authentication or machine-specific state.

### `qwen-runtime/`

Not committed.

It is Qwen Code runtime/session state, not benchmark source.

### `qwen-cli/`

The installed `node_modules` tree is not committed.

Only package manifests/lock/version are preserved.

### `runs/`

Not committed.

Contains benchmark outputs, workspaces, transcripts, result files, and execution evidence.

### `logs/`

Not committed.

Contains console/probe/runtime logs.

### `skill/`

Not committed here.

The current project uses the shared PinchBench checkout under:

```text
C:\pinchbench-runtime\skill
```

and repository environment definition under:

```text
pinchbench/runtime/
```

---

## 14. Shared `pinchbench/runtime`

The Qwen Code project no longer owns a separate Python virtual environment or canonical PinchBench checkout.

Shared runtime:

```text
C:\pinchbench-runtime\
├─ .venv\
└─ skill\
```

Canonical Python:

```text
C:\pinchbench-runtime\.venv\Scripts\python.exe
```

Canonical PinchBench commit:

```text
819384ae830492365b8363fc26bc2602e73f216d
```

This separates:

```text
framework-specific source
from
shared benchmark/runtime dependencies
```

---

## 15. Default Excluded Tasks

The independent Windows run excludes the same four external-integration tasks:

```text
task_gh_issue_triage
task_gws_email_triage
task_gws_cross_service
task_gws_task_management
```

They require external GitHub / Google Workspace integration tooling and credentials that were outside this framework-comparison environment.

---

## 16. Historical Full-Run Result

The canonical Qwen Code v2 run:

```text
Qwen Code:
0.20.1

Runner:
2026-07-24-qwen-code-windows-v2-session-first-turn-fix

Tasks:
143

Execution success:
136 / 143
95.10%

Execution failures:
7 timeouts

Scored:
142

Original benchmark mean:
0.9039

Opus 5 regraded mean:
0.8696
```

The 7 execution failures were timeouts. The final multi-session tasks succeeded after the v2 session fix.

The checked-in v2 Runner's original Judge default is `openrouter/anthropic/claude-haiku-4.5`. The Opus 5 score belongs to the separate frozen-output regrading layer and does not change the Agent execution recorded by this Runner. Do not mix the original Haiku score and the Opus 5 regraded score without labeling the grading policy.

---

## 17. Reproducibility Boundary

This directory preserves:

```text
canonical Qwen Windows Runner
session-first-turn fix
smoke wrapper
monitor
Runner package documentation
non-secret environment identity
Qwen npm package lock/metadata
manual preflight reference
```

It deliberately does not preserve:

```text
OPENROUTER_API_KEY
Qwen authentication state
qwen-home runtime config
qwen-runtime session/cache state
node_modules
PinchBench duplicate checkout
Python virtualenv
formal runs
logs
workspaces
transcripts
Python cache
```

Final reproducible identity:

```text
Qwen Code 0.20.1
+
Windows Runner v2
2026-07-24-qwen-code-windows-v2-session-first-turn-fix
+
Python UTF-8 mode
+
Safe Mode
+
OpenAI-compatible OpenRouter auth route
+
DeepSeek V4 Pro
+
PinchBench
819384ae830492365b8363fc26bc2602e73f216d
+
single-worker serial execution
```
