from __future__ import annotations

import argparse
import json
import zipfile
from pathlib import Path

KEEP_BASE = (
    "results.json",
    "results.csv",
    "results.infra_adjusted.json",
    "results.infra_adjusted.csv",
    "infra_recovery_plan.json",
    "infra_recovery_plan.csv",
    "infra_recovery_manifest.json",
    "infra_recovery_latest.json",
    "summary.infra_adjusted.txt",
    "run_config.json",
)

def add_if_exists(z: zipfile.ZipFile, p: Path, arc: str) -> None:
    if p.exists() and p.is_file():
        z.write(p, arcname=arc)

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("run_dir")
    ap.add_argument("--output", default=None)
    args = ap.parse_args()

    run = Path(args.run_dir).expanduser().resolve()
    out = Path(args.output).expanduser().resolve() if args.output else run.parent / f"{run.name}_infra_adjusted_report.zip"

    marker_path = run / "infra_recovery_latest.json"
    recovery_run = None
    if marker_path.exists():
        marker = json.loads(marker_path.read_text(encoding="utf-8"))
        recovery_run = Path(marker.get("recovery_run_dir", "")).expanduser()
        if not recovery_run.is_absolute():
            recovery_run = (run / recovery_run).resolve()

    plan = {}
    plan_path = run / "infra_recovery_plan.json"
    if plan_path.exists():
        plan = json.loads(plan_path.read_text(encoding="utf-8"))
    ids = list(plan.get("eligible_task_ids") or [])

    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for name in KEEP_BASE:
            add_if_exists(z, run / name, f"base/{name}")

        if recovery_run and recovery_run.exists():
            for name in ("results.json","results.csv","results.partial.json","results.partial.csv","run_config.json","summary.txt"):
                add_if_exists(z, recovery_run / name, f"recovery/{name}")

        for tid in ids:
            tdir = run / "transcripts" / tid
            if tdir.exists():
                for name in ("normalized.jsonl","turn_results.json"):
                    add_if_exists(z, tdir / name, f"base_transcripts/{tid}/{name}")
                for p in sorted(tdir.glob("turn_*.jsonl")):
                    if p.name != "normalized.jsonl":
                        add_if_exists(z, p, f"base_transcripts/{tid}/{p.name}")

            if recovery_run:
                rtdir = recovery_run / "transcripts" / tid
                if rtdir.exists():
                    for name in ("normalized.jsonl","turn_results.json"):
                        add_if_exists(z, rtdir / name, f"recovery_transcripts/{tid}/{name}")
                    for p in sorted(rtdir.glob("turn_*.jsonl")):
                        if p.name != "normalized.jsonl":
                            add_if_exists(z, p, f"recovery_transcripts/{tid}/{p.name}")

    print(out)
    print(f"SizeMB={out.stat().st_size/1024/1024:.2f}")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
