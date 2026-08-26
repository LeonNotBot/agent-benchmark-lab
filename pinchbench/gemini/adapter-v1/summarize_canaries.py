#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8-sig"))


def read_jsonl(path: Path) -> list[Any]:
    output: list[Any] = []
    if not path.exists():
        return output
    for line in path.read_text(
        encoding="utf-8-sig",
        errors="replace",
    ).splitlines():
        if not line.strip():
            continue
        try:
            output.append(json.loads(line))
        except json.JSONDecodeError:
            output.append({"_raw": line})
    return output


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-dir", required=True)
    parser.add_argument("--adapter-log-dir", required=True)
    args = parser.parse_args()

    run_dir = Path(args.run_dir).resolve()
    adapter_log_dir = Path(args.adapter_log_dir).resolve()

    state_path = run_dir / "canary_state.json"
    if not state_path.exists():
        raise SystemExit(f"Missing state file: {state_path}")

    state = read_json(state_path)
    started_at = str(state.get("StartedAt") or "")
    completed_at = str(state.get("CompletedAt") or "")

    adapter_requests = read_jsonl(
        adapter_log_dir / "adapter_requests.jsonl"
    )

    relevant: list[dict[str, Any]] = []
    for record in adapter_requests:
        if not isinstance(record, dict):
            continue
        timestamp = str(record.get("timestamp") or "")
        if started_at and timestamp < started_at:
            continue
        if completed_at and timestamp > completed_at:
            continue
        relevant.append(record)

    completed = [
        item
        for item in relevant
        if item.get("phase") == "completed"
    ]
    failures = [
        item
        for item in relevant
        if item.get("error")
        or item.get("phase")
        in {
            "upstream_http",
            "upstream_connect",
            "stream_parse",
        }
    ]

    total_usage = {
        "input_tokens": 0,
        "output_tokens": 0,
        "total_tokens": 0,
    }
    providers: set[str] = set()
    models: set[str] = set()
    event_counts: dict[str, int] = {}
    tool_calls = 0

    for item in completed:
        usage = item.get("usage")
        if isinstance(usage, dict):
            for key in total_usage:
                value = usage.get(key)
                if isinstance(value, (int, float)):
                    total_usage[key] += int(value)
        provider = str(item.get("upstream_provider") or "")
        if provider:
            providers.add(provider)
        model = str(item.get("upstream_model") or "")
        if model:
            models.add(model)
        tool_calls += int(item.get("tool_call_count") or 0)
        counts = item.get("event_counts")
        if isinstance(counts, dict):
            for key, value in counts.items():
                if isinstance(value, (int, float)):
                    event_counts[str(key)] = (
                        event_counts.get(str(key), 0)
                        + int(value)
                    )

    steps = state.get("Steps")
    if not isinstance(steps, list):
        steps = []

    result = {
        "run_id": state.get("RunId"),
        "run_directory": str(run_dir),
        "adapter_version": state.get("AdapterVersion"),
        "forced_model": state.get("ForcedModel"),
        "passed": state.get("Passed"),
        "failed": state.get("Failed"),
        "skipped": state.get("Skipped"),
        "all_executed_passed": int(state.get("Failed") or 0) == 0,
        "steps": [
            {
                "name": step.get("Name"),
                "exit_code": step.get("ExitCode"),
                "result_status": step.get("ResultStatus"),
                "validation_passed": step.get("ValidationPassed"),
                "duration_seconds": step.get("DurationSeconds"),
                "skipped": step.get("Skipped", False),
            }
            for step in steps
            if isinstance(step, dict)
        ],
        "adapter_request_count": len(relevant),
        "adapter_completed_count": len(completed),
        "adapter_failure_count": len(failures),
        "upstream_models": sorted(models),
        "upstream_providers": sorted(providers),
        "total_usage": total_usage,
        "tool_calls_returned_by_model": tool_calls,
        "upstream_event_counts": event_counts,
        "ready_for_runner_work": (
            int(state.get("Failed") or 0) == 0
            and len(completed) >= 5
            and not failures
        ),
    }

    output = run_dir / "canary_summary.json"
    output.write_text(
        json.dumps(result, ensure_ascii=False, indent=2),
        encoding="utf-8",
        newline="\n",
    )
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
