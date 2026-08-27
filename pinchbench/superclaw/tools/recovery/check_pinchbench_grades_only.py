from __future__ import annotations
import argparse, json, sys
from pathlib import Path

def load_jsonl(path: Path):
    out=[]
    if path.exists():
        for line in path.read_text(encoding="utf-8").splitlines():
            try: x=json.loads(line)
            except Exception: continue
            if isinstance(x,dict): out.append(x)
    return out

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("root")
    ap.add_argument("run_dir")
    ap.add_argument("task_ids", nargs="+")
    args=ap.parse_args()
    root=Path(args.root).resolve()
    run=Path(args.run_dir).resolve()
    sys.path.insert(0,str(root/"runner"))
    import run_pinchbench_opencode_kimi_windows as base

    grader,err=base.load_pinchbench_grading(root/"skill")
    if err or grader is None: raise SystemExit(err or "grader load failed")
    tasks,_=base.load_tasks(root/"skill"/"tasks")
    byid={t.task_id:t for t in tasks}
    cfg=json.loads((run/"run_config.json").read_text(encoding="utf-8"))
    payload=json.loads((run/"results.partial.json").read_text(encoding="utf-8"))
    rb={r["task_id"]:r for r in payload.get("results",[])}

    for tid in args.task_ids:
        task=byid[tid]; old=rb[tid]
        execution=dict(old)
        execution["transcript"]=load_jsonl(run/"transcripts"/tid/"normalized.jsonl")
        grade=base.grade_with_pinchbench_default(
            grader_module=grader, task=task, execution_result=execution,
            workspace=run/"workspaces"/tid, skill_dir=root/"skill",
            judge_timeout=float(cfg.get("judge_timeout") or 300),
            judge_model=str(cfg.get("judge_model") or "openrouter/anthropic/claude-opus-5"),
            verbose=True,
        )
        print(f"{tid}: old={old.get('score')} new={grade.score} error={grade.error!r}")
        print("breakdown=", json.dumps(grade.breakdown, ensure_ascii=False))
        print("notes=", grade.notes)

if __name__=="__main__":
    main()
