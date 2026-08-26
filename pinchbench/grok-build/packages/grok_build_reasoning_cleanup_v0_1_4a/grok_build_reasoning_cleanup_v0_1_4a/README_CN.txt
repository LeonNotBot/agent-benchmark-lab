Reasoning Summary Cleanup v0.1.4a
=================================

Why the original cleanup refused
--------------------------------
The task result/transcript saved the generic OpenRouter failure:
    Invalid Responses API request

The detailed schema path:
    reasoning.summary
    expected array, received undefined

was recorded in the Adapter log rather than repeated in each task's stderr.
The old cleanup incorrectly required every detail to appear in each task file.

Safety gates in v0.1.4a
-----------------------
Before changing progress, it requires:
1. A successful isolated task_deep_research run through Adapter v0.1.4.
2. wasm_research.md exists and is at least 1000 bytes.
3. Current task_deep_research and task_oss_alternative_research rows each have:
   - success=false
   - status=error
   - nonzero return code
   - score=0
   - task-level Invalid Responses API request evidence
4. The Adapter log contains at least two detailed
   expected-array / summary schema failures.
5. task_pricing_research remains absent from current progress.

It then backs up all affected state and removes only the two current failed rows.
The previously absent task_pricing_research remains pending for resume.
