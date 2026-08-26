# PinchBench Regrader · Claude Opus 5 (Windows Native)

This directory contains the reproducible Windows regrading implementation used to re-evaluate frozen PinchBench Agent outputs with a new LLM Judge without rerunning the Agents.

It is not an Agent runner and it is not a benchmark-results archive. The project preserves the final active Regrader source tree, the final v1.6 migration package, the original package/provenance, source references used to construct the regrader, and readiness/support tooling.

The shared Python and PinchBench environment is maintained separately under `pinchbench/runtime/`.

---

## 1. Final Regrader Identity

Canonical active tree:

```text
C:\pinchbench-regrader
```

Final audited revision:

```text
v1.6 image_gen context bounding
```

Primary Judge used by the final historical regrade:

```text
openrouter/anthropic/claude-opus-5
```

Pinned PinchBench commit:

```text
819384ae830492365b8363fc26bc2602e73f216d
```

The final active tree is cumulative. It already contains the compatibility and audit behavior introduced during v1.1–v1.6.

A clean deployment should therefore restore the final active tree directly. It should not replay every old hotfix directory in sequence.

---

## 2. What the Regrader Does

The Regrader reads frozen Agent execution evidence and reruns only the grading layer.

It does **not** rerun:

```text
Codex
Qwen Code
OpenCode
CCB
Gemini CLI
Grok Build
```

For the original four-Agent Opus 5 regrade:

```text
25 automated tasks
97 hybrid tasks
21 llm_judge tasks
143 tasks per Agent
572 task records total
```

Regrading behavior:

```text
automated
→ preserve original automated score/breakdown

hybrid
→ preserve original automated component
→ rerun only Judge component
→ retain official hybrid weighting

llm_judge
→ rerun Judge against frozen evidence
```

The original Agent workspace and transcript remain read-only source evidence.

---

## 3. Repository Layout

Recommended repository structure:

```text
agent-benchmark-lab/
└─ pinchbench/
   ├─ runtime/
   │  └─ shared Python + PinchBench environment definition
   │
   └─ regrader/
      ├─ README.md
      ├─ .gitignore
      │
      ├─ runner/
      │  └─ final active v1.6 Regrader tree
      │
      ├─ packages/
      │  ├─ original/
      │  │  └─ original Regrader package/provenance
      │  └─ v1_6/
      │     └─ final v1.6 installer / migration package
      │
      ├─ source-reference/
      │  └─ grading/Runner/task-manifest reference material
      │
      └─ support/
         └─ readiness/
            └─ initial readiness / validation tooling
```

The repository deliberately separates:

```text
current executable source
└─ runner/

installation / migration provenance
└─ packages/

inputs used to construct and audit the regrader
└─ source-reference/

setup/readiness support
└─ support/
```

---

## 4. `runner/` — Canonical Final Active Tree

`runner/` is copied from the validated:

```text
C:\pinchbench-regrader
```

after the complete v1.6 fix chain had been installed.

This is the only directory that should be treated as the current executable Regrader implementation.

Typical final entry points include:

```text
01_preflight_regrade.ps1
02_run_regrade_smoke.ps1
03_monitor_regrade.ps1
04_run_regrade_full.ps1
05_resume_regrade.ps1
06_stop_regrade.ps1
07_finalize_regrade.ps1
08_bundle_regrade_results.ps1
regrade_pinchbench.py
```

The exact active tree in `runner/` is authoritative. Historical hotfix directories outside it are not runtime dependencies.

### Main Python Regrader

The Python Regrader is responsible for:

- reading frozen Agent results/workspaces/transcripts;
- creating scratch grading workspaces;
- preserving source evidence hashes;
- dispatching automated/hybrid/LLM Judge grading;
- storing per-task state;
- Judge transport retries;
- raw Judge-response audit;
- Windows-safe atomic writes;
- resume/stop semantics;
- final JSON/CSV/XLSX export;
- score delta and audit metadata.

---

## 5. Why v1.6 Is the Canonical Final Tree

The regrader evolved through several Windows/Judge compatibility fixes.

Those intermediate versions were necessary during development, but the final active tree is cumulative.

### v1.1

Handled successful OpenRouter responses whose visible Judge content was null/empty, with conditional completion-budget expansion while preserving the original first request.

### v1.2

Improved Judge parse/length recovery and isolated failed-task canary behavior.

### v1.3

Preserved pre-existing automated-grader `N/A` instead of incorrectly forcing those tasks into Judge regrading.

### v1.4 / v1.4.1

Added Windows-safe atomic file replacement and lock retry behavior for files such as:

```text
heartbeat.json
```

This prevents a read-only monitor, antivirus scanner, or another transient file handle from crashing the main queue.

### v1.5

Established the final judge-only audit cleanup policy:

```text
pure automated:
preserve original score/breakdown

hybrid:
preserve automated component
rerun Judge component only

official grade_task:
unchanged

official hybrid weights:
unchanged
```

It also retained Judge/network compatibility behavior and corrected final version identity in exports.

### v1.6

Added bounded workspace evidence specifically for the `task_image_gen` Judge context problem.

The observed failure was caused by grading evidence expanding to roughly 1.65 million input tokens, above the endpoint context limit, because dependency trees such as `.venv` / `site-packages` were being recursively read.

v1.6 limits that evidence while preserving the original task facts and grading policy.

The final v1.6 behavior includes:

```text
exclude .venv / site-packages / cache / dependency trees
record whether robot_cafe.png exists
read at most 40 relevant small text files
workspace text cap: 120,000 characters
preserve original automated checks
do not change task
do not change rubric
do not change Judge model
do not change grading weights
do not change parser
do not use automatic context-compression plugins
```

This is why `runner/` should be restored directly from the final active tree instead of rebuilding by replaying v1.1 → v1.6.

---

## 6. `packages/v1_6/`

This directory preserves the final incremental installer/migration package that produced the last active revision.

Historical package identity:

```text
pinchbench_regrader_v1_6_image_gen_context_fix*
```

Its purpose is provenance and forensic reconstruction.

It is **not** the preferred clean-machine installation path when the repository already contains the complete final `runner/` tree.

The preferred deployment is:

```text
GitHub runner/
→
C:\pinchbench-regrader
```

---

## 7. `packages/original/`

This directory preserves the original Regrader package from which the active tree was first built.

Its value is:

- provenance;
- comparison with the final tree;
- reconstructing early behavior;
- auditing what later compatibility layers changed.

It is not the current runtime.

---

## 8. `source-reference/`

This directory contains the source material originally collected to construct and validate the Regrader.

It may contain references such as:

```text
formal Agent Runner sample
PinchBench scripts/lib_grading.py
related grading modules
tasks/manifest.yaml
sample run_config.json
sample results.json
```

The purpose of this directory is to document the grading contract that the Regrader was designed to preserve.

It is not a replacement for the shared canonical PinchBench checkout under:

```text
C:\pinchbench-runtime\skill
```

The shared runtime commit remains authoritative for a new deployment.

---

## 9. `support/readiness/`

Readiness tooling was used before the first formal regrade to validate:

- source run directories;
- expected 143-task sets;
- workspaces;
- PinchBench commit;
- grading imports;
- Judge credentials;
- environment consistency.

It is useful when diagnosing a new machine but is not part of the per-task grading engine.

---

## 10. Shared `pinchbench/runtime`

The Regrader no longer carries its own canonical Python virtual environment or PinchBench checkout.

Repository environment definition:

```text
agent-benchmark-lab/pinchbench/runtime/
```

Windows runtime:

```text
C:\pinchbench-runtime\
├─ .venv\
└─ skill\
```

Canonical Python:

```text
C:\pinchbench-runtime\.venv\Scripts\python.exe
```

Pinned PinchBench commit:

```text
819384ae830492365b8363fc26bc2602e73f216d
```

This keeps framework/regrader source separate from shared benchmark dependencies.

---

## 11. Run-State Directories Are Not Project Source

Do not treat the historical:

```text
C:\pinchbench-regrades
```

as Regrader source code.

A formal regrade RunDir contains execution state such as:

```text
state.sqlite
heartbeat.json
task_results/
worker_logs/
judge_raw_responses/
scratch/
final exports
```

Those files are benchmark evidence and operational state.

They can be archived separately or attached to a release/report, but they should not be mixed into the canonical source tree.

---

## 12. Historical Hotfix Directories Are Not Current Runtime

The development machine may still contain:

```text
pinchbench-regrader-canary-v1_1
pinchbench-regrader-hotfix-v1_1
pinchbench-regrader-hotfix-v1_2
pinchbench-regrader-hotfix-v1_3
pinchbench-regrader-hotfix-v1_4
pinchbench-regrader-hotfix-v1_4_1
pinchbench-regrader-hotfix-v1_5
```

They document the troubleshooting timeline, but their behavior has already been incorporated into the final active tree.

They are therefore not required under the current canonical repository layout.

If historical preservation is required, Git history or a separate archival release is preferable to presenting them as active deployment steps.

---

## 13. Backup Directories Are Not Source

Do not commit automatic backup directories such as:

```text
pinchbench-regrader-backup-*
backup-before-v1.*
```

They are point-in-time copies created before migrations.

The final Git tree itself provides a cleaner, content-addressable history.

---

## 14. Formal Regrade Lifecycle

The normal lifecycle is:

```text
shared runtime ready
    ↓
final Regrader tree restored
    ↓
preflight
    ↓
12-job smoke
    ↓
new formal regrade RunDir
    ↓
monitor
    ↓
safe stop / resume if needed
    ↓
all task records reach terminal state
    ↓
finalize
    ↓
bundle results
```

When changing Judge models, create a new formal Regrade RunDir.

Do not change `judge_model` in the middle of an existing frozen regrade run.

---

## 15. Regrade State and Resume Semantics

The Regrader uses persistent per-task state.

A resume should:

```text
preserve completed tasks
continue pending tasks
optionally retry failed tasks only when explicitly requested
reuse the same state.sqlite
avoid rerunning successful Judge jobs
```

Starting `04_run_regrade_full.ps1` again creates a new formal run and is not equivalent to resume.

---

## 16. Judge Transport Compatibility

The final active tree retains narrow compatibility handling for Judge transport problems.

Examples:

```text
HTTP success + null/empty content
finish_reason=length
temporary network read failure
```

Conditional completion-budget expansion can occur only when the compatibility condition is met.

The initial Judge request remains the original policy:

```text
temperature = 0
same system prompt
same task prompt
same rubric
same parser
same grading weights
```

Raw Judge responses are retained for audit.

---

## 17. Automated N/A Preservation

If a frozen Agent run already had an automated-grader failure represented as `N/A`, the Regrader preserves that fact.

It does not silently convert the original automated failure into:

```text
0
```

and it does not ask the new Judge to substitute for an automated grader.

This preserves the "change Judge only" evaluation boundary.

---

## 18. Windows Atomic-Write Protection

The final tree includes Windows-safe JSON/state writes.

It handles transient:

```text
PermissionError
WinError 5
WinError 32
```

around file replacement by using unique temporary files and short retries.

This protects the queue from benign contention caused by:

- progress monitors;
- antivirus;
- indexers;
- backup scanners.

It does not change grading semantics.

---

## 19. Reproducibility Boundary

This project preserves:

```text
final active Regrader source
v1.6 migration provenance
original package provenance
grading/source reference material
readiness support tools
version identity
Windows/Judge compatibility behavior
```

It does not preserve as source:

```text
OPENROUTER_API_KEY
Python virtualenv
duplicate PinchBench checkout
formal regrade RunDirs
state.sqlite
Judge raw-response archives
scratch workspaces
logs
automatic backups
obsolete hotfix chains
```

Final reproducible identity:

```text
PinchBench Regrader
+
final active v1.6 image_gen context bounding tree
+
shared PinchBench runtime
819384ae830492365b8363fc26bc2602e73f216d
+
Claude Opus 5 Judge for the historical audited run
+
Windows-safe state / transport compatibility
```
