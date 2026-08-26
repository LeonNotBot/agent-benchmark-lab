#!/usr/bin/env python3
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import shutil
import tempfile
from pathlib import Path
from typing import Any

TARGET_TASKS = ["task_deep_research", "task_oss_alternative_research"]
GENERIC_TASK_MARKERS = ["Invalid Responses API request"]
DETAIL_MARKERS = ["expected array, received undefined", "summary"]


def atomic_write_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp_name = tempfile.mkstemp(prefix=path.name + ".", suffix=".tmp", dir=str(path.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(text)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp_name, path)
    finally:
        try:
            os.unlink(temp_name)
        except FileNotFoundError:
            pass


def atomic_write_json(path: Path, value: Any) -> None:
    atomic_write_text(path, json.dumps(value, ensure_ascii=False, indent=2) + "\n")


def task_evidence(row: dict[str, Any], run_dir: Path, task_id: str) -> str:
    parts = [
        str(row.get("error") or ""),
        str(row.get("stderr") or ""),
        str(row.get("grade_error") or ""),
        json.dumps(row.get("turn_results") or [], ensure_ascii=False),
    ]
    transcript_dir = run_dir / "transcripts" / task_id
    if transcript_dir.exists():
        for path in sorted(transcript_dir.glob("*.stderr.txt")):
            parts.append(path.read_text(encoding="utf-8-sig", errors="replace"))
        for path in sorted(transcript_dir.glob("turn_results.json")):
            parts.append(path.read_text(encoding="utf-8-sig", errors="replace"))
    return "\n".join(parts)


def validate_isolated_canary(root: Path) -> dict[str, Any]:
    canary_root = root / "canary-runs" / "reasoning-summary-v0.1.4"
    if not canary_root.exists():
        raise SystemExit(f"Isolated canary root is missing: {canary_root}")

    candidates = sorted(
        (path for path in canary_root.glob("grok_build_*") if path.is_dir()),
        key=lambda path: path.stat().st_mtime,
        reverse=True,
    )
    for run_dir in candidates:
        results_path = run_dir / "results.json"
        if not results_path.exists():
            continue
        try:
            payload = json.loads(results_path.read_text(encoding="utf-8-sig"))
        except Exception:
            continue
        rows = payload.get("results") if isinstance(payload, dict) else None
        if not isinstance(rows, list):
            continue
        match = next(
            (
                row for row in rows
                if isinstance(row, dict) and row.get("task_id") == "task_deep_research"
            ),
            None,
        )
        if not match:
            continue
        if match.get("success") is not True or match.get("status") != "success":
            continue
        workspace = Path(str(match.get("workspace") or ""))
        report = workspace / "wasm_research.md"
        if not report.exists() or report.stat().st_size < 1000:
            continue
        evidence = task_evidence(match, run_dir, "task_deep_research")
        if "Invalid Responses API request" in evidence:
            continue
        return {
            "run_dir": str(run_dir),
            "score": match.get("score"),
            "elapsed": match.get("elapsed"),
            "report": str(report),
            "report_bytes": report.stat().st_size,
        }

    raise SystemExit(
        "No successful isolated task_deep_research canary was found under "
        f"{canary_root}"
    )


def detailed_adapter_evidence(adapter_log: Path) -> list[dict[str, Any]]:
    if not adapter_log.exists():
        raise SystemExit(f"Adapter log is missing: {adapter_log}")

    matches: list[dict[str, Any]] = []
    for line_number, raw in enumerate(
        adapter_log.read_text(encoding="utf-8-sig", errors="replace").splitlines(),
        start=1,
    ):
        lower = raw.lower()
        if all(marker.lower() in lower for marker in DETAIL_MARKERS):
            try:
                parsed = json.loads(raw)
            except Exception:
                parsed = {"raw": raw}
            matches.append(
                {
                    "line_number": line_number,
                    "ts": parsed.get("ts") if isinstance(parsed, dict) else None,
                    "event": parsed.get("event") if isinstance(parsed, dict) else None,
                    "request_id": parsed.get("request_id") if isinstance(parsed, dict) else None,
                    "raw": raw[:12000],
                }
            )
    if len(matches) < 2:
        raise SystemExit(
            "Adapter log does not contain at least two detailed "
            "reasoning.summary schema failures. "
            f"Found={len(matches)} log={adapter_log}"
        )
    return matches


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-dir", required=True)
    parser.add_argument("--root", default=r"C:\pinchbench-grok-build")
    parser.add_argument(
        "--adapter-log",
        default=r"C:\pinchbench-grok-build\logs\search-adapter.jsonl",
    )
    args = parser.parse_args()

    run_dir = Path(args.run_dir).expanduser().resolve()
    root = Path(args.root).expanduser().resolve()
    adapter_log = Path(args.adapter_log).expanduser().resolve()

    progress = run_dir / "progress.jsonl"
    partial = run_dir / "results.partial.json"
    config_path = run_dir / "run_config.json"
    heartbeat = run_dir / "heartbeat.json"

    for path in (run_dir, progress, config_path):
        if not path.exists():
            raise SystemExit(f"Required path missing: {path}")

    canary = validate_isolated_canary(root)
    adapter_matches = detailed_adapter_evidence(adapter_log)

    config = json.loads(config_path.read_text(encoding="utf-8-sig"))
    configured = [str(value) for value in config.get("task_ids") or []]
    for task_id in TARGET_TASKS:
        if task_id not in configured:
            raise SystemExit(f"{task_id} is not present in run_config.json")

    parsed: list[tuple[str, dict[str, Any]]] = []
    for raw in progress.read_text(encoding="utf-8-sig", errors="strict").splitlines():
        if not raw.strip():
            continue
        row = json.loads(raw)
        if not isinstance(row, dict):
            raise SystemExit("progress.jsonl contains a non-object row")
        parsed.append((raw, row))

    selected: dict[str, dict[str, Any]] = {}
    task_validation: dict[str, Any] = {}
    for task_id in TARGET_TASKS:
        matches = [row for _, row in parsed if str(row.get("task_id") or "") == task_id]
        if len(matches) != 1:
            raise SystemExit(
                f"Expected exactly one current row for {task_id}; found {len(matches)}"
            )
        row = matches[0]
        if row.get("success") is not False or str(row.get("status") or "") != "error":
            raise SystemExit(
                f"Refusing cleanup for {task_id}: "
                f"success={row.get('success')} status={row.get('status')}"
            )
        if int(row.get("returncode") or 0) == 0:
            raise SystemExit(
                f"Refusing cleanup for {task_id}: returncode={row.get('returncode')}"
            )
        if float(row.get("score") or 0.0) != 0.0:
            raise SystemExit(
                f"Refusing cleanup for {task_id}: "
                f"expected score 0.0, actual={row.get('score')}"
            )

        evidence = task_evidence(row, run_dir, task_id)
        missing = [
            marker for marker in GENERIC_TASK_MARKERS
            if marker.lower() not in evidence.lower()
        ]
        if missing:
            raise SystemExit(
                f"Refusing cleanup for {task_id}: "
                f"missing task-level markers {missing}"
            )

        selected[task_id] = row
        task_validation[task_id] = {
            "success": row.get("success"),
            "status": row.get("status"),
            "returncode": row.get("returncode"),
            "score": row.get("score"),
            "elapsed": row.get("elapsed"),
            "generic_invalid_responses_evidence": True,
        }

    # task_pricing_research was removed by the earlier validated cleanup and
    # must remain absent so that resume will execute it.
    pricing_matches = [
        row for _, row in parsed
        if str(row.get("task_id") or "") == "task_pricing_research"
    ]
    if pricing_matches:
        raise SystemExit(
            "Refusing cleanup: task_pricing_research unexpectedly already "
            "has a current progress row."
        )

    stamp = dt.datetime.now().strftime("%Y%m%d-%H%M%S")
    backup = (
        run_dir
        / "protocol-hotfix-backup"
        / f"reasoning-summary-v0.1.4a-{stamp}"
    )
    backup.mkdir(parents=True, exist_ok=False)

    for path in (progress, partial, heartbeat, config_path):
        if path.exists():
            shutil.copy2(path, backup / path.name)

    atomic_write_json(
        backup / "validation_evidence.json",
        {
            "isolated_canary": canary,
            "task_validation": task_validation,
            "adapter_detailed_schema_matches_count": len(adapter_matches),
            "adapter_detailed_schema_matches_tail": adapter_matches[-10:],
        },
    )
    atomic_write_json(
        backup / "removed_task_results.json",
        [selected[task_id] for task_id in TARGET_TASKS],
    )

    for task_id in TARGET_TASKS:
        for category in ("workspaces", "transcripts", "judge_raw_responses"):
            source = run_dir / category / task_id
            if source.exists():
                destination_root = backup / category
                destination_root.mkdir(parents=True, exist_ok=True)
                shutil.move(str(source), str(destination_root / task_id))

    judge_cache = run_dir.parent / ".judge_cache"
    if judge_cache.exists():
        shutil.move(str(judge_cache), str(backup / "judge_cache"))

    for name in ("results.json", "results.csv", "results.xlsx"):
        path = run_dir / name
        if path.exists():
            shutil.move(str(path), str(backup / name))

    target_set = set(TARGET_TASKS)
    remaining = [
        (raw, row)
        for raw, row in parsed
        if str(row.get("task_id") or "") not in target_set
    ]
    atomic_write_text(progress, "".join(raw + "\n" for raw, _ in remaining))
    rows = [row for _, row in remaining]
    atomic_write_json(partial, {"completed": len(rows), "results": rows})
    atomic_write_json(
        heartbeat,
        {
            "at": dt.datetime.now(dt.timezone.utc).isoformat(),
            "state": "paused_reasoning_summary_v0.1.4a_ready",
            "removed_task_ids": TARGET_TASKS,
            "pending_task_id": "task_pricing_research",
            "completed": len(rows),
            "task_count": len(configured),
            "backup": str(backup),
            "isolated_canary": canary,
            "pid": os.getpid(),
        },
    )

    print("PASS: removed only the two validated reasoning-summary failures.")
    print(f"Run dir   : {run_dir}")
    print(f"Backup    : {backup}")
    print(f"Remaining : {len(rows)} completed rows")
    print(f"Canary    : {canary['run_dir']} score={canary['score']}")
    print(f"Log proof : {len(adapter_matches)} detailed summary-schema matches")
    print("Rerun     : task_deep_research")
    print("Rerun     : task_oss_alternative_research")
    print("Rerun     : task_pricing_research (already absent)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
