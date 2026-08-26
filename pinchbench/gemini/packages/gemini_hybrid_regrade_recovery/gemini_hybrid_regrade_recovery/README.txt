Gemini hybrid regrade recovery

Purpose:
- Fixes the eight hybrid jobs that failed before calling Opus 5 because the
  original results.json did not contain the automated breakdown.
- Extracts the exact automated scores from the frozen formal-run verbose stderr.
- Does not rerun Agent execution or recompute the automated component.
- Resumes the existing selective-regrade run after installation.

Expected existing run:
C:\pinchbench-gemini\selective-regrades\smoke_20260803_091133
