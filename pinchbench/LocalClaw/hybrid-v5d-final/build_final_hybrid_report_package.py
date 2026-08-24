#!/usr/bin/env python3
import argparse, json, csv, math, statistics, shutil, zipfile
from pathlib import Path
from datetime import datetime

def load_json(p):
    with open(p, "r", encoding="utf-8-sig") as f:
        return json.load(f)

def num(x, default=0.0):
    try:
        if x is None or x == "":
            return default
        return float(x)
    except Exception:
        return default

def integer(x, default=0):
    try:
        if x is None or x == "":
            return default
        return int(float(x))
    except Exception:
        return default

def percentile(vals, q):
    vals = sorted(float(x) for x in vals)
    if not vals:
        return None
    if len(vals) == 1:
        return vals[0]
    pos = (len(vals)-1) * q
    lo = math.floor(pos); hi = math.ceil(pos)
    if lo == hi:
        return vals[lo]
    return vals[lo] * (hi-pos) + vals[hi] * (pos-lo)

def mean(vals):
    vals = [float(x) for x in vals]
    return sum(vals)/len(vals) if vals else None

def median(vals):
    vals = [float(x) for x in vals]
    return statistics.median(vals) if vals else None

def first_present(row, names, default=None):
    for n in names:
        if n in row and row[n] not in (None, ""):
            return row[n]
    return default

def norm_rows(obj):
    if isinstance(obj, list):
        return obj
    if isinstance(obj, dict):
        for k in ("results", "rows", "tasks"):
            if isinstance(obj.get(k), list):
                return obj[k]
    raise ValueError("Cannot locate result rows in final_results_merged_recounted.json")

def score_of(r):
    v = first_present(r, ["score", "final_score", "grade_score"])
    return None if v in (None, "") else num(v)

def status_of(r):
    return str(first_present(r, ["status", "execution_status"], "") or "").lower()

def qwen_calls(r):
    return integer(first_present(r, ["qwen_calls"], 0))

def kimi_calls(r):
    return integer(first_present(r, ["kimi_calls"], 0))

def qwen_tokens(r):
    return integer(first_present(r, ["qwen_total_tokens", "qwen_tokens"], 0))

def kimi_tokens(r):
    return integer(first_present(r, ["kimi_total_tokens", "kimi_tokens"], 0))

def total_tokens(r):
    return integer(first_present(r, ["total_tokens", "effective_total_tokens"], qwen_tokens(r)+kimi_tokens(r)))

def agent_seconds(r):
    return num(first_present(r, [
        "agent_elapsed_sec","agent_elapsed_s","agent_seconds","agent_time_seconds",
        "agent_elapsed","elapsed_seconds","agent_duration_seconds"
    ], 0))

def summarize_group(rows):
    scores = [score_of(r) for r in rows if score_of(r) is not None]
    toks = [total_tokens(r) for r in rows]
    times = [agent_seconds(r) for r in rows if agent_seconds(r) > 0]
    return {
        "task_count": len(rows),
        "scored_count": len(scores),
        "average_score": mean(scores),
        "median_score": median(scores),
        "average_tokens": mean(toks),
        "median_tokens": median(toks),
        "p90_tokens": percentile(toks, .90),
        "average_agent_seconds": mean(times),
        "median_agent_seconds": median(times),
        "p90_agent_seconds": percentile(times, .90),
    }

def copy_if_exists(src, dst_dir, rename=None):
    src = Path(src)
    if src.exists() and src.is_file():
        dst = Path(dst_dir) / (rename or src.name)
        shutil.copy2(src, dst)
        return str(dst.name)
    return None

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--merged-dir", required=True)
    ap.add_argument("--original-run", required=True)
    ap.add_argument("--replacement-root", required=True)
    ap.add_argument("--output-zip", required=True)
    args = ap.parse_args()

    merged = Path(args.merged_dir)
    original = Path(args.original_run)
    repl = Path(args.replacement_root)
    outzip = Path(args.output_zip)
    staging = outzip.with_suffix("")
    if staging.exists():
        shutil.rmtree(staging)
    staging.mkdir(parents=True)

    summary_p = merged/"final_summary_recounted.json"
    results_p = merged/"final_results_merged_recounted.json"
    if not summary_p.exists() or not results_p.exists():
        raise SystemExit("Missing final_summary_recounted.json or final_results_merged_recounted.json")

    summary = load_json(summary_p)
    rows = norm_rows(load_json(results_p))

    scores = [score_of(r) for r in rows if score_of(r) is not None]
    statuses = [status_of(r) for r in rows]
    upgraded = [r for r in rows if kimi_calls(r) > 0 or kimi_tokens(r) > 0]
    qwen_only = [r for r in rows if r not in upgraded]
    successful = [r for r in rows if status_of(r) == "success"]
    successful_upgraded = [r for r in successful if r in upgraded]
    successful_qwen = [r for r in successful if r in qwen_only]

    tokens = summary.get("effective_tokens") or {}
    qtok = integer(tokens.get("qwen_tokens"))
    ktok = integer(tokens.get("kimi_tokens"))
    ttok = integer(tokens.get("total_tokens"), qtok+ktok)

    score_bands = {
        "score_lt_0_50": sum(1 for s in scores if s < .50),
        "score_0_50_to_lt_0_75": sum(1 for s in scores if .50 <= s < .75),
        "score_0_75_to_lt_0_90": sum(1 for s in scores if .75 <= s < .90),
        "score_ge_0_90": sum(1 for s in scores if s >= .90),
    }

    ranked_score = sorted(
        [r for r in rows if score_of(r) is not None],
        key=lambda r: score_of(r)
    )
    ranked_tok = sorted(rows, key=total_tokens, reverse=True)

    routing = {
        "upgraded_task_count_recomputed": len(upgraded),
        "qwen_only_task_count_recomputed": len(qwen_only),
        "qwen_calls_sum": sum(qwen_calls(r) for r in rows),
        "kimi_calls_sum": sum(kimi_calls(r) for r in rows),
        "critical_task_count_sum": sum(integer(first_present(r, ["critical_task_count"], 0)) for r in rows),
        "escalation_count_sum": sum(integer(first_present(r, ["escalation_count"], 0)) for r in rows),
        "deescalation_count_sum": sum(integer(first_present(r, ["deescalation_count"], 0)) for r in rows),
        "tasks_with_critical": sum(1 for r in rows if integer(first_present(r, ["critical_task_count"], 0)) > 0),
        "tasks_with_escalation": sum(1 for r in rows if integer(first_present(r, ["escalation_count"], 0)) > 0),
        "tasks_with_deescalation_gt_escalation": [
            first_present(r, ["task_id"], "")
            for r in rows
            if integer(first_present(r, ["deescalation_count"], 0)) >
               integer(first_present(r, ["escalation_count"], 0))
        ],
        "all_upgraded": summarize_group(upgraded),
        "all_qwen_only": summarize_group(qwen_only),
        "successful_upgraded": summarize_group(successful_upgraded),
        "successful_qwen_only": summarize_group(successful_qwen),
    }

    token_report = {
        "qwen_tokens": qtok,
        "kimi_tokens": ktok,
        "total_tokens": ttok,
        "identity_ok": bool(tokens.get("identity_ok", qtok+ktok == ttok)),
        "qwen_share": (qtok/ttok if ttok else None),
        "kimi_share": (ktok/ttok if ttok else None),
        "input_tokens": integer(tokens.get("input_tokens")),
        "output_tokens": integer(tokens.get("output_tokens")),
        "cache_read_tokens": integer(tokens.get("cache_read_tokens")),
        "cache_write_tokens": integer(tokens.get("cache_write_tokens")),
        "per_task_average": mean([total_tokens(r) for r in rows]),
        "per_task_median": median([total_tokens(r) for r in rows]),
        "per_task_p90": percentile([total_tokens(r) for r in rows], .90),
        "per_task_max": max([total_tokens(r) for r in rows], default=0),
        "top_token_tasks": [
            {
                "task_id": first_present(r, ["task_id"], ""),
                "status": status_of(r),
                "score": score_of(r),
                "qwen_tokens": qwen_tokens(r),
                "kimi_tokens": kimi_tokens(r),
                "total_tokens": total_tokens(r),
            } for r in ranked_tok[:20]
        ],
    }

    timing_vals = [agent_seconds(r) for r in rows if agent_seconds(r) > 0]
    performance = {
        "task_count": len(rows),
        "scored_task_count": len(scores),
        "average_score_recomputed": mean(scores),
        "median_score": median(scores),
        "p10_score": percentile(scores, .10),
        "p25_score": percentile(scores, .25),
        "p75_score": percentile(scores, .75),
        "p90_score": percentile(scores, .90),
        "success_count_recomputed": sum(1 for s in statuses if s == "success"),
        "timeout_count_recomputed": sum(1 for s in statuses if s == "timeout"),
        "error_count_recomputed": sum(1 for s in statuses if s == "error"),
        "score_bands": score_bands,
        "bottom_20_tasks": [
            {
                "task_id": first_present(r, ["task_id"], ""),
                "status": status_of(r),
                "score": score_of(r),
                "qwen_calls": qwen_calls(r),
                "kimi_calls": kimi_calls(r),
                "total_tokens": total_tokens(r),
            } for r in ranked_score[:20]
        ],
        "top_10_tasks": [
            {
                "task_id": first_present(r, ["task_id"], ""),
                "status": status_of(r),
                "score": score_of(r),
                "qwen_calls": qwen_calls(r),
                "kimi_calls": kimi_calls(r),
                "total_tokens": total_tokens(r),
            } for r in ranked_score[-10:][::-1]
        ],
    }
    timing = {
        "agent_seconds_available_for_tasks": len(timing_vals),
        "agent_seconds_sum": sum(timing_vals),
        "agent_seconds_average": mean(timing_vals),
        "agent_seconds_median": median(timing_vals),
        "agent_seconds_p90": percentile(timing_vals, .90),
        "agent_seconds_max": max(timing_vals, default=None),
    }

    repl_manifest = []
    repl_progress = []
    mp = repl/"replacement_manifest.json"
    if mp.exists():
        try: repl_manifest = load_json(mp)
        except Exception: pass
    pp = repl/"replacement_progress.jsonl"
    if pp.exists():
        for line in pp.read_text(encoding="utf-8-sig", errors="replace").splitlines():
            try: repl_progress.append(json.loads(line))
            except Exception: pass

    replacement_analysis = {
        "manifest_records": len(repl_manifest) if isinstance(repl_manifest, list) else None,
        "accepted_records": sum(1 for x in repl_manifest if x.get("accepted")) if isinstance(repl_manifest, list) else None,
        "attempt_records": len(repl_progress),
        "retry_decisions": sum(1 for x in repl_progress if x.get("decision") == "retry"),
        "accept_decisions": sum(1 for x in repl_progress if x.get("decision") == "accept"),
        "review_decisions": sum(1 for x in repl_progress if x.get("decision") == "review"),
        "attempt_elapsed_seconds_sum": sum(num(x.get("elapsed_seconds")) for x in repl_progress),
        "infra_evidence_kinds": sorted({
            str(e.get("kind"))
            for x in repl_progress
            for e in (x.get("infra_evidence") or [])
            if isinstance(e, dict) and e.get("kind")
        }),
    }

    audit = {
        "summary_task_count": summary.get("task_count"),
        "row_task_count": len(rows),
        "replacement_count": summary.get("replacement_count"),
        "missing_transcripts": summary.get("missing_transcripts"),
        "token_identity_mismatches": summary.get("token_identity_mismatches"),
        "token_identity_ok": token_report["identity_ok"],
        "qwen_plus_kimi_equals_total": qtok + ktok == ttok,
        "duplicate_task_ids": [],
    }
    ids = [str(first_present(r, ["task_id"], "")) for r in rows]
    audit["duplicate_task_ids"] = sorted({x for x in ids if x and ids.count(x) > 1})

    metrics = {
        "generated_at": datetime.now().isoformat(),
        "source_paths": {
            "merged_dir": str(merged),
            "original_run": str(original),
            "replacement_root": str(repl),
        },
        "final_summary_as_written": summary,
        "integrity_audit": audit,
        "performance": performance,
        "routing": routing,
        "tokens": token_report,
        "timing": timing,
        "replacement_analysis": replacement_analysis,
    }

    with open(staging/"report_metrics.json", "w", encoding="utf-8") as f:
        json.dump(metrics, f, indent=2, ensure_ascii=False)

    overview = []
    overview.append("FINAL HYBRID PINCHBENCH REPORT PACKAGE")
    overview.append("="*80)
    overview.append(f"Tasks: {len(rows)}")
    overview.append(f"Average score: {performance['average_score_recomputed']}")
    overview.append(f"Median score: {performance['median_score']}")
    overview.append(f"Success / Timeout / Error: {performance['success_count_recomputed']} / {performance['timeout_count_recomputed']} / {performance['error_count_recomputed']}")
    overview.append("")
    overview.append("ROUTING")
    overview.append(f"Upgraded tasks: {routing['upgraded_task_count_recomputed']}")
    overview.append(f"Qwen-only tasks: {routing['qwen_only_task_count_recomputed']}")
    overview.append(f"Qwen calls / Kimi calls: {routing['qwen_calls_sum']} / {routing['kimi_calls_sum']}")
    overview.append(f"Escalations / Deescalations: {routing['escalation_count_sum']} / {routing['deescalation_count_sum']}")
    overview.append("")
    overview.append("TOKENS")
    overview.append(f"Qwen: {qtok:,}")
    overview.append(f"Kimi: {ktok:,}")
    overview.append(f"Total: {ttok:,}")
    overview.append(f"Qwen+Kimi=Total: {qtok+ktok==ttok}")
    overview.append(f"Qwen share: {(100*qtok/ttok if ttok else 0):.2f}%")
    overview.append(f"Kimi share: {(100*ktok/ttok if ttok else 0):.2f}%")
    overview.append("")
    overview.append("INTEGRITY")
    overview.append(f"replacement_count: {summary.get('replacement_count')}")
    overview.append(f"missing_transcripts: {summary.get('missing_transcripts')}")
    overview.append(f"token_identity_mismatches: {summary.get('token_identity_mismatches')}")
    overview.append(f"duplicate_task_ids: {audit['duplicate_task_ids']}")
    (staging/"report_overview.txt").write_text("\n".join(overview)+"\n", encoding="utf-8")

    # Core final artifacts
    core = [
        merged/"final_summary_recounted.json",
        merged/"final_results_merged_recounted.json",
        merged/"final_results_merged_recounted.csv",
        merged/"replacement_provenance.json",
        merged/"replacement_provenance.csv",
        repl/"replacement_manifest.json",
        repl/"replacement_progress.jsonl",
        original/"run_config.json",
        original/"results.json",
    ]
    copied = []
    for p in core:
        x = copy_if_exists(p, staging)
        if x: copied.append(x)

    # Small classification/provenance files only; no raw transcripts.
    class_dir = staging/"replacement_classifications"
    class_dir.mkdir(exist_ok=True)
    nclass = 0
    for p in repl.rglob("classification.json"):
        relname = "__".join(p.relative_to(repl).parts[:-1]) + "__classification.json"
        shutil.copy2(p, class_dir/relname)
        nclass += 1
    if nclass == 0:
        class_dir.rmdir()

    manifest = {
        "included_files": copied,
        "classification_files": nclass,
        "raw_transcripts_included": False,
        "note": "This is a compact report package. Raw transcripts are intentionally excluded; token totals come from the merged raw-SDK recount.",
    }
    with open(staging/"package_manifest.json", "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)

    if outzip.exists():
        outzip.unlink()
    with zipfile.ZipFile(outzip, "w", zipfile.ZIP_DEFLATED) as z:
        for p in sorted(staging.rglob("*")):
            if p.is_file():
                z.write(p, p.relative_to(staging))

    print("REPORT_PACKAGE_READY")
    print("zip =", outzip)
    print("size_mb =", round(outzip.stat().st_size/1024/1024, 2))
    print("tasks =", len(rows))
    print("avg_score =", performance["average_score_recomputed"])
    print("qwen_tokens =", qtok)
    print("kimi_tokens =", ktok)
    print("total_tokens =", ttok)
    print("token_identity_ok =", audit["qwen_plus_kimi_equals_total"])
    print("upgraded_tasks =", len(upgraded))
    print("qwen_only_tasks =", len(qwen_only))
    print("replacement_manifest =", replacement_analysis["manifest_records"], "accepted =", replacement_analysis["accepted_records"])

if __name__ == "__main__":
    main()
