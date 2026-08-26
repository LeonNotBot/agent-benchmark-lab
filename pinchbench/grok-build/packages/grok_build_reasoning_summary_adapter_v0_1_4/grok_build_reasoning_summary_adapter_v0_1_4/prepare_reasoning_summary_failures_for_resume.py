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
REQUIRED_MARKERS = [
    "Invalid Responses API request",
    "expected array, received undefined",
    "summary",
    "reasoning",
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


def evidence(row: dict[str, Any], run_dir: Path, task_id: str) -> str:
    parts = [
        str(row.get("error") or ""),
        str(row.get("stderr") or ""),
        json.dumps(row.get("turn_results") or [], ensure_ascii=False),
    ]
    transcript_dir = run_dir / "transcripts" / task_id
    if transcript_dir.exists():
        for path in sorted(transcript_dir.glob("*.stderr.txt")):
            parts.append(path.read_text(encoding="utf-8-sig", errors="replace"))
    return "\n".join(parts)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-dir", required=True)
    args = parser.parse_args()

    run_dir = Path(args.run_dir).expanduser().resolve()
    progress = run_dir / "progress.jsonl"
    partial = run_dir / "results.partial.json"
    config_path = run_dir / "run_config.json"
    heartbeat = run_dir / "heartbeat.json"
    for path in (run_dir, progress, config_path):
        if not path.exists():
            raise SystemExit(f"Required path missing: {path}")

    config = json.loads(config_path.read_text(encoding="utf-8-sig"))
    configured = [str(x) for x in config.get("task_ids") or []]
    for task_id in TARGET_TASKS:
        if task_id not in configured:
            raise SystemExit(f"{task_id} is not in run_config.json")

    parsed: list[tuple[str, dict[str, Any]]] = []
    for raw in progress.read_text(encoding="utf-8-sig", errors="strict").splitlines():
        if not raw.strip():
            continue
        row = json.loads(raw)
        if not isinstance(row, dict):
            raise SystemExit("progress.jsonl contains a non-object row")
        parsed.append((raw, row))

    selected: dict[str, dict[str, Any]] = {}
    for task_id in TARGET_TASKS:
        matches = [row for _, row in parsed if str(row.get("task_id") or "") == task_id]
        if len(matches) != 1:
            raise SystemExit(f"Expected exactly one current row for {task_id}; found {len(matches)}")
        row = matches[0]
        if bool(row.get("success")) or str(row.get("status") or "") != "error":
            raise SystemExit(f"Refusing cleanup for {task_id}: success={row.get('success')} status={row.get('status')}")
        if float(row.get("score") or 0.0) != 0.0:
            raise SystemExit(f"Refusing cleanup for {task_id}: expected score 0.0, actual={row.get('score')}")
        text = evidence(row, run_dir, task_id)
        missing = [marker for marker in REQUIRED_MARKERS if marker not in text]
        if missing:
            raise SystemExit(f"Refusing cleanup for {task_id}: missing evidence markers {missing}")
        selected[task_id] = row

    # task_pricing_research was removed by the earlier validated cleanup and has
    # not yet been rerun. It must remain absent so resume will run it.
    pricing_matches = [row for _, row in parsed if str(row.get("task_id") or "") == "task_pricing_research"]
    if pricing_matches:
        raise SystemExit("Refusing cleanup: task_pricing_research unexpectedly already has a current row.")

    stamp = dt.datetime.now().strftime("%Y%m%d-%H%M%S")
    backup = run_dir / "protocol-hotfix-backup" / f"reasoning-summary-v0.1.4-{stamp}"
    backup.mkdir(parents=True, exist_ok=False)

    for path in (progress, partial, heartbeat, config_path):
        if path.exists():
            shutil.copy2(path, backup / path.name)
    atomic_write_json(backup / "removed_task_results.json", [selected[x] for x in TARGET_TASKS])

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
    remaining = [(raw, row) for raw, row in parsed if str(row.get("task_id") or "") not in target_set]
    atomic_write_text(progress, "".join(raw + "\n" for raw, _ in remaining))
    rows = [row for _, row in remaining]
    atomic_write_json(partial, {"completed": len(rows), "results": rows})
    atomic_write_json(
        heartbeat,
        {
            "at": dt.datetime.now(dt.timezone.utc).isoformat(),
            "state": "paused_reasoning_summary_v0.1.4_ready",
            "removed_task_ids": TARGET_TASKS,
            "pending_task_id": "task_pricing_research",
            "completed": len(rows),
            "task_count": len(configured),
            "backup": str(backup),
            "pid": os.getpid(),
        },
    )

    print("PASS: removed only the two validated reasoning-summary failures.")
    print(f"Run dir   : {run_dir}")
    print(f"Backup    : {backup}")
    print(f"Remaining : {len(rows)} completed rows")
    print("Rerun     : task_deep_research")
    print("Rerun     : task_oss_alternative_research")
    print("Rerun     : task_pricing_research (already absent)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
