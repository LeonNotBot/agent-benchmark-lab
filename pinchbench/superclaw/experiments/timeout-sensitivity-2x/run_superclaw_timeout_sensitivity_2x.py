from __future__ import annotations
import argparse, json, os, subprocess, sys, time
from pathlib import Path

def load_rows(path: Path):
    data=json.loads(path.read_text(encoding="utf-8-sig"))
    if isinstance(data,list): return data
    if isinstance(data,dict) and isinstance(data.get("results"),list): return data["results"]
    raise SystemExit(f"Unsupported results format: {path}")

def main():
    ap=argparse.ArgumentParser(description="Run only the current final SuperClaw timeout tasks with 2x deadline.")
    ap.add_argument("root")
    ap.add_argument("base_run")
    ap.add_argument("--timeout-multiplier", type=float, default=6.0)
    ap.add_argument("--network-timeout", type=float, default=600.0)
    ap.add_argument("--agent-infra-retries", type=int, default=1)
    ap.add_argument("--dry-run", action="store_true")
    args=ap.parse_args()

    root=Path(args.root).expanduser().resolve()
    base_run=Path(args.base_run).expanduser().resolve()
    runner=root/"runner"/"run_pinchbench_superclaw_windows.py"
    baseline=base_run/"results.infra_adjusted.json"
    if not baseline.exists():
        raise SystemExit(f"NOT FOUND: {baseline}")
    if not runner.exists():
        raise SystemExit(f"NOT FOUND: {runner}")

    runner_text=runner.read_text(encoding="utf-8", errors="replace")
    required = {
        "--agent-infra-retries": "--agent-infra-retries" in runner_text,
        "PINCHBENCH_INFRA_SIGNATURES_V2": "PINCHBENCH_INFRA_SIGNATURES_V2" in runner_text,
        "PINCHBENCH_UTF8_REEXEC": "PINCHBENCH_UTF8_REEXEC" in runner_text,
    }
    missing=[k for k,v in required.items() if not v]
    if missing:
        raise SystemExit("Current runner is missing required final-stack fixes: " + ", ".join(missing))

    rows=load_rows(baseline)
    targets=[r for r in rows if str(r.get("status") or "")=="timeout"]
    ids=[str(r["task_id"]) for r in targets]
    network=[r for r in targets if bool(r.get("network_task"))]
    local=[r for r in targets if not bool(r.get("network_task"))]

    print(f"Baseline: {baseline}")
    print(f"Timeout tasks: {len(targets)}")
    print(f"  network: {len(network)}")
    print(f"  non-network: {len(local)}")
    print(f"2x settings: network_timeout={args.network_timeout:.0f}s, timeout_multiplier={args.timeout_multiplier:g}")
    print("Policy: every selected timeout task is rerun once under the new deadline; no max-score selection.")
    print("Agent infra retry remains limited to explicit infra signatures only.")
    for r in targets:
        print(f"  {r['task_id']:<38} score={float(r.get('score') or 0):.4f} network={bool(r.get('network_task'))}")

    if len(targets) != 30:
        print(f"WARNING: expected 30 timeout tasks from the current final result, found {len(targets)}.")
    if args.dry_run:
        return 0

    if not os.environ.get("OPENROUTER_API_KEY"):
        raise SystemExit("OPENROUTER_API_KEY is missing in this PowerShell. Stop before running.")
    cfg=json.loads((base_run/"run_config.json").read_text(encoding="utf-8-sig"))
    results_root=base_run/"timeout_sensitivity_2x_runs"
    results_root.mkdir(parents=True, exist_ok=True)

    before={p.resolve() for p in results_root.glob("superclaw_*") if p.is_dir()}
    cmd=[
        sys.executable, "-X", "utf8", str(runner),
        "--suite", ",".join(ids),
        "--model", str(cfg.get("model") or "llmrouter/cloud-model"),
        "--agent", str(cfg.get("agent") or "superclaw-default"),
        "--timeout-multiplier", str(args.timeout_multiplier),
        "--network-timeout", str(args.network_timeout),
        "--judge-timeout", str(float(cfg.get("judge_timeout") or 300.0)),
        "--judge-model", str(cfg.get("judge_model") or "openrouter/anthropic/claude-opus-5"),
        "--agent-infra-retries", str(max(0,args.agent_infra_retries)),
        "--results-dir", str(results_root),
        "--keep-workspaces", "--verbose",
    ]
    print("\nLaunching:")
    print(subprocess.list2cmdline(cmd))
    started=time.time()
    rc=subprocess.run(cmd).returncode
    after=sorted(
        [p.resolve() for p in results_root.glob("superclaw_*") if p.is_dir() and (p.resolve() not in before or p.stat().st_mtime >= started-2)],
        key=lambda p:p.stat().st_mtime, reverse=True
    )
    if not after:
        raise SystemExit(f"Runner returned {rc}, but no new run directory was found under {results_root}")
    exp=after[0]
    marker={
        "base_run": str(base_run),
        "baseline_results": str(baseline),
        "experiment_run_dir": str(exp),
        "timeout_multiplier": args.timeout_multiplier,
        "network_timeout": args.network_timeout,
        "agent_infra_retries": args.agent_infra_retries,
        "task_ids": ids,
        "runner_returncode": rc,
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "policy": "Replace all selected timeout tasks with this 2x-deadline result regardless of score direction; no cherry-picking."
    }
    (base_run/"timeout_sensitivity_2x_latest.json").write_text(json.dumps(marker,ensure_ascii=False,indent=2),encoding="utf-8")
    print(f"\nExperiment run: {exp}")
    print(f"Marker: {base_run/'timeout_sensitivity_2x_latest.json'}")
    print(f"Runner return code: {rc}")
    return rc

if __name__=="__main__":
    raise SystemExit(main())
