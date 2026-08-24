#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Merge clean V5d replacement rows into the original 143-task run, then recompute token accounting
from raw *.sdk-messages.jsonl assistant messages.

Token rule:
- count each unique (session_id, assistant message.id) once;
- if the same message id appears multiple times while streaming, keep the record with the largest
  complete usage total;
- total = input + output + cache_read + cache_creation;
- classify by message.model (Qwen/Kimi);
- do NOT trust top-level result.usage/modelUsage for final accounting.

The original run is never modified. Outputs go to --output-dir.
"""

from __future__ import annotations
import argparse, csv, json, os, re, shutil
from pathlib import Path
from collections import defaultdict
from typing import Any

QWEN_DEFAULT = "qwen/qwen3.6-27b"
KIMI_DEFAULT = "moonshotai/kimi-k3"

def read_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8-sig") as f:
        return json.load(f)

def write_json(path: Path, obj: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)

def usage_from_message(msg: dict[str, Any]) -> dict[str, int]:
    u = msg.get("usage") or {}
    inp = int(u.get("input_tokens") or 0)
    out = int(u.get("output_tokens") or 0)
    cr = int(u.get("cache_read_input_tokens") or u.get("cache_read_tokens") or 0)
    cw = int(u.get("cache_creation_input_tokens") or u.get("cache_write_tokens") or 0)
    return {
        "input_tokens": inp,
        "output_tokens": out,
        "cache_read_tokens": cr,
        "cache_write_tokens": cw,
        "total_tokens": inp + out + cr + cw,
    }

def recount_transcript_dir(tdir: Path, qwen_model: str, kimi_model: str) -> dict[str, Any]:
    records: dict[tuple[str, str], dict[str, Any]] = {}
    if not tdir.exists():
        return {"missing": True, "records": 0, "models": {}, "total": zero_usage()}

    for fp in sorted(tdir.glob("*.sdk-messages.jsonl")):
        try:
            fh = fp.open("r", encoding="utf-8", errors="replace")
        except OSError:
            continue
        with fh:
            for line in fh:
                try:
                    x = json.loads(line)
                except Exception:
                    continue
                if x.get("type") != "assistant":
                    continue
                msg = x.get("message") or {}
                mid = msg.get("id") or x.get("uuid")
                if not mid:
                    continue
                sid = str(x.get("session_id") or x.get("sessionId") or "")
                key = (sid, str(mid))
                model = str(msg.get("model") or "")
                usage = usage_from_message(msg)
                rec = {"model": model, **usage}
                prev = records.get(key)
                # Streaming can emit the same message several times. Keep the most complete snapshot.
                if prev is None or rec["total_tokens"] >= prev["total_tokens"]:
                    records[key] = rec

    by_model: dict[str, dict[str, int]] = defaultdict(zero_usage_with_calls)
    total = zero_usage()
    for rec in records.values():
        model = rec["model"]
        bucket = by_model[model]
        bucket["calls"] += 1
        for k in ("input_tokens", "output_tokens", "cache_read_tokens", "cache_write_tokens", "total_tokens"):
            bucket[k] += int(rec[k])
            total[k] += int(rec[k])

    q = by_model.get(qwen_model, zero_usage_with_calls())
    k = by_model.get(kimi_model, zero_usage_with_calls())
    known_sum = int(q["total_tokens"]) + int(k["total_tokens"])
    other_total = int(total["total_tokens"]) - known_sum
    return {
        "missing": False,
        "records": len(records),
        "models": dict(by_model),
        "qwen": q,
        "kimi": k,
        "other_total_tokens": other_total,
        "total": total,
    }

def zero_usage() -> dict[str, int]:
    return {
        "input_tokens": 0,
        "output_tokens": 0,
        "cache_read_tokens": 0,
        "cache_write_tokens": 0,
        "total_tokens": 0,
    }

def zero_usage_with_calls() -> dict[str, int]:
    return {"calls": 0, **zero_usage()}

def locate_task_transcript(run_dir: Path, task_id: str) -> Path:
    return run_dir / "transcripts" / task_id

def recount_discarded_attempts(run_dir: Path, task_id: str, qwen_model: str, kimi_model: str) -> dict[str, int]:
    base = run_dir / "infra_attempts" / task_id
    agg = {"qwen_tokens": 0, "kimi_tokens": 0, "total_tokens": 0, "attempt_count": 0}
    if not base.exists():
        return agg
    for attempt in sorted(base.glob("attempt_*")):
        candidates = [attempt / "transcript", attempt / "transcripts" / task_id]
        tdir = next((p for p in candidates if p.exists()), None)
        if tdir is None:
            # fallback: find a directory containing sdk messages
            matches = list(attempt.rglob("*.sdk-messages.jsonl"))
            if not matches:
                continue
            tdir = matches[0].parent
        r = recount_transcript_dir(tdir, qwen_model, kimi_model)
        agg["attempt_count"] += 1
        agg["qwen_tokens"] += int(r.get("qwen", {}).get("total_tokens", 0))
        agg["kimi_tokens"] += int(r.get("kimi", {}).get("total_tokens", 0))
        agg["total_tokens"] += int(r.get("total", {}).get("total_tokens", 0))
    return agg

def update_row_tokens(row: dict[str, Any], count: dict[str, Any]) -> None:
    q = count.get("qwen", zero_usage_with_calls())
    k = count.get("kimi", zero_usage_with_calls())
    t = count.get("total", zero_usage())
    row["input_tokens"] = int(t["input_tokens"])
    row["output_tokens"] = int(t["output_tokens"])
    row["cache_read_tokens"] = int(t["cache_read_tokens"])
    row["cache_write_tokens"] = int(t["cache_write_tokens"])
    row["total_tokens"] = int(t["total_tokens"])
    row["qwen_calls"] = int(q.get("calls", 0))
    row["kimi_calls"] = int(k.get("calls", 0))
    row["qwen_input_tokens"] = int(q["input_tokens"])
    row["qwen_output_tokens"] = int(q["output_tokens"])
    row["qwen_cache_read_tokens"] = int(q["cache_read_tokens"])
    row["qwen_cache_write_tokens"] = int(q["cache_write_tokens"])
    row["qwen_total_tokens"] = int(q["total_tokens"])
    row["kimi_input_tokens"] = int(k["input_tokens"])
    row["kimi_output_tokens"] = int(k["output_tokens"])
    row["kimi_cache_read_tokens"] = int(k["cache_read_tokens"])
    row["kimi_cache_write_tokens"] = int(k["cache_write_tokens"])
    row["kimi_total_tokens"] = int(k["total_tokens"])
    row["token_source"] = "offline_sdk_assistant_message_id_dedup_v5d"
    row["token_coverage_complete"] = count.get("missing") is False and int(count.get("other_total_tokens", 0)) == 0
    row["token_verified_against_openrouter"] = False
    row["model_usage_json"] = json.dumps(count.get("models", {}), ensure_ascii=False)
    row["model_call_counts_json"] = json.dumps(
        {m: int(v.get("calls", 0)) for m, v in count.get("models", {}).items()},
        ensure_ascii=False,
    )

def replacement_map(manifest_path: Path) -> dict[str, dict[str, Any]]:
    data = read_json(manifest_path)
    if isinstance(data, dict):
        data = data.get("replacements") or data.get("items") or [data]
    out: dict[str, dict[str, Any]] = {}
    for e in data:
        if not isinstance(e, dict) or not e.get("accepted"):
            continue
        tid = str(e.get("task_id") or "")
        rp = Path(str(e.get("results_json") or ""))
        if tid and rp.exists():
            out[tid] = e
    return out

def write_csv(path: Path, rows: list[dict[str, Any]]) -> None:
    # Keep scalar fields; serialize dict/list values as JSON.
    keys: list[str] = []
    seen = set()
    for row in rows:
        for k in row.keys():
            if k not in seen:
                seen.add(k); keys.append(k)
    with path.open("w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=keys)
        w.writeheader()
        for row in rows:
            out = {}
            for k in keys:
                v = row.get(k)
                out[k] = json.dumps(v, ensure_ascii=False) if isinstance(v, (dict, list)) else v
            w.writerow(out)

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--original-run", required=True)
    ap.add_argument("--replacement-manifest", required=True)
    ap.add_argument("--output-dir", required=True)
    ap.add_argument("--qwen-model", default=QWEN_DEFAULT)
    ap.add_argument("--kimi-model", default=KIMI_DEFAULT)
    args = ap.parse_args()

    original_run = Path(args.original_run).resolve()
    manifest = Path(args.replacement_manifest).resolve()
    outdir = Path(args.output_dir).resolve()
    outdir.mkdir(parents=True, exist_ok=True)

    original_json = original_run / "results.json"
    if not original_json.exists():
        raise SystemExit(f"Original results.json not found: {original_json}")
    root = read_json(original_json)
    original_rows = list(root.get("results") or [])
    if not original_rows:
        raise SystemExit("No original result rows")

    reps = replacement_map(manifest)
    final_rows: list[dict[str, Any]] = []
    provenance: list[dict[str, Any]] = []
    missing_transcripts: list[str] = []
    token_mismatches: list[dict[str, Any]] = []
    historical_superseded_tokens = 0
    final_discarded = {"qwen_tokens": 0, "kimi_tokens": 0, "total_tokens": 0, "attempt_count": 0}

    original_by_id = {str(r.get("task_id")): r for r in original_rows}
    for tid, original_row in original_by_id.items():
        source_run = original_run
        source_kind = "original"
        row = dict(original_row)

        if tid in reps:
            e = reps[tid]
            replacement_results = Path(str(e["results_json"])).resolve()
            rr = read_json(replacement_results)
            candidates = [r for r in (rr.get("results") or []) if str(r.get("task_id")) == tid]
            if not candidates:
                raise SystemExit(f"Replacement row missing for {tid}: {replacement_results}")
            row = dict(candidates[0])
            source_run = replacement_results.parent
            source_kind = "replacement"

            # Audit-only: how many tokens were superseded by replacing the original row.
            old_count = recount_transcript_dir(locate_task_transcript(original_run, tid), args.qwen_model, args.kimi_model)
            historical_superseded_tokens += int(old_count.get("total", {}).get("total_tokens", 0))

        tdir = locate_task_transcript(source_run, tid)
        count = recount_transcript_dir(tdir, args.qwen_model, args.kimi_model)
        if count.get("missing"):
            missing_transcripts.append(tid)
        update_row_tokens(row, count)

        identity_ok = (
            int(row.get("total_tokens") or 0)
            == int(row.get("qwen_total_tokens") or 0)
             + int(row.get("kimi_total_tokens") or 0)
             + int(count.get("other_total_tokens") or 0)
        )
        if not identity_ok:
            token_mismatches.append({
                "task_id": tid,
                "total": row.get("total_tokens"),
                "qwen": row.get("qwen_total_tokens"),
                "kimi": row.get("kimi_total_tokens"),
                "other": count.get("other_total_tokens"),
            })

        discarded = recount_discarded_attempts(source_run, tid, args.qwen_model, args.kimi_model)
        for k in final_discarded:
            final_discarded[k] += int(discarded[k])
        row["infra_discarded_total_tokens_recounted"] = int(discarded["total_tokens"])
        row["infra_discarded_qwen_tokens_recounted"] = int(discarded["qwen_tokens"])
        row["infra_discarded_kimi_tokens_recounted"] = int(discarded["kimi_tokens"])

        final_rows.append(row)
        provenance.append({
            "task_id": tid,
            "source": source_kind,
            "source_run": str(source_run),
            "replacement_results_json": str(reps[tid]["results_json"]) if tid in reps else "",
            "status": row.get("status"),
            "score": row.get("score"),
            "qwen_tokens": row.get("qwen_total_tokens"),
            "kimi_tokens": row.get("kimi_total_tokens"),
            "total_tokens": row.get("total_tokens"),
        })

    effective = {
        "qwen_tokens": sum(int(r.get("qwen_total_tokens") or 0) for r in final_rows),
        "kimi_tokens": sum(int(r.get("kimi_total_tokens") or 0) for r in final_rows),
        "total_tokens": sum(int(r.get("total_tokens") or 0) for r in final_rows),
        "input_tokens": sum(int(r.get("input_tokens") or 0) for r in final_rows),
        "output_tokens": sum(int(r.get("output_tokens") or 0) for r in final_rows),
        "cache_read_tokens": sum(int(r.get("cache_read_tokens") or 0) for r in final_rows),
        "cache_write_tokens": sum(int(r.get("cache_write_tokens") or 0) for r in final_rows),
    }
    effective["identity_ok"] = effective["total_tokens"] == effective["qwen_tokens"] + effective["kimi_tokens"]

    scored = [float(r["score"]) for r in final_rows if r.get("score") is not None]
    success_count = sum(bool(r.get("success")) for r in final_rows)
    timeout_count = sum(str(r.get("status")) == "timeout" for r in final_rows)
    upgraded_count = sum(int(r.get("escalation_count") or 0) > 0 for r in final_rows)

    corrected_summary = {
        "task_count": len(final_rows),
        "success_count": success_count,
        "failed_count": len(final_rows) - success_count,
        "scored_task_count": len(scored),
        "average_score": (sum(scored) / len(scored)) if scored else None,
        "timeout_count": timeout_count,
        "hybrid_upgraded_task_count": upgraded_count,
        "replacement_count": len(reps),
        "effective_tokens": effective,
        "discarded_infra_tokens_for_adopted_runs": final_discarded,
        "operational_tokens_effective_plus_discarded": effective["total_tokens"] + final_discarded["total_tokens"],
        "historical_superseded_original_tokens_not_in_final": historical_superseded_tokens,
        "missing_transcripts": missing_transcripts,
        "token_identity_mismatches": token_mismatches,
        "token_method": "unique (session_id, assistant message.id), max usage snapshot, input+output+cache_read+cache_creation",
    }

    merged = dict(root)
    merged["results"] = final_rows
    merged["corrected_summary_v5d"] = corrected_summary
    merged["replacement_provenance_v5d"] = provenance

    write_json(outdir / "final_results_merged_recounted.json", merged)
    write_json(outdir / "final_summary_recounted.json", corrected_summary)
    write_json(outdir / "replacement_provenance.json", provenance)
    write_csv(outdir / "final_results_merged_recounted.csv", final_rows)
    write_csv(outdir / "replacement_provenance.csv", provenance)

    print("=" * 92)
    print("V5d merged + offline token recount")
    print("=" * 92)
    print(f"tasks                 : {len(final_rows)}")
    print(f"replacements          : {len(reps)}")
    print(f"success / failed       : {success_count} / {len(final_rows)-success_count}")
    print(f"average score          : {corrected_summary['average_score']:.6f}" if scored else "average score: n/a")
    print(f"Qwen tokens            : {effective['qwen_tokens']}")
    print(f"Kimi tokens            : {effective['kimi_tokens']}")
    print(f"effective total tokens : {effective['total_tokens']}")
    print(f"identity Q+K==total    : {effective['identity_ok']}")
    print(f"adopted infra discarded: {final_discarded['total_tokens']}")
    print(f"effective+discarded    : {corrected_summary['operational_tokens_effective_plus_discarded']}")
    print(f"superseded old tokens  : {historical_superseded_tokens} (audit only; excluded from final)")
    print(f"missing transcripts    : {len(missing_transcripts)}")
    print(f"token mismatches       : {len(token_mismatches)}")
    print(f"output                 : {outdir}")
    if missing_transcripts or token_mismatches or not effective["identity_ok"]:
        return 2
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
