from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path
from typing import Any

TRANSIENT_MARKERS = (
    "server disconnected",
    "upstream_status=500",
    "upstream_status=502",
    "upstream_status=503",
    "upstream_status=504",
    "http 500",
    "http 502",
    "http 503",
    "http 504",
    "econnreset",
    "connection reset",
    "connection aborted",
)

def load_results(run_dir: Path) -> list[dict[str, Any]]:
    for name in ("results.json", "results.partial.json"):
        p = run_dir / name
        if not p.exists():
            continue
        data = json.loads(p.read_text(encoding="utf-8"))
        if isinstance(data, list):
            return data
        if isinstance(data, dict) and isinstance(data.get("results"), list):
            return data["results"]
    raise SystemExit(f"No results.json/results.partial.json under {run_dir}")

def zeroish(v: Any) -> bool:
    return v is None or v == 0 or v == 0.0

def usage_zeroish(row: dict[str, Any]) -> bool:
    return all(zeroish(row.get(k)) for k in (
        "input_tokens", "output_tokens", "reasoning_tokens",
        "cache_read_tokens", "cache_write_tokens",
    ))

def parse_events(transcript_dir: Path) -> list[dict[str, Any]]:
    records: list[tuple[float, int, dict[str, Any]]] = []
    seq = 0
    if not transcript_dir.exists():
        return []
    for p in sorted(transcript_dir.glob("turn_*.jsonl")):
        if p.name == "normalized.jsonl":
            continue
        try:
            lines = p.read_text(encoding="utf-8", errors="replace").splitlines()
        except Exception:
            continue
        for line in lines:
            line = line.strip()
            if not line.startswith("{"):
                continue
            try:
                obj = json.loads(line)
            except Exception:
                continue
            if not isinstance(obj, dict) or not obj.get("type"):
                continue
            seq += 1
            ts = obj.get("timestamp")
            try:
                key = float(ts)
            except Exception:
                key = 1e18 + seq
            records.append((key, seq, obj))
    records.sort(key=lambda x: (x[0], x[1]))
    return [x[2] for x in records]

def is_completed_task_tool(event: dict[str, Any]) -> bool:
    if event.get("type") != "tool_use":
        return False
    part = event.get("part") if isinstance(event.get("part"), dict) else {}
    state = part.get("state") if isinstance(part.get("state"), dict) else {}
    return part.get("tool") == "task" and state.get("status") == "completed"

def event_elapsed_span(events: list[dict[str, Any]]) -> float | None:
    timestamps = []
    for e in events:
        try:
            timestamps.append(float(e.get("timestamp")))
        except Exception:
            pass
    if len(timestamps) < 2:
        return None
    return max(0.0, (max(timestamps) - min(timestamps)) / 1000.0)

def classify(row: dict[str, Any], run_dir: Path, min_silent_tail: float) -> dict[str, Any]:
    tid = str(row.get("task_id") or "")
    status = str(row.get("status") or "")
    score = row.get("score")
    retry_used = int(row.get("agent_infra_retries_used") or 0)
    step_count = int(row.get("step_count") or 0)
    output = str(row.get("output") or "")
    errtxt = f"{row.get('error') or ''}\n{row.get('stderr') or ''}".lower()

    tdir = run_dir / "transcripts" / tid
    events = parse_events(tdir)
    last_type = str(events[-1].get("type") or "") if events else ""
    last_index = len(events) - 1
    completed_task_indices = [i for i, e in enumerate(events) if is_completed_task_tool(e)]
    has_completed_child_before_last = any(i < last_index for i in completed_task_indices)

    span = event_elapsed_span(events)
    elapsed = float(row.get("agent_elapsed") or row.get("elapsed") or 0.0)
    silent_tail = None
    if span is not None and elapsed >= span:
        silent_tail = max(0.0, elapsed - span)

    categories: list[str] = []
    evidence: list[str] = []
    auto_eligible = False

    if any(m in errtxt for m in TRANSIENT_MARKERS):
        categories.append("explicit_transient_transport")
        evidence.append("final execution contains explicit 5xx/disconnect/reset marker")
        auto_eligible = True

    post_child_stall = (
        status == "timeout"
        and bool(events)
        and last_type == "step_start"
        and has_completed_child_before_last
        and (silent_tail is None or silent_tail >= min_silent_tail)
    )
    if post_child_stall:
        categories.append("post_child_parent_continuation_stall")
        if silent_tail is not None:
            evidence.append(
                f"completed task/subagent tool precedes final step_start; no later event; "
                f"silent_tail≈{silent_tail:.1f}s"
            )
        else:
            evidence.append("completed task/subagent tool precedes final step_start; no later event")
        auto_eligible = True

    no_completed_step = status == "timeout" and step_count == 0 and usage_zeroish(row)
    strict_zero_progress = no_completed_step and (
        (
            bool(events)
            and last_type == "step_start"
            and (silent_tail is None or silent_tail >= min_silent_tail)
        )
        or (not events and not output.strip())
    )
    if strict_zero_progress:
        categories.append("zero_progress_timeout")
        evidence.append(
            f"timeout with step_count=0 and no completed usage; final_event={last_type or 'N/A'}"
        )
        auto_eligible = True
    elif no_completed_step:
        categories.append("review_no_completed_step_timeout")
        evidence.append(
            f"timeout with step_count=0/no completed usage, but raw stream is not a strict empty-step tail "
            f"(last_event={last_type or 'N/A'}, output_chars={len(output)})"
        )

    false_success = (
        status == "success"
        and usage_zeroish(row)
        and step_count <= 1
        and not output.strip()
        and (score is None or float(score) == 0.0)
    )
    if false_success:
        categories.append("zero_output_false_success")
        evidence.append("process returned success but produced zero usage, empty output, and zero/no score")
        auto_eligible = True

    if status == "timeout" and not categories:
        categories.append("ordinary_timeout")
        evidence.append("timeout does not match a strict infrastructure signature")

    eligible = bool(auto_eligible and retry_used == 0)
    if auto_eligible and retry_used > 0:
        evidence.append(
            f"NOT eligible: agent_infra_retries_used={retry_used}; retry budget already consumed"
        )

    return {
        "task_id": tid,
        "status": status,
        "score": score,
        "agent_elapsed": row.get("agent_elapsed", row.get("elapsed")),
        "step_count": step_count,
        "input_tokens": row.get("input_tokens"),
        "output_tokens": row.get("output_tokens"),
        "reasoning_tokens": row.get("reasoning_tokens"),
        "agent_infra_retries_used": retry_used,
        "last_raw_event": last_type or None,
        "raw_event_count": len(events),
        "silent_tail_seconds_est": round(silent_tail, 3) if silent_tail is not None else None,
        "completed_subagent_task_seen": bool(completed_task_indices),
        "categories": categories,
        "evidence": evidence,
        "eligible_for_one_fresh_retry": eligible,
    }

def main() -> int:
    ap = argparse.ArgumentParser(
        description="Classify SuperClaw PinchBench execution anomalies without rerunning anything."
    )
    ap.add_argument("run_dir")
    ap.add_argument("--min-silent-tail", type=float, default=60.0)
    ap.add_argument("--output", default=None)
    args = ap.parse_args()

    run_dir = Path(args.run_dir).expanduser().resolve()
    rows = load_results(run_dir)
    classified = [classify(r, run_dir, args.min_silent_tail) for r in rows]

    eligible = [x for x in classified if x["eligible_for_one_fresh_retry"]]
    review = [x for x in classified if "review_no_completed_step_timeout" in x["categories"]]

    plan = {
        "policy": {
            "name": "framework-neutral strict infrastructure recovery",
            "max_fresh_retries_per_task": 1,
            "ordinary_deadline_timeouts_are_not_retried": True,
            "low_scores_are_not_retried": True,
            "already_consumed_infra_retry_is_not_retried_again": True,
            "eligible_signatures": [
                "explicit transient 500/502/503/504/disconnect/reset",
                "child task completed -> final parent step_start -> no later event until deadline",
                "zero-progress timeout with zero completed steps/usage and empty final step tail",
                "false success with zero usage, empty output, and zero/no score",
            ],
        },
        "run_dir": str(run_dir),
        "task_count": len(rows),
        "eligible_count": len(eligible),
        "eligible_task_ids": [x["task_id"] for x in eligible],
        "review_only_task_ids": [x["task_id"] for x in review],
        "classifications": classified,
    }

    out = Path(args.output).expanduser().resolve() if args.output else run_dir / "infra_recovery_plan.json"
    out.write_text(json.dumps(plan, ensure_ascii=False, indent=2), encoding="utf-8")

    csv_out = out.with_suffix(".csv")
    fields = [
        "task_id", "status", "score", "agent_elapsed", "step_count",
        "input_tokens", "output_tokens", "reasoning_tokens",
        "agent_infra_retries_used", "last_raw_event", "raw_event_count",
        "silent_tail_seconds_est", "completed_subagent_task_seen",
        "eligible_for_one_fresh_retry", "categories", "evidence",
    ]
    with csv_out.open("w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        for x in classified:
            y = dict(x)
            y["categories"] = ";".join(x["categories"])
            y["evidence"] = " | ".join(x["evidence"])
            w.writerow({k: y.get(k) for k in fields})

    print(f"Run: {run_dir}")
    print(f"Tasks: {len(rows)}")
    print(f"Eligible for exactly one fresh infra retry: {len(eligible)}")
    for x in eligible:
        print(
            f"  RETRY  {x['task_id']}: {','.join(x['categories'])} "
            f"score={x['score']} status={x['status']}"
        )
    if review:
        print(f"Review-only (NOT auto-retried): {len(review)}")
        for x in review:
            print(
                f"  REVIEW {x['task_id']}: {','.join(x['categories'])} "
                f"score={x['score']} status={x['status']}"
            )
    print(f"Plan: {out}")
    print(f"CSV : {csv_out}")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
