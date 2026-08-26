#!/usr/bin/env python3
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import shutil
import tempfile
from pathlib import Path
from typing import Any

TARGETS = (
    "task_deep_research",
    "task_oss_alternative_research",
    "task_pricing_research",
)
REPORTS = {
    "task_deep_research": "wasm_research.md",
    "task_oss_alternative_research": "oss_alternatives.md",
}
FAILED_ROW_TASK = "task_deep_research"
INVALID_MARKER = "Invalid Responses API request"


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8-sig"))


def atomic_write_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp_name = tempfile.mkstemp(
        prefix=path.name + ".", suffix=".tmp", dir=str(path.parent)
    )
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
    atomic_write_text(
        path,
        json.dumps(value, ensure_ascii=False, indent=2) + "\n",
    )


def result_rows(run_dir: Path) -> list[dict[str, Any]]:
    results_path = run_dir / "results.json"
    if results_path.exists():
        payload = read_json(results_path)
        rows = payload.get("results") if isinstance(payload, dict) else None
        if isinstance(rows, list):
            return [row for row in rows if isinstance(row, dict)]

    progress_path = run_dir / "progress.jsonl"
    rows: list[dict[str, Any]] = []
    if progress_path.exists():
        for raw in progress_path.read_text(
            encoding="utf-8-sig", errors="strict"
        ).splitlines():
            if raw.strip():
                value = json.loads(raw)
                if isinstance(value, dict):
                    rows.append(value)
    return rows


def row_evidence(row: dict[str, Any], transcript_dir: Path) -> str:
    pieces = [
        str(row.get("error") or ""),
        str(row.get("stderr") or ""),
        str(row.get("grade_error") or ""),
        json.dumps(row.get("turn_results") or [], ensure_ascii=False),
    ]
    if transcript_dir.exists():
        for path in sorted(transcript_dir.glob("*.stderr.txt")):
            pieces.append(
                path.read_text(encoding="utf-8-sig", errors="replace")
            )
        turn_results = transcript_dir / "turn_results.json"
        if turn_results.exists():
            pieces.append(
                turn_results.read_text(
                    encoding="utf-8-sig", errors="replace"
                )
            )
    return "\n".join(pieces)


def validate_canary(root: Path, task_id: str) -> dict[str, Any]:
    canary_root = (
        root
        / "canary-runs"
        / "canonical-history-v0.2.0"
        / task_id
    )
    if not canary_root.exists():
        raise SystemExit(f"Canary root is missing: {canary_root}")

    candidates = sorted(
        (
            path
            for path in canary_root.glob("grok_build_*")
            if path.is_dir()
        ),
        key=lambda path: path.stat().st_mtime,
        reverse=True,
    )

    failures: list[str] = []
    for run_dir in candidates:
        rows = result_rows(run_dir)
        row = next(
            (
                value
                for value in rows
                if value.get("task_id") == task_id
            ),
            None,
        )
        if row is None:
            failures.append(f"{run_dir}: result row missing")
            continue
        if (
            row.get("success") is not True
            or str(row.get("status") or "") != "success"
            or int(row.get("returncode") or 0) != 0
        ):
            failures.append(
                f"{run_dir}: success={row.get('success')} "
                f"status={row.get('status')} "
                f"returncode={row.get('returncode')}"
            )
            continue

        transcript_dir = run_dir / "transcripts" / task_id
        evidence = row_evidence(row, transcript_dir)
        if INVALID_MARKER.lower() in evidence.lower():
            failures.append(f"{run_dir}: contains invalid Responses evidence")
            continue

        report = (
            run_dir
            / "workspaces"
            / task_id
            / REPORTS[task_id]
        )
        if not report.exists() or report.stat().st_size < 1000:
            failures.append(f"{run_dir}: report missing/small: {report}")
            continue

        return {
            "task_id": task_id,
            "run_dir": str(run_dir),
            "score": row.get("score"),
            "elapsed": row.get("elapsed"),
            "report": str(report),
            "report_bytes": report.stat().st_size,
        }

    detail = "; ".join(failures[:5]) or "no candidate runs"
    raise SystemExit(
        f"No successful canonical v0.2.0 canary found for {task_id}: "
        f"{detail}"
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", required=True)
    parser.add_argument("--run-dir", required=True)
    parser.add_argument("--validate-only", action="store_true")
    args = parser.parse_args()

    root = Path(args.root).expanduser().resolve()
    run_dir = Path(args.run_dir).expanduser().resolve()

    progress_path = run_dir / "progress.jsonl"
    partial_path = run_dir / "results.partial.json"
    heartbeat_path = run_dir / "heartbeat.json"
    config_path = run_dir / "run_config.json"

    for required in (run_dir, progress_path, config_path):
        if not required.exists():
            raise SystemExit(f"Required path missing: {required}")

    canaries = {
        task_id: validate_canary(root, task_id)
        for task_id in REPORTS
    }

    config = read_json(config_path)
    configured = [str(value) for value in config.get("task_ids") or []]
    for task_id in TARGETS:
        if task_id not in configured:
            raise SystemExit(
                f"Target task is not in run_config.json: {task_id}"
            )

    parsed: list[tuple[str, dict[str, Any]]] = []
    for raw in progress_path.read_text(
        encoding="utf-8-sig", errors="strict"
    ).splitlines():
        if not raw.strip():
            continue
        value = json.loads(raw)
        if not isinstance(value, dict):
            raise SystemExit("progress.jsonl contains a non-object row")
        parsed.append((raw, value))

    current: dict[str, list[dict[str, Any]]] = {
        task_id: [
            row
            for _, row in parsed
            if str(row.get("task_id") or "") == task_id
        ]
        for task_id in TARGETS
    }

    failed_rows = current[FAILED_ROW_TASK]
    if len(failed_rows) != 1:
        raise SystemExit(
            f"Expected exactly one current {FAILED_ROW_TASK} row; "
            f"found {len(failed_rows)}"
        )

    failed = failed_rows[0]
    if (
        failed.get("success") is not False
        or str(failed.get("status") or "") != "error"
        or int(failed.get("returncode") or 0) == 0
    ):
        raise SystemExit(
            f"Refusing cleanup for {FAILED_ROW_TASK}: "
            f"success={failed.get('success')} "
            f"status={failed.get('status')} "
            f"returncode={failed.get('returncode')}"
        )

    failed_evidence = row_evidence(
        failed,
        run_dir / "transcripts" / FAILED_ROW_TASK,
    )
    if INVALID_MARKER.lower() not in failed_evidence.lower():
        raise SystemExit(
            f"Refusing cleanup for {FAILED_ROW_TASK}: "
            f"missing marker {INVALID_MARKER!r}"
        )

    failed_report = (
        run_dir
        / "workspaces"
        / FAILED_ROW_TASK
        / REPORTS[FAILED_ROW_TASK]
    )
    if not failed_report.exists() or failed_report.stat().st_size < 1000:
        raise SystemExit(
            "Refusing cleanup: the post-write failed task report is "
            f"missing or unexpectedly small: {failed_report}"
        )

    for task_id in ("task_oss_alternative_research", "task_pricing_research"):
        if current[task_id]:
            raise SystemExit(
                f"Refusing cleanup: {task_id} unexpectedly has "
                f"{len(current[task_id])} progress row(s)."
            )

    validation = {
        "validated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "canaries": canaries,
        "current_failed_row": {
            "task_id": failed.get("task_id"),
            "success": failed.get("success"),
            "status": failed.get("status"),
            "returncode": failed.get("returncode"),
            "score": failed.get("score"),
            "elapsed": failed.get("elapsed"),
            "error": failed.get("error"),
            "report": str(failed_report),
            "report_bytes": failed_report.stat().st_size,
        },
        "currently_absent_progress_rows": [
            "task_oss_alternative_research",
            "task_pricing_research",
        ],
        "completed_before_cleanup": len(parsed),
        "completed_after_cleanup": len(parsed) - 1,
    }

    if args.validate_only:
        print("PASS: canonical resume cleanup validation completed.")
        print(json.dumps(validation, ensure_ascii=False, indent=2))
        return 0

    stamp = dt.datetime.now().strftime("%Y%m%d-%H%M%S")
    backup = (
        run_dir
        / "protocol-hotfix-backup"
        / f"canonical-history-v0.2.0a-{stamp}"
    )
    backup.mkdir(parents=True, exist_ok=False)

    for path in (
        progress_path,
        partial_path,
        heartbeat_path,
        config_path,
    ):
        if path.exists():
            shutil.copy2(path, backup / path.name)

    atomic_write_json(backup / "validation_evidence.json", validation)
    atomic_write_json(backup / "removed_progress_row.json", failed)

    # Move all pending-target artifacts, including stale directories for tasks
    # whose progress rows were already absent.
    for task_id in TARGETS:
        for category in (
            "workspaces",
            "transcripts",
            "judge_raw_responses",
        ):
            source = run_dir / category / task_id
            if source.exists():
                destination_root = backup / category
                destination_root.mkdir(parents=True, exist_ok=True)
                destination = destination_root / task_id
                if destination.exists():
                    raise SystemExit(
                        f"Backup destination unexpectedly exists: {destination}"
                    )
                shutil.move(str(source), str(destination))

    judge_model = str(
        config.get("judge_model")
        or "openrouter/anthropic/claude-opus-5"
    )
    judge_slug = (
        re.sub(r"[^A-Za-z0-9._-]+", "_", judge_model).strip("_")
        or "judge"
    )
    judge_cache = (
        run_dir.parent
        / ".judge_cache"
        / judge_slug
    )
    if judge_cache.exists():
        cache_destination = backup / "judge_cache" / judge_slug
        cache_destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(judge_cache), str(cache_destination))

    for name in ("results.json", "results.csv", "results.xlsx"):
        path = run_dir / name
        if path.exists():
            shutil.move(str(path), str(backup / name))

    remaining = [
        (raw, row)
        for raw, row in parsed
        if str(row.get("task_id") or "") != FAILED_ROW_TASK
    ]
    atomic_write_text(
        progress_path,
        "".join(raw + "\n" for raw, _ in remaining),
    )
    rows = [row for _, row in remaining]
    atomic_write_json(
        partial_path,
        {"completed": len(rows), "results": rows},
    )
    atomic_write_json(
        heartbeat_path,
        {
            "at": dt.datetime.now(dt.timezone.utc).isoformat(),
            "state": "paused_canonical_history_v0.2.0_ready",
            "removed_task_ids": [FAILED_ROW_TASK],
            "pending_task_ids": list(TARGETS),
            "completed": len(rows),
            "task_count": len(configured),
            "backup": str(backup),
            "canaries": canaries,
            "pid": os.getpid(),
        },
    )

    print("PASS: original run is ready for canonical v0.2.0 resume.")
    print(f"Run dir   : {run_dir}")
    print(f"Backup    : {backup}")
    print(f"Remaining : {len(rows)} completed rows")
    print(
        "Removed   : task_deep_research "
        f"(failed execution, preserved score={failed.get('score')})"
    )
    print("Pending   : task_deep_research")
    print("Pending   : task_oss_alternative_research")
    print("Pending   : task_pricing_research")
    print(
        "Canary 1  : "
        f"task_deep_research score={canaries['task_deep_research']['score']}"
    )
    print(
        "Canary 2  : "
        "task_oss_alternative_research "
        f"score={canaries['task_oss_alternative_research']['score']}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
