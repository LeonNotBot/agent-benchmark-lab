Grok Build Runner Adapter Gate v0.1.3
========================================

Purpose
-------
The installed Runner common script still required search Adapter version 0.1.2,
while the validated live Adapter is version 0.1.3. This caused resume to stop at
the preflight check even though the Adapter itself was healthy.

Scope
-----
This patch changes exactly one semantic condition:

    [string]$h.version -ne "0.1.2"

to:

    [string]$h.version -ne "0.1.3"

It does not modify:
- prompts;
- task results or progress;
- workspaces or transcripts;
- grading;
- model routing;
- the required target model.

Safety
------
- Confirms the live service is healthy Adapter v0.1.3.
- Requires exactly one old version-gate occurrence.
- Preserves the DeepSeek target-model check.
- Backs up the original common script.
- Reloads and executes the actual Runner preflight function after patching.

The three failed rows have already been removed and backed up. Do not execute
06_prepare_invalid_prompt_failures_for_resume.ps1 again. Resume directly after
this patch passes.
