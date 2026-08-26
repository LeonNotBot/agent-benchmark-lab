#!/usr/bin/env python3
from __future__ import annotations

import argparse
import ast
import hashlib
import json
import re
from pathlib import Path

TASK_IDS = (
    "task_csv_stations_by_elevation",
    "task_csv_stations_coverage",
    "task_csv_stations_filter",
    "task_csv_iris_classify",
    "task_csv_cities_filter",
    "task_csv_cities_density",
    "task_csv_pension_ranking",
    "task_meeting_advisory_acronyms",
)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--log", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    log_path = Path(args.log).resolve()
    output_path = Path(args.output).resolve()
    if not log_path.is_file():
        raise FileNotFoundError(log_path)

    lines = log_path.read_text(encoding="utf-8", errors="replace").splitlines()
    extracted: dict[str, dict[str, float]] = {}

    for index, line in enumerate(lines):
        match = re.search(r"Grading task (\S+) with type: hybrid", line)
        if not match:
            continue
        task_id = match.group(1)
        if task_id not in TASK_IDS:
            continue
        for candidate in lines[index + 1 : index + 12]:
            score_match = re.search(r"Automated grading scores: (\{.*\})", candidate)
            if not score_match:
                continue
            raw = ast.literal_eval(score_match.group(1))
            if not isinstance(raw, dict) or not raw:
                raise ValueError(f"Invalid automated score object for {task_id}")
            clean: dict[str, float] = {}
            for key, value in raw.items():
                if not isinstance(value, (int, float)) or isinstance(value, bool):
                    raise ValueError(f"Non-numeric automated score for {task_id}: {key}={value!r}")
                number = float(value)
                if number < 0.0 or number > 1.0:
                    raise ValueError(f"Out-of-range automated score for {task_id}: {key}={number}")
                clean[str(key)] = number
            extracted[task_id] = clean
            break

    missing = [task_id for task_id in TASK_IDS if task_id not in extracted]
    if missing:
        raise RuntimeError("Missing automated breakdowns in formal runner log: " + ", ".join(missing))

    payload = {
        "schema_version": 1,
        "source": "formal Gemini full-run verbose stderr",
        "source_log": str(log_path),
        "source_log_sha256": sha256_file(log_path),
        "task_count": len(extracted),
        "tasks": extracted,
    }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"PASS: recovered {len(extracted)} hybrid automated breakdowns")
    print(f"Source SHA256: {payload['source_log_sha256']}")
    print(f"Output: {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
