from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path
from typing import Any

def load_results_file(run_dir: Path) -> tuple[list[dict[str, Any]], Path]:
    for name in ("results.json", "results.partial.json"):
        p = run_dir / name
        if not p.exists():
            continue
        data = json.loads(p.read_text(encoding="utf-8"))
        if isinstance(data, list):
            return data, p
        if isinstance(data, dict) and isinstance(data.get("results"), list):
            return data["results"], p
    raise SystemExit(f"No results file in {run_dir}")

def write_union_csv(rows: list[dict[str, Any]], path: Path) -> None:
    preferred = [
        "task_id","name","category","grading_type","model","agent","network_task",
        "success","status","score","agent_elapsed","grading_elapsed","end_to_end_elapsed",
        "ttft","input_tokens","output_tokens","reasoning_tokens","cache_read_tokens",
        "cache_write_tokens","total_tokens","cost_usd","step_count","tool_errors",
        "agent_infra_retries_used","infra_recovery_applied","infra_recovery_reason",
        "infra_recovery_original_status","infra_recovery_original_score",
        "infra_recovery_source_run","error","grade_error",
    ]
    keys = set()
    for r in rows:
        keys.update(r.keys())
    fields = [k for k in preferred if k in keys] + sorted(keys - set(preferred))
    with path.open("w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
        w.writeheader()
        for r in rows:
            out = {}
            for k in fields:
                v = r.get(k)
                if isinstance(v, (dict, list)):
                    v = json.dumps(v, ensure_ascii=False)
                out[k] = v
            w.writerow(out)

def mean_all(rows: list[dict[str, Any]]) -> float:
    if not rows:
        return 0.0
    return sum(float(r.get("score") or 0.0) for r in rows) / len(rows)

def main() -> int:
    ap = argparse.ArgumentParser(
        description="Create separate infrastructure-adjusted results; original results.json is never overwritten."
    )
    ap.add_argument("root")
    ap.add_argument("base_run")
    ap.add_argument("--recovery-run", default=None)
    ap.add_argument("--plan", default=None)
    args = ap.parse_args()

    root = Path(args.root).expanduser().resolve()
    base_run = Path(args.base_run).expanduser().resolve()
    plan_path = Path(args.plan).expanduser().resolve() if args.plan else base_run / "infra_recovery_plan.json"
    plan = json.loads(plan_path.read_text(encoding="utf-8"))

    eligible_ids = list(plan.get("eligible_task_ids") or [])
    reasons = {
        x["task_id"]: ",".join(x.get("categories") or [])
        for x in plan.get("classifications", [])
        if x.get("eligible_for_one_fresh_retry")
    }

    if args.recovery_run:
        recovery_run = Path(args.recovery_run).expanduser().resolve()
    else:
        marker_path = base_run / "infra_recovery_latest.json"
        if not marker_path.exists():
            raise SystemExit("No --recovery-run and infra_recovery_latest.json not found.")
        marker = json.loads(marker_path.read_text(encoding="utf-8"))
        recovery_run = Path(marker["recovery_run_dir"]).resolve()

    base_rows, base_path = load_results_file(base_run)
    rec_rows, rec_path = load_results_file(recovery_run)
    rec_by = {r["task_id"]: r for r in rec_rows}

    missing = [tid for tid in eligible_ids if tid not in rec_by]
    if missing:
        raise SystemExit(f"Recovery results missing planned tasks: {missing}")

    grading_bad = [
        tid for tid in eligible_ids
        if rec_by[tid].get("grade_error") or rec_by[tid].get("score") is None
    ]
    if grading_bad:
        raise SystemExit(
            "Recovery Agent execution exists, but grading is incomplete for: "
            + ", ".join(grading_bad)
            + ". Fix/regrade those recovery rows before merging."
        )

    adjusted = []
    replacements = []
    eligible_set = set(eligible_ids)

    for original in base_rows:
        tid = original["task_id"]
        if tid not in eligible_set:
            adjusted.append(dict(original))
            continue

        recovered = dict(rec_by[tid])
        recovered["infra_recovery_applied"] = True
        recovered["infra_recovery_reason"] = reasons.get(tid, "")
        recovered["infra_recovery_original_status"] = original.get("status")
        recovered["infra_recovery_original_score"] = original.get("score")
        recovered["infra_recovery_original_agent_elapsed"] = original.get(
            "agent_elapsed", original.get("elapsed")
        )
        recovered["infra_recovery_source_run"] = str(recovery_run)
        adjusted.append(recovered)

        replacements.append({
            "task_id": tid,
            "reason": reasons.get(tid, ""),
            "original_status": original.get("status"),
            "original_score": original.get("score"),
            "recovery_status": recovered.get("status"),
            "recovery_score": recovered.get("score"),
        })

    if [r["task_id"] for r in adjusted] != [r["task_id"] for r in base_rows]:
        raise SystemExit("Task order/identity changed during merge; aborting.")

    original_mean = mean_all(base_rows)
    adjusted_mean = mean_all(adjusted)

    out_json = base_run / "results.infra_adjusted.json"
    out_csv = base_run / "results.infra_adjusted.csv"
    out_manifest = base_run / "infra_recovery_manifest.json"
    out_summary = base_run / "summary.infra_adjusted.txt"

    out_json.write_text(
        json.dumps(adjusted, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    write_union_csv(adjusted, out_csv)

    manifest = {
        "policy": plan.get("policy"),
        "original_results_file": str(base_path),
        "recovery_results_file": str(rec_path),
        "original_run": str(base_run),
        "recovery_run": str(recovery_run),
        "task_count": len(base_rows),
        "replacement_count": len(replacements),
        "original_mean": original_mean,
        "original_percent": original_mean * 100,
        "infra_adjusted_mean": adjusted_mean,
        "infra_adjusted_percent": adjusted_mean * 100,
        "delta_percentage_points": (adjusted_mean - original_mean) * 100,
        "important": (
            "Each eligible task was replaced by its ONE recovery attempt "
            "regardless of whether the score improved or worsened. "
            "Original results.json was not overwritten."
        ),
        "replacements": replacements,
    }
    out_manifest.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    out_summary.write_text(
        "\n".join([
            f"Original strict observed mean: {original_mean:.6f} ({original_mean*100:.3f}%)",
            f"Infrastructure-adjusted mean: {adjusted_mean:.6f} ({adjusted_mean*100:.3f}%)",
            f"Delta: {(adjusted_mean-original_mean)*100:+.3f} percentage points",
            f"Replaced tasks: {len(replacements)}",
            "Original results.json remains unchanged.",
            "Recovery rule: exactly one fresh attempt for predefined infrastructure signatures; "
            "the second attempt is accepted regardless of score.",
        ]) + "\n",
        encoding="utf-8",
    )

    print(f"Original strict score : {original_mean:.6f} ({original_mean*100:.3f}%)")
    print(f"Infra-adjusted score  : {adjusted_mean:.6f} ({adjusted_mean*100:.3f}%)")
    print(f"Delta                 : {(adjusted_mean-original_mean)*100:+.3f} pp")
    print(f"Replacements          : {len(replacements)}")
    for r in replacements:
        print(
            f"  {r['task_id']}: {r['original_status']}/{r['original_score']} "
            f"-> {r['recovery_status']}/{r['recovery_score']}  [{r['reason']}]"
        )
    print("Adjusted JSON         :", out_json)
    print("Adjusted CSV          :", out_csv)
    print("Manifest              :", out_manifest)
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
