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

TARGET_TASKS = [
    "task_deep_research",
    "task_oss_alternative_research",
    "task_pricing_research",
]
REQUIRED_ERROR_MARKERS = [
    "Invalid Responses API request",
    "expected string, received array",
]


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


def diagnostic_text(row: dict[str, Any], run_dir: Path, task_id: str) -> str:
    pieces = [
        str(row.get("error") or ""),
        str(row.get("stderr") or ""),
        json.dumps(row.get("turn_results") or [], ensure_ascii=False),
    ]
    stderr_dir = run_dir / "transcripts" / task_id
    if stderr_dir.exists():
        for path in sorted(stderr_dir.glob("*.stderr.txt")):
            pieces.append(path.read_text(encoding="utf-8-sig", errors="replace"))
    return "\n".join(pieces)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-dir", required=True)
    args = parser.parse_args()

    run_dir = Path(args.run_dir).expanduser().resolve()
    progress = run_dir / "progress.jsonl"
    partial = run_dir / "results.partial.json"
    config_path = run_dir / "run_config.json"
    heartbeat = run_dir / "heartbeat.json"

    for required in (run_dir, progress, config_path):
        if not required.exists():
            raise SystemExit(f"Required path missing: {required}")

    config = json.loads(config_path.read_text(encoding="utf-8-sig"))
    configured_ids = [str(value) for value in config.get("task_ids") or []]
    missing_config = [task_id for task_id in TARGET_TASKS if task_id not in configured_ids]
    if missing_config:
        raise SystemExit(f"Target tasks missing from run_config.json: {missing_config}")

    parsed_rows: list[tuple[str, dict[str, Any]]] = []
    for raw in progress.read_text(encoding="utf-8-sig", errors="strict").splitlines():
        if not raw.strip():
            continue
        row = json.loads(raw)
        if not isinstance(row, dict):
            raise SystemExit("progress.jsonl contains a non-object JSON value")
        parsed_rows.append((raw, row))

    target_rows: dict[str, dict[str, Any]] = {}
    for task_id in TARGET_TASKS:
        matches = [row for _, row in parsed_rows if str(row.get("task_id") or "") == task_id]
        if len(matches) != 1:
            raise SystemExit(f"Expected exactly one row for {task_id}; found {len(matches)}")
        row = matches[0]
        if bool(row.get("success")) or str(row.get("status") or "") != "error":
            raise SystemExit(
                f"Refusing repair for {task_id}: success={row.get('success')!r}, status={row.get('status')!r}"
            )
        evidence = diagnostic_text(row, run_dir, task_id)
        missing_markers = [marker for marker in REQUIRED_ERROR_MARKERS if marker not in evidence]
        if missing_markers:
            raise SystemExit(
                f"Refusing repair for {task_id}: missing validated error markers {missing_markers}"
            )
        if row.get("score") is None:
            raise SystemExit(f"Refusing repair for {task_id}: score is missing")
        target_rows[task_id] = row

    stamp = dt.datetime.now().strftime("%Y%m%d-%H%M%S")
    backup_root = run_dir / "protocol-hotfix-backup" / f"responses-input-v0.1.3-{stamp}"
    backup_root.mkdir(parents=True, exist_ok=False)

    for path in (progress, partial, heartbeat, config_path):
        if path.exists():
            shutil.copy2(path, backup_root / path.name)

    atomic_write_json(
        backup_root / "removed_task_results.json",
        [target_rows[task_id] for task_id in TARGET_TASKS],
    )

    for task_id in TARGET_TASKS:
        for category, source in (
            ("workspaces", run_dir / "workspaces" / task_id),
            ("transcripts", run_dir / "transcripts" / task_id),
            ("judge_raw_responses", run_dir / "judge_raw_responses" / task_id),
        ):
            if source.exists():
                destination_root = backup_root / category
                destination_root.mkdir(parents=True, exist_ok=True)
                shutil.move(str(source), str(destination_root / task_id))

    # The cache is global to the benchmark results root. Moving it makes only
    # the missing tasks receive fresh judge calls; completed tasks remain skipped.
    judge_cache = run_dir.parent / ".judge_cache"
    if judge_cache.exists():
        shutil.move(str(judge_cache), str(backup_root / "judge_cache"))

    for stale_name in ("results.json", "results.csv", "results.xlsx"):
        stale = run_dir / stale_name
        if stale.exists():
            shutil.move(str(stale), str(backup_root / stale_name))

    target_set = set(TARGET_TASKS)
    remaining = [
        (raw, row)
        for raw, row in parsed_rows
        if str(row.get("task_id") or "") not in target_set
    ]
    atomic_write_text(progress, "".join(raw + "\n" for raw, _ in remaining))
    remaining_rows = [row for _, row in remaining]
    atomic_write_json(partial, {"completed": len(remaining_rows), "results": remaining_rows})
    atomic_write_json(
        heartbeat,
        {
            "at": dt.datetime.now(dt.timezone.utc).isoformat(),
            "state": "paused_responses_input_hotfix_ready",
            "removed_task_ids": TARGET_TASKS,
            "completed": len(remaining_rows),
            "task_count": len(configured_ids),
            "backup": str(backup_root),
            "pid": os.getpid(),
        },
    )

    print("PASS: removed only the three validated Responses input serialization failures.")
    print(f"Run dir   : {run_dir}")
    print(f"Backup    : {backup_root}")
    print(f"Remaining : {len(remaining_rows)} completed rows")
    for task_id in TARGET_TASKS:
        print(f"Rerun     : {task_id}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
