from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from pathlib import Path

def main() -> int:
    ap = argparse.ArgumentParser(
        description="Run exactly one fresh recovery attempt for tasks approved by infra_recovery_plan.json."
    )
    ap.add_argument("root", help="pinchbench-superclaw-fixed-2.0.0 root")
    ap.add_argument("run_dir", help="original completed SuperClaw run directory")
    ap.add_argument("--plan", default=None)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    root = Path(args.root).expanduser().resolve()
    base_run = Path(args.run_dir).expanduser().resolve()
    plan_path = Path(args.plan).expanduser().resolve() if args.plan else base_run / "infra_recovery_plan.json"
    if not plan_path.exists():
        raise SystemExit(f"Plan not found: {plan_path}")

    plan = json.loads(plan_path.read_text(encoding="utf-8"))
    task_ids = list(plan.get("eligible_task_ids") or [])
    if not task_ids:
        print("No eligible tasks. Nothing to recover.")
        return 0

    cfg_path = base_run / "run_config.json"
    if not cfg_path.exists():
        raise SystemExit(f"Missing run_config.json: {cfg_path}")
    cfg = json.loads(cfg_path.read_text(encoding="utf-8"))

    runner = root / "runner" / "run_pinchbench_superclaw_windows.py"
    if not runner.exists():
        raise SystemExit(f"Runner not found: {runner}")

    recovery_root = base_run / "infra_recovery_runs"
    recovery_root.mkdir(parents=True, exist_ok=True)

    cmd = [
        str(Path(sys.executable)),
        str(runner),
        "--skill-dir", str(root / "skill"),
        "--suite", ",".join(task_ids),
        "--model", str(cfg.get("model") or "llmrouter/cloud-model"),
        "--agent", str(cfg.get("agent") or "superclaw-default"),
        "--timeout-multiplier", str(cfg.get("timeout_multiplier") or 3.0),
        "--network-timeout", str(cfg.get("network_timeout") or 300.0),
        "--judge-timeout", str(cfg.get("judge_timeout") or 300.0),
        "--judge-model", str(cfg.get("judge_model") or "openrouter/anthropic/claude-opus-5"),
        "--agent-infra-retries", "0",
        "--results-dir", str(recovery_root),
        "--keep-workspaces",
        "--verbose",
    ]

    print("Original run:", base_run)
    print("Recovery policy: exactly ONE fresh attempt; runner-level infra retries are disabled for this recovery.")
    print("Tasks:")
    for tid in task_ids:
        print(" ", tid)
    print("Command:")
    print(subprocess.list2cmdline(cmd))

    if args.dry_run:
        return 0

    before = {p.resolve() for p in recovery_root.glob("superclaw_*") if p.is_dir()}
    started = time.time()
    proc = subprocess.run(cmd, check=False)

    after = [
        p.resolve()
        for p in recovery_root.glob("superclaw_*")
        if p.is_dir() and p.resolve() not in before
    ]
    if not after:
        after = [
            p.resolve()
            for p in recovery_root.glob("superclaw_*")
            if p.is_dir() and p.stat().st_mtime >= started - 5
        ]
    if not after:
        raise SystemExit(
            f"Recovery runner finished with code {proc.returncode}, "
            "but a recovery run directory was not found."
        )

    recovery_run = max(after, key=lambda p: p.stat().st_mtime)
    marker = {
        "original_run": str(base_run),
        "plan": str(plan_path),
        "eligible_task_ids": task_ids,
        "recovery_run_dir": str(recovery_run),
        "runner_returncode": proc.returncode,
        "note": (
            "Exactly one fresh recovery attempt. The merge script accepts this "
            "attempt as the replacement even if its score is lower."
        ),
    }
    marker_path = base_run / "infra_recovery_latest.json"
    marker_path.write_text(
        json.dumps(marker, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    print("Recovery run:", recovery_run)
    print("Marker      :", marker_path)
    print("Runner exit :", proc.returncode)
    return proc.returncode

if __name__ == "__main__":
    raise SystemExit(main())
