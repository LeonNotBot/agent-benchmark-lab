from __future__ import annotations

import argparse
import datetime as dt
import json
import sys
import time
from pathlib import Path

FORCE_REGRADES = {
    "task_shell_command_generator",
    "task_git_rescue_recovery",
}

def load_jsonl(path: Path) -> list[dict]:
    out = []
    if not path.exists():
        return out
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            item = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(item, dict):
            out.append(item)
    return out

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("root")
    ap.add_argument("run_dir")
    ap.add_argument("--verbose", action="store_true")
    args = ap.parse_args()

    root = Path(args.root).expanduser().resolve()
    run_dir = Path(args.run_dir).expanduser().resolve()
    runner_dir = root / "runner"
    skill_dir = root / "skill"
    tasks_dir = skill_dir / "tasks"

    sys.path.insert(0, str(runner_dir))
    import run_pinchbench_opencode_kimi_windows as base
    import run_pinchbench_superclaw_windows as super_runner

    grader_module, grader_error = base.load_pinchbench_grading(skill_dir)
    if grader_error or grader_module is None:
        raise SystemExit(grader_error or "Could not load grader")

    cfg = json.loads((run_dir / "run_config.json").read_text(encoding="utf-8"))
    partial_path = run_dir / "results.partial.json"
    if not partial_path.exists():
        raise SystemExit(f"NOT FOUND: {partial_path}")
    payload = json.loads(partial_path.read_text(encoding="utf-8"))
    results = list(payload.get("results") or [])

    all_tasks, _ = base.load_tasks(tasks_dir)
    task_by_id = {t.task_id: t for t in all_tasks}

    cache_dir = run_dir.parent / ".judge_cache"
    if hasattr(grader_module, "set_judge_cache_dir"):
        grader_module.set_judge_cache_dir(cache_dir)

    targets = [
        r for r in results
        if r.get("grade_error")
        or r.get("score") is None
        or r.get("task_id") in FORCE_REGRADES
    ]

    print(f"Regrading {len(targets)} persisted tasks; agent execution will NOT be rerun.")
    changed = 0

    for r in targets:
        tid = r.get("task_id")
        task = task_by_id.get(tid)
        if task is None:
            print(f"SKIP {tid}: task definition not found")
            continue

        workspace = run_dir / "workspaces" / tid
        transcript = load_jsonl(run_dir / "transcripts" / tid / "normalized.jsonl")
        execution = dict(r)
        execution["transcript"] = transcript

        started = time.monotonic()
        grade = base.grade_with_pinchbench_default(
            grader_module=grader_module,
            task=task,
            execution_result=execution,
            workspace=workspace,
            skill_dir=skill_dir,
            judge_timeout=float(cfg.get("judge_timeout") or 300.0),
            judge_model=str(cfg.get("judge_model") or "openrouter/anthropic/claude-opus-5"),
            verbose=args.verbose,
        )
        elapsed = time.monotonic() - started

        old_score = r.get("score")
        old_status = r.get("status")
        old_execution_error = r.get("error")

        r["score"] = round(float(grade.score), 4) if grade.score is not None else None
        r["breakdown"] = grade.breakdown
        r["grade_notes"] = grade.notes
        r["grade_error"] = grade.error
        r["regraded_at"] = dt.datetime.now().isoformat(timespec="seconds")
        r["regrade_elapsed"] = elapsed

        execution_status = old_status
        if old_status == "grade_error" and not old_execution_error and r.get("returncode") in (0, None):
            execution_status = "success"

        if grade.error:
            r["success"] = False
            r["status"] = "grade_error" if execution_status == "success" else execution_status
        else:
            r["status"] = execution_status
            r["success"] = execution_status == "success"

        changed += 1
        print(
            f"{tid}: {old_status}/{old_score} -> {r.get('status')}/{r.get('score')} "
            f"grade_error={bool(r.get('grade_error'))} ({elapsed:.1f}s)"
        )

    stamp = dt.datetime.now().strftime("%Y%m%d_%H%M%S")
    backup = run_dir / f"results.partial.before_regrade_v2_{stamp}.json"
    backup.write_text(
        json.dumps(
            {"completed": len(results), "results": json.loads(partial_path.read_text(encoding="utf-8")).get("results", [])},
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    payload["completed"] = len(results)
    payload["results"] = results
    partial_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    super_runner.save_csv(results, run_dir / "results.partial.csv")

    print(f"Updated {changed} tasks in-place.")
    print(f"Backup: {backup}")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
