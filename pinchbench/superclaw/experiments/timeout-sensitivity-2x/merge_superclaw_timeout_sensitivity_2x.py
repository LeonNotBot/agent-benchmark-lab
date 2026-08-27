from __future__ import annotations
import argparse, csv, json
from pathlib import Path

def load_rows(path):
    data=json.loads(path.read_text(encoding="utf-8-sig"))
    if isinstance(data,list): return list(data)
    if isinstance(data,dict) and isinstance(data.get("results"),list): return list(data["results"])
    raise SystemExit(f"Unsupported format: {path}")

def main():
    ap=argparse.ArgumentParser(description="Merge the 30 timeout-only 2x results into the current final baseline, with no max-score selection.")
    ap.add_argument("base_run")
    args=ap.parse_args()
    base_run=Path(args.base_run).expanduser().resolve()
    marker=json.loads((base_run/"timeout_sensitivity_2x_latest.json").read_text(encoding="utf-8-sig"))
    baseline=load_rows(Path(marker["baseline_results"]))
    run=Path(marker["experiment_run_dir"])
    rp=run/"results.json"
    if not rp.exists(): raise SystemExit(f"Experiment not complete: {rp} not found")
    exp=load_rows(rp)
    expected=list(marker["task_ids"]); expected_set=set(expected)
    exp_by={str(x.get("task_id")):x for x in exp}
    missing=[tid for tid in expected if tid not in exp_by]
    extra=[tid for tid in exp_by if tid not in expected_set]
    if missing or extra:
        raise SystemExit(f"Task set mismatch. missing={missing} extra={extra}")
    bad=[x for x in exp if x.get("grade_error") or x.get("score") is None]
    if bad:
        raise SystemExit("Grade failures remain: "+", ".join(str(x.get("task_id")) for x in bad))
    merged=[]
    for x in baseline:
        tid=str(x.get("task_id"))
        merged.append(dict(exp_by[tid]) if tid in expected_set else dict(x))
    if len(merged)!=143: print(f"WARNING: merged row count={len(merged)}")
    scores=[float(x["score"]) for x in merged]
    baseline_score=sum(float(x["score"]) for x in baseline)/len(baseline)
    new_score=sum(scores)/len(scores)
    status_counts={}
    for x in merged: status_counts[str(x.get("status"))]=status_counts.get(str(x.get("status")),0)+1
    outj=base_run/"results.timeout_sensitivity_2x.json"
    outc=base_run/"results.timeout_sensitivity_2x.csv"
    outs=base_run/"summary.timeout_sensitivity_2x.txt"
    outj.write_text(json.dumps(merged,ensure_ascii=False,indent=2),encoding="utf-8")
    keys=[]
    for x in merged:
        for k in x:
            if k not in keys: keys.append(k)
    with outc.open("w",encoding="utf-8-sig",newline="") as f:
        w=csv.DictWriter(f,fieldnames=keys,extrasaction="ignore"); w.writeheader()
        for x in merged:
            row={k:(json.dumps(v,ensure_ascii=False) if isinstance(v,(dict,list)) else v) for k,v in x.items()}
            w.writerow(row)
    text=(
        f"Baseline final score: {baseline_score:.6f} ({baseline_score*100:.3f}%)\n"
        f"2x timeout-sensitivity score: {new_score:.6f} ({new_score*100:.3f}%)\n"
        f"Delta: {(new_score-baseline_score)*100:+.3f} pp\n"
        f"Replaced timeout tasks: {len(expected)}\n"
        f"Status counts: {status_counts}\n"
        "Merge policy: all 30 selected timeout-task results are replaced by their single 2x-condition result; never choose max(old,new).\n"
    )
    outs.write_text(text,encoding="utf-8")
    print(text)
    print(outj); print(outc); print(outs)
    return 0

if __name__=="__main__":
    raise SystemExit(main())
