PinchBench Regrader v1.6 — image_gen context bounding
========================================================

Root cause
----------
OpenRouter rejected Codex/task_image_gen because the Judge prompt requested
about 1,651,813 tokens. The frozen grader recursively concatenates every
UTF-8-readable workspace file. The Codex workspace contains 1,514 files and
about 7.1 MB, including irrelevant dependency/environment text.

This is a grading-input construction issue, not an invalid API key.

v1.6 scope
----------
Only task_image_gen receives bounded workspace evidence:
- excludes dependency/environment directories such as .venv, site-packages,
  node_modules, caches and metadata directories;
- records whether robot_cafe.png exists, plus size and SHA256 if present;
- includes at most 40 relevant small text files;
- caps workspace text at 120,000 characters;
- records a workspace_evidence_compatibility audit object.

Unchanged:
- task prompt;
- expected behavior;
- transcript summary;
- rubric;
- Opus 5 model;
- temperature;
- official parser;
- original automated breakdown;
- hybrid weights.

The OpenRouter context-compression plugin is intentionally not used because it
would introduce a second model-dependent transformation of the grading input.

Run order
---------
1. Install 01_apply_regrader_v1_6.ps1.
2. Reset only Codex/task_image_gen with 02_reset_codex_image_gen.ps1.
3. Ensure OPENROUTER_API_KEY is present.
4. Resume WITHOUT -RetryFailed.
5. Inspect task_results\Codex\task_image_gen.json.
6. Finalize and bundle again.

Expected audit fields
---------------------
worker_status = completed
new_grade_error = null/blank
workspace_evidence_compatibility.enabled = true
expected_output_present = false
included_characters <= 120000
Judge API HTTP 400 context-length error absent
