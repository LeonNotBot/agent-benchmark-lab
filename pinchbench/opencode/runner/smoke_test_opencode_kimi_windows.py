#!/usr/bin/env python3
"""Windows smoke test for OpenCode + OpenRouter + MoonshotAI Kimi K3.

Creates an isolated toy workspace, runs one non-interactive OpenCode task using
OpenRouter's fixed Kimi K3 slug, preserves raw JSONL/stderr, and summarizes
wall-clock time plus every OpenCode step_finish token category.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path
from typing import Any, Optional

MODEL = "openrouter/moonshotai/kimi-k3"


def resolve_command(name: str) -> Optional[str]:
    candidates = [name]
    if sys.platform == "win32" and not Path(name).suffix:
        candidates = [f"{name}.cmd", f"{name}.exe", name]
    for candidate in candidates:
        found = shutil.which(candidate)
        if found:
            return found
    return None


def to_int(value: Any) -> int:
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


def to_float(value: Any) -> float:
    try:
        return float(value or 0.0)
    except (TypeError, ValueError):
        return 0.0


def main() -> int:
    parser = argparse.ArgumentParser(description="Smoke test OpenCode + Kimi K3 on native Windows")
    parser.add_argument("--root", default=r"C:\pinchbench-opencode-kimi\smoke")
    parser.add_argument("--opencode", default="auto")
    parser.add_argument("--model", default=MODEL)
    parser.add_argument("--timeout", type=float, default=300.0)
    args = parser.parse_args()

    if sys.platform != "win32":
        print("WARNING: this smoke test is intended for native Windows.")

    if args.opencode == "auto":
        opencode = resolve_command("opencode")
    else:
        opencode = resolve_command(args.opencode) or (args.opencode if Path(args.opencode).exists() else None)
    if not opencode:
        print("ERROR: 找不到 opencode。请先安装 opencode-ai 并重新打开 PowerShell。")
        return 2

    root = Path(args.root).expanduser().resolve()
    workspace = root / "workspace"
    logs = root / "logs"
    if workspace.exists():
        shutil.rmtree(workspace)
    workspace.mkdir(parents=True, exist_ok=True)
    logs.mkdir(parents=True, exist_ok=True)

    (workspace / "calculator.py").write_text(
        "def add(a, b):\n    return a + b\n",
        encoding="utf-8",
        newline="\n",
    )
    prompt = (
        "Inspect this repository. Add a subtract(a, b) function to calculator.py. "
        "Do not change unrelated files."
    )
    prompt_path = logs / "prompt.txt"
    prompt_path.write_text(prompt + "\n", encoding="utf-8", newline="\n")
    raw_path = logs / "stdout.jsonl"
    stderr_path = logs / "stderr.txt"
    result_path = logs / "smoke_result.json"

    print(f"OpenCode : {opencode}")
    try:
        version = subprocess.run(
            [opencode, "--version"], capture_output=True, text=True,
            encoding="utf-8", errors="replace", timeout=30, check=False,
        )
        print(f"Version  : {(version.stdout or version.stderr).strip()}")
    except Exception as exc:
        print(f"Version  : unavailable ({exc})")

    print(f"Model    : {args.model}")
    print(f"Workspace: {workspace}")
    print(f"Key env  : {'set' if os.environ.get('OPENROUTER_API_KEY') else 'not set (OpenCode stored auth may still work)'}")

    cmd = [
        opencode, "run",
        "--model", args.model,
        "--format", "json",
        "--dir", str(workspace),
    ]

    start = time.monotonic()
    first_text_at: Optional[float] = None
    step_count = 0
    usage_seen = False
    input_tokens = output_tokens = reasoning_tokens = 0
    cache_read_tokens = cache_write_tokens = 0
    cost_usd = 0.0
    session_id: Optional[str] = None
    errors: list[str] = []

    try:
        with prompt_path.open("rb") as stdin_file, raw_path.open("w", encoding="utf-8", newline="") as raw_file, stderr_path.open("w", encoding="utf-8", newline="") as err_file:
            proc = subprocess.Popen(
                cmd,
                cwd=str(workspace),
                stdin=stdin_file,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                encoding="utf-8",
                errors="replace",
                env={**os.environ, "PYTHONUTF8": "1", "OPENCODE_DISABLE_AUTOUPDATE": "true", "NO_COLOR": "1"},
            )
            try:
                stdout, stderr = proc.communicate(timeout=args.timeout)
            except subprocess.TimeoutExpired:
                subprocess.run(["taskkill", "/F", "/T", "/PID", str(proc.pid)], capture_output=True, check=False)
                stdout, stderr = proc.communicate()
                errors.append(f"timeout after {args.timeout:.0f}s")
            raw_file.write(stdout or "")
            err_file.write(stderr or "")
            returncode = proc.returncode
    except Exception as exc:
        print(f"ERROR: 无法执行 OpenCode: {exc}")
        return 3

    for line in (stdout or "").splitlines():
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue
        if not isinstance(event, dict):
            continue
        if not session_id and event.get("sessionID"):
            session_id = str(event.get("sessionID"))
        if first_text_at is None and event.get("type") == "text":
            first_text_at = time.monotonic()
        if event.get("type") != "step_finish":
            continue
        part = event.get("part")
        if not isinstance(part, dict):
            continue
        tokens = part.get("tokens") or {}
        if not isinstance(tokens, dict):
            continue
        cache = tokens.get("cache") or {}
        if not isinstance(cache, dict):
            cache = {}
        usage_seen = True
        step_count += 1
        input_tokens += to_int(tokens.get("input"))
        output_tokens += to_int(tokens.get("output"))
        reasoning_tokens += to_int(tokens.get("reasoning"))
        cache_read_tokens += to_int(cache.get("read"))
        cache_write_tokens += to_int(cache.get("write"))
        cost_usd += to_float(part.get("cost"))

    elapsed = time.monotonic() - start
    total_tokens = (
        input_tokens + output_tokens + reasoning_tokens + cache_read_tokens + cache_write_tokens
        if usage_seen else None
    )
    target_text = (workspace / "calculator.py").read_text(encoding="utf-8", errors="replace")
    file_ok = "def subtract" in target_text
    success = returncode == 0 and file_ok and not errors

    payload = {
        "success": success,
        "returncode": returncode,
        "model": args.model,
        "elapsed_seconds": round(elapsed, 6),
        "ttft_observed_seconds": round(first_text_at - start, 6) if first_text_at is not None else None,
        "session_id": session_id,
        "step_count": step_count,
        "input_tokens": input_tokens if usage_seen else None,
        "output_tokens": output_tokens if usage_seen else None,
        "reasoning_tokens": reasoning_tokens if usage_seen else None,
        "cache_read_tokens": cache_read_tokens if usage_seen else None,
        "cache_write_tokens": cache_write_tokens if usage_seen else None,
        "total_tokens": total_tokens,
        "cost_usd_opencode": round(cost_usd, 8) if usage_seen else None,
        "token_source": "opencode_step_finish",
        "token_verified_against_openrouter": False,
        "workspace_edit_verified": file_ok,
        "errors": errors,
        "raw_jsonl": str(raw_path),
        "stderr": str(stderr_path),
    }
    result_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    print("\n=== Smoke result ===")
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    print(f"\ncalculator.py:\n{target_text}")
    print(f"\nResult file: {result_path}")
    return 0 if success else 10


if __name__ == "__main__":
    raise SystemExit(main())
