from __future__ import annotations
import argparse, json, shutil, sys, time
from pathlib import Path
from datetime import datetime

def load_jsonl(path: Path):
    out=[]
    if path.exists():
        for line in path.read_text(encoding="utf-8").splitlines():
            try:
                x=json.loads(line)
            except Exception:
                continue
            if isinstance(x,dict):
                out.append(x)
    return out

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("root")
    ap.add_argument("run_dir")
    ap.add_argument("--task-id", default="task_workflow")
    ap.add_argument("--verbose", action="store_true")
    args=ap.parse_args()

    root=Path(args.root).resolve()
    run=Path(args.run_dir).resolve()
    sys.path.insert(0,str(root/"runner"))
    import run_pinchbench_opencode_kimi_windows as base
    import run_pinchbench_superclaw_windows as super_runner

    grader,err=base.load_pinchbench_grading(root/"skill")
    if err or grader is None:
        raise SystemExit(err or "grader load failed")

    tasks,_=base.load_tasks(root/"skill"/"tasks")
    byid={t.task_id:t for t in tasks}
    task=byid[args.task_id]

    final_path=run/"results.json"
    partial_path=run/"results.partial.json"
    if not final_path.exists():
        raise SystemExit(f"NOT FOUND: {final_path}")

    results=json.loads(final_path.read_text(encoding="utf-8"))
    if not isinstance(results,list):
        raise SystemExit("results.json is not a list")

    idx=next((i for i,r in enumerate(results) if r.get("task_id")==args.task_id),None)
    if idx is None:
        raise SystemExit(f"task not found in results: {args.task_id}")

    old=dict(results[idx])
    execution=dict(old)
    execution["transcript"]=load_jsonl(run/"transcripts"/args.task_id/"normalized.jsonl")

    cfg=json.loads((run/"run_config.json").read_text(encoding="utf-8"))
    started=time.monotonic()
    grade=base.grade_with_pinchbench_default(
        grader_module=grader,
        task=task,
        execution_result=execution,
        workspace=run/"workspaces"/args.task_id,
        skill_dir=root/"skill",
        judge_timeout=float(cfg.get("judge_timeout") or 300),
        judge_model=str(cfg.get("judge_model") or "openrouter/anthropic/claude-opus-5"),
        verbose=args.verbose,
    )
    elapsed=time.monotonic()-started

    new=dict(old)
    new["score"]=round(float(grade.score),4) if grade.score is not None else None
    new["breakdown"]=grade.breakdown
    new["grade_notes"]=grade.notes
    new["grade_error"]=grade.error
    new["grading_elapsed"]=elapsed
    if grade.error:
        new["status"]="grade_error"
        new["success"]=False
    else:
        # Agent itself completed successfully for task_workflow; remove grading-only failure.
        if not old.get("error") and old.get("returncode") in (0,None):
            new["status"]="success"
            new["success"]=True
    results[idx]=new

    stamp=datetime.now().strftime("%Y%m%d_%H%M%S")
    shutil.copy2(final_path, run/f"results.before_workflow_regrade_{stamp}.json")
    if partial_path.exists():
        shutil.copy2(partial_path, run/f"results.partial.before_workflow_regrade_{stamp}.json")

    final_path.write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding="utf-8")
    super_runner.save_csv(results,run/"results.csv")

    if partial_path.exists():
        partial=json.loads(partial_path.read_text(encoding="utf-8"))
        prs=partial.get("results",[]) if isinstance(partial,dict) else partial
        for i,r in enumerate(prs):
            if r.get("task_id")==args.task_id:
                prs[i]=new
                break
        if isinstance(partial,dict):
            partial["completed"]=len(prs)
            partial["results"]=prs
            partial_path.write_text(json.dumps(partial,ensure_ascii=False,indent=2),encoding="utf-8")
        else:
            partial_path.write_text(json.dumps(prs,ensure_ascii=False,indent=2),encoding="utf-8")
        super_runner.save_csv(prs,run/"results.partial.csv")

    scores=[float(r["score"]) for r in results if r.get("score") is not None]
    errors=[r for r in results if r.get("grade_error")]
    print(f"{args.task_id}: old={old.get('score')} -> new={new.get('score')} status={new.get('status')} grade_error={new.get('grade_error')!r}")
    print(f"overall_mean={sum(scores)/len(scores):.6f} ({100*sum(scores)/len(scores):.3f}%)")
    print(f"grade_errors_remaining={len(errors)}")
    print(f"regrade_elapsed={elapsed:.1f}s")

if __name__=="__main__":
    main()
