from __future__ import annotations
import argparse, datetime as dt, json, shutil, sys, time
from pathlib import Path

def load_jsonl(path: Path):
    out=[]
    if not path.exists(): return out
    for line in path.read_text(encoding="utf-8",errors="replace").splitlines():
        try:
            x=json.loads(line)
            if isinstance(x,dict): out.append(x)
        except Exception: pass
    return out

def load_rows(path: Path):
    data=json.loads(path.read_text(encoding="utf-8-sig"))
    if isinstance(data,list): return list(data),None
    if isinstance(data,dict) and isinstance(data.get("results"),list): return list(data["results"]),data
    raise SystemExit(f"Unsupported results format: {path}")

def write_rows(path,rows,wrapper):
    payload=rows if wrapper is None else dict(wrapper,completed=len(rows),results=rows)
    path.write_text(json.dumps(payload,ensure_ascii=False,indent=2),encoding="utf-8")

def main():
    ap=argparse.ArgumentParser(description="Judge-only repair for the 2x timeout experiment; Agent is never rerun.")
    ap.add_argument("root"); ap.add_argument("base_run"); ap.add_argument("--verbose",action="store_true")
    args=ap.parse_args()
    root=Path(args.root).expanduser().resolve(); base_run=Path(args.base_run).expanduser().resolve()
    marker=json.loads((base_run/"timeout_sensitivity_2x_latest.json").read_text(encoding="utf-8-sig"))
    run=Path(marker["experiment_run_dir"]).expanduser().resolve()
    sys.path.insert(0,str(root/"runner"))
    import run_pinchbench_opencode_kimi_windows as base
    import run_pinchbench_superclaw_windows as super_runner
    grader,err=base.load_pinchbench_grading(root/"skill")
    if err or grader is None: raise SystemExit(err or "Could not load grader")
    cfg=json.loads((run/"run_config.json").read_text(encoding="utf-8-sig"))
    all_tasks,_=base.load_tasks(root/"skill"/"tasks"); byid={t.task_id:t for t in all_tasks}
    final=run/"results.json"; partial=run/"results.partial.json"; source=final if final.exists() else partial
    if not source.exists(): raise SystemExit(f"No result file in {run}")
    rows,wrapper=load_rows(source)
    targets=[r for r in rows if r.get("grade_error") or r.get("score") is None]
    print(f"Experiment run: {run}\nRows: {len(rows)}\nGrade failures to regrade: {len(targets)}")
    if not targets: return 0
    stamp=dt.datetime.now().strftime("%Y%m%d_%H%M%S")
    for p in (final,partial):
        if p.exists(): shutil.copy2(p,p.with_name(p.name+f".before_grade_repair_{stamp}.bak"))
    changed={}
    for r in targets:
        tid=str(r["task_id"]); task=byid.get(tid)
        if task is None: print(f"SKIP {tid}: task not found"); continue
        execution=dict(r); execution["transcript"]=load_jsonl(run/"transcripts"/tid/"normalized.jsonl")
        t=time.monotonic()
        grade=base.grade_with_pinchbench_default(
            grader_module=grader,task=task,execution_result=execution,
            workspace=run/"workspaces"/tid,skill_dir=root/"skill",
            judge_timeout=float(cfg.get("judge_timeout") or 300.0),
            judge_model=str(cfg.get("judge_model") or "openrouter/anthropic/claude-opus-5"),
            verbose=args.verbose
        )
        old_status=r.get("status")
        r["score"]=round(float(grade.score),4) if grade.score is not None else None
        r["breakdown"]=grade.breakdown; r["grade_notes"]=grade.notes; r["grade_error"]=grade.error
        r["regraded_at"]=dt.datetime.now().isoformat(timespec="seconds"); r["regrade_elapsed"]=time.monotonic()-t
        r["status"]=old_status
        r["success"]=old_status=="success" and not bool(grade.error)
        changed[tid]=dict(r)
        print(f"{tid}: status={old_status} score={r['score']} grade_error={r['grade_error']!r}")
    for p in (final,partial):
        if p.exists():
            rr,ww=load_rows(p); rr=[changed.get(str(x.get("task_id")),x) for x in rr]
            write_rows(p,rr,ww)
            super_runner.save_csv(rr,run/("results.csv" if p==final else "results.partial.csv"))
    rr,_=load_rows(final if final.exists() else partial)
    remaining=[r for r in rr if r.get("grade_error") or r.get("score") is None]
    print(f"Grade failures remaining: {len(remaining)}")
    return 2 if remaining else 0

if __name__=="__main__":
    raise SystemExit(main())
