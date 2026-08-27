from pathlib import Path
import sys

root = Path(sys.argv[1]).expanduser().resolve() if len(sys.argv) > 1 else Path.cwd()
runner = root / "runner" / "run_pinchbench_superclaw_windows.py"
agent = root / "skill" / "scripts" / "lib_agent.py"
grading = root / "skill" / "scripts" / "lib_grading.py"

checks = []

def check(path, label, needles, any_mode=False):
    if not path.exists():
        checks.append((label, False, f"NOT FOUND: {path}"))
        return
    s = path.read_text(encoding="utf-8", errors="replace")
    ok = any(n in s for n in needles) if any_mode else all(n in s for n in needles)
    checks.append((label, ok, str(path)))

check(runner, "timeout CLI", ['--timeout-multiplier', '--network-timeout'])
check(runner, "Windows UTF-8 re-exec", ['PINCHBENCH_UTF8_REEXEC'])
check(runner, "targeted Agent infra retry", ['--agent-infra-retries', 'is_retryable_agent_infra_failure'])
check(runner, "SuperClaw infra signatures v2", ['PINCHBENCH_INFRA_SIGNATURES_V2'])
check(runner, "resume support", ['--resume-run'])
check(agent, "Judge 8192 budget", ['"max_completion_tokens": 8192', 'finish_reason in {"length", "max_tokens"}'])
check(grading, "Judge parse retry", ['Judge response was unparseable'])
check(grading, "Windows Git Bash wrapper v2", ['Do NOT pass Git Bash as subprocess', 'bash_executable, "-c"'])

failed = 0
for label, ok, detail in checks:
    print(f"{'PASS' if ok else 'FAIL'}  {label:<36} {detail}")
    failed += 0 if ok else 1

print(f"\nChecks={len(checks)} Failures={failed}")
if failed:
    print("Do NOT start the 2x timeout experiment yet. Apply/verify the missing patch(es) first.")
    raise SystemExit(2)
print("Stack audit passed.")
