#!/usr/bin/env python3
# Runner revision: 2026-08-13-superclaw-windows-headless-v1
"""
Run the local PinchBench task set through Intel SuperClaw Windows App's
headless OpenCode path.

Confirmed SuperClaw execution chain on Windows:
    Windows PowerShell
      -> wsl.exe -d superclaw-docker
      -> docker exec superclaw-backend
      -> opencode run --agent superclaw-default --model llmrouter/<slot>
      -> SuperClaw/OpenWork/OpenCode runtime
      -> llmrouter local/cloud/auto path

This runner intentionally reuses the existing PinchBench Windows runner for
task parsing, workspace fixture staging, transcript normalization, grading,
and report generation. The agent invocation layer is replaced with the
SuperClaw containerized OpenCode path discovered in the Windows installation.

Examples:
    # Preflight only: count tasks and verify SuperClaw backend/container.
    python runner/run_pinchbench_superclaw_windows.py --preflight --suite all

    # Canary: one automated task via SuperClaw cloud slot.
    python runner/run_pinchbench_superclaw_windows.py --suite automated-only --limit 1 --keep-workspaces --verbose

    # Canary: one judge-required task.
    python runner/run_pinchbench_superclaw_windows.py --suite judge-required-only --limit 1 --keep-workspaces --verbose

    # Full default suite. The local manifest contains 147 tasks; by default
    # the same four external integration tasks as the existing runner are
    # skipped, so this runs 143 tasks unless --include-default-skipped is set.
    python runner/run_pinchbench_superclaw_windows.py --suite all --keep-workspaces

    # Run all 147 manifest tasks, including GitHub/Google Workspace integration
    # tasks that may require extra credentials/tools.
    python runner/run_pinchbench_superclaw_windows.py --suite all --include-default-skipped --keep-workspaces
"""
from __future__ import annotations

import argparse
import csv
import datetime as dt
import hashlib
import json
import logging
import os
import platform
import queue
import re
import shlex
import shutil
import subprocess
import sys
import threading
import time
import traceback
import urllib.error
import urllib.request
from collections import Counter
from pathlib import Path
from typing import Any, Optional

os.environ.setdefault("PYTHONUTF8", "1")

# PINCHBENCH_UTF8_REEXEC
# Setting PYTHONUTF8 after Python has already started does not change the
# current process' default text encoding on Windows. Re-exec once in UTF-8
# mode before importing the base runner / grading engine so embedded
# automated graders using Path.read_text() without an explicit encoding
# read UTF-8 workspace files correctly.
if os.name == "nt" and not sys.flags.utf8_mode:
    os.execv(sys.executable, [sys.executable, "-X", "utf8", *sys.argv])

os.environ.setdefault("OPENCODE_DISABLE_AUTOUPDATE", "true")

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

try:
    import run_pinchbench_opencode_kimi_windows as base
except Exception as exc:  # pragma: no cover
    raise SystemExit(
        "无法导入相邻的 run_pinchbench_opencode_kimi_windows.py。"
        "请把本脚本放在 PinchBench repo 的 runner 目录下运行。"
        f"原始错误: {exc}"
    ) from exc

LOGGER = logging.getLogger("pinchbench-superclaw")

RUNNER_REVISION = "2026-08-13-superclaw-windows-headless-v1"
DEFAULT_MODEL = "llmrouter/cloud-model"
DEFAULT_AGENT = "superclaw-default"
DEFAULT_JUDGE_MODEL = base.DEFAULT_JUDGE_MODEL
DEFAULT_WSL_COMMAND = "wsl.exe"
DEFAULT_WSL_DISTRO = "superclaw-docker"
DEFAULT_CONTAINER = "superclaw-backend"
DEFAULT_CONTAINER_WORKSPACE_ROOT = "/workspace/pinchbench_runs"
DEFAULT_LLMROUTER_URL = "http://127.0.0.1:18321"


def shell_quote(value: str | Path) -> str:
    return shlex.quote(str(value))


def compact_error(text: str, limit: int = 1200) -> str:
    text = (text or "").strip()
    if len(text) <= limit:
        return text
    return text[:limit] + "...[truncated]"


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def run_capture(
    command: list[str],
    *,
    timeout: float = 60.0,
    cwd: Optional[Path] = None,
    log_path: Optional[Path] = None,
) -> dict[str, Any]:
    started = time.monotonic()
    command_text = " ".join(command)
    payload: dict[str, Any] = {
        "command": command,
        "command_text": command_text,
        "cwd": str(cwd) if cwd else None,
        "timeout": timeout,
        "returncode": None,
        "stdout": "",
        "stderr": "",
        "elapsed": None,
        "ok": False,
        "error": None,
    }

    try:
        result = subprocess.run(
            command,
            cwd=str(cwd) if cwd else None,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout,
            check=False,
        )
        payload.update({
            "returncode": result.returncode,
            "stdout": result.stdout or "",
            "stderr": result.stderr or "",
            "ok": result.returncode == 0,
        })
    except subprocess.TimeoutExpired as exc:
        payload.update({
            "returncode": None,
            "stdout": exc.stdout or "",
            "stderr": exc.stderr or "",
            "error": f"command timeout after {timeout:.0f}s",
        })
    except Exception as exc:
        payload["error"] = str(exc)
    finally:
        payload["elapsed"] = time.monotonic() - started
        if log_path:
            write_json(log_path, payload)
    return payload


def wsl_command(args: argparse.Namespace, inner: list[str]) -> list[str]:
    return [args.wsl_command, "-d", args.wsl_distro, "--", *inner]


def docker_exec_command(args: argparse.Namespace, shell_script: str) -> list[str]:
    return wsl_command(
        args,
        ["docker", "exec", args.container, "sh", "-lc", shell_script],
    )


def to_wsl_path(path: Path, args: argparse.Namespace, log_path: Optional[Path] = None) -> str:
    resolved = Path(path).expanduser().resolve()
    if sys.platform != "win32":
        return str(resolved)

    result = run_capture(
        wsl_command(args, ["wslpath", "-a", str(resolved).replace("\\", "/")]),
        timeout=30.0,
        log_path=log_path,
    )
    if result["ok"] and result["stdout"].strip():
        return result["stdout"].strip().splitlines()[-1]
    raise RuntimeError(
        "无法将 Windows 路径转换为 WSL 路径: "
        f"{resolved}. stderr={compact_error(result.get('stderr') or result.get('error') or '')}"
    )


def docker_cp_to_container(
    args: argparse.Namespace,
    host_path: Path,
    container_path: str,
    log_path: Path,
    *,
    copy_contents: bool = False,
) -> None:
    wsl_host_path = to_wsl_path(host_path, args, log_path.with_suffix(".wslpath.json"))
    if copy_contents:
        wsl_host_path = wsl_host_path.rstrip("/") + "/."
    result = run_capture(
        wsl_command(
            args,
            ["docker", "cp", wsl_host_path, f"{args.container}:{container_path}"],
        ),
        timeout=args.copy_timeout,
        log_path=log_path,
    )
    if not result["ok"]:
        raise RuntimeError(
            f"docker cp 到 container 失败: {host_path} -> {container_path}; "
            f"{compact_error(result.get('stderr') or result.get('error') or '')}"
        )


def docker_cp_from_container(
    args: argparse.Namespace,
    container_path: str,
    host_path: Path,
    log_path: Path,
) -> None:
    host_path.parent.mkdir(parents=True, exist_ok=True)
    wsl_host_path = to_wsl_path(host_path, args, log_path.with_suffix(".wslpath.json"))
    result = run_capture(
        wsl_command(
            args,
            ["docker", "cp", f"{args.container}:{container_path}", wsl_host_path],
        ),
        timeout=args.copy_timeout,
        log_path=log_path,
    )
    if not result["ok"]:
        raise RuntimeError(
            f"docker cp 从 container 失败: {container_path} -> {host_path}; "
            f"{compact_error(result.get('stderr') or result.get('error') or '')}"
        )


def container_run_capture(
    args: argparse.Namespace,
    shell_script: str,
    *,
    timeout: float = 60.0,
    log_path: Optional[Path] = None,
) -> dict[str, Any]:
    return run_capture(
        docker_exec_command(args, shell_script),
        timeout=timeout,
        log_path=log_path,
    )


def http_json(url: str, timeout: float = 10.0) -> dict[str, Any]:
    request = urllib.request.Request(url, headers={"Accept": "application/json"})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        body = response.read().decode("utf-8", errors="replace")
    try:
        return json.loads(body)
    except json.JSONDecodeError:
        return {"raw": body}


def get_llmrouter_models(args: argparse.Namespace) -> dict[str, Any]:
    url = args.llmrouter_url.rstrip("/") + "/v1/models"
    try:
        return http_json(url, timeout=10.0)
    except urllib.error.URLError as exc:
        return {"error": str(exc), "url": url}
    except Exception as exc:
        return {"error": str(exc), "url": url}


def superclaw_preflight(
    args: argparse.Namespace,
    preflight_dir: Path,
) -> tuple[list[str], dict[str, Any]]:
    checks: list[dict[str, Any]] = []
    failures: list[str] = []

    preflight_dir.mkdir(parents=True, exist_ok=True)
    llmrouter_models = get_llmrouter_models(args)
    write_json(preflight_dir / "llmrouter_models.json", llmrouter_models)
    model_ids = [
        item.get("id")
        for item in llmrouter_models.get("data", [])
        if isinstance(item, dict)
    ]
    if model_ids:
        print("SuperClaw LLMRouter models:", ", ".join(str(item) for item in model_ids))
    else:
        failures.append(
            "无法读取 SuperClaw LLMRouter /v1/models；请确认 Windows App 已启动并完成模型配置。"
        )

    commands = {
        "wsl_uname": wsl_command(args, ["uname", "-a"]),
        "docker_ps": wsl_command(args, ["docker", "ps", "--format", "{{.Names}}\t{{.Status}}\t{{.Image}}"]),
        "container_opencode": docker_exec_command(args, "command -v opencode && opencode --version 2>&1 || true"),
        "container_models": docker_exec_command(args, "opencode models 2>&1 || true"),
        "container_processes": docker_exec_command(args, "ps auxww | grep -E 'openwork|opencode|router|llm|intent' | grep -v grep || true"),
    }

    for name, command in commands.items():
        result = run_capture(
            command,
            timeout=30.0,
            log_path=preflight_dir / f"{name}.json",
        )
        checks.append({"name": name, **result})
        if not result["ok"]:
            failures.append(f"{name} 失败: {compact_error(result.get('stderr') or result.get('error') or '')}")

    if args.model not in {"llmrouter/auto", "llmrouter/local-model", "llmrouter/cloud-model"}:
        LOGGER.warning(
            "当前 --model=%s 不是已知 SuperClaw llmrouter slot；如果这是自定义模型，请忽略。",
            args.model,
        )
    elif model_ids and args.model.replace("llmrouter/", "") not in model_ids and args.model not in model_ids:
        failures.append(
            f"LLMRouter /v1/models 未列出 {args.model}。当前 models={model_ids}"
        )

    snapshot = {
        "llmrouter_models": llmrouter_models,
        "checks": checks,
        "failures": failures,
    }
    write_json(preflight_dir / "superclaw_preflight_summary.json", snapshot)
    return failures, snapshot


def parse_superclaw_streaming(
    cmd: list[str],
    timeout: float,
    raw_stdout_path: Path,
    stderr_path: Path,
    command_path: Path,
) -> dict[str, Any]:
    monotonic_start = time.monotonic()
    wall_start_ms = time.time() * 1000.0
    deadline = monotonic_start + timeout

    raw_stdout_path.parent.mkdir(parents=True, exist_ok=True)
    stderr_path.parent.mkdir(parents=True, exist_ok=True)
    command_path.write_text(
        json.dumps({"command": cmd, "timeout": timeout}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    stdout_lines: list[str] = []
    stderr_lines: list[str] = []
    non_json_stdout_lines: list[str] = []
    raw_events: list[dict[str, Any]] = []
    normalized_events: list[dict[str, Any]] = []
    output_chunks: list[str] = []
    event_counts: Counter[str] = Counter()

    session_id: Optional[str] = None
    ttft: Optional[float] = None
    error_messages: list[str] = []
    status = "success"
    timed_out = False

    usage_seen = False
    input_tokens = 0
    output_tokens = 0
    reasoning_tokens = 0
    cache_read_tokens = 0
    cache_write_tokens = 0
    cost_usd = 0.0
    step_count = 0
    tool_errors = 0
    finish_reasons: list[str] = []

    env = os.environ.copy()
    env.setdefault("PYTHONUTF8", "1")
    env.setdefault("OPENCODE_DISABLE_AUTOUPDATE", "true")
    env.setdefault("NO_COLOR", "1")

    creationflags = 0
    if sys.platform == "win32":
        creationflags = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)

    try:
        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="replace",
            bufsize=1,
            env=env,
            start_new_session=(sys.platform != "win32"),
            creationflags=creationflags,
        )
    except Exception as exc:
        return {
            "status": "error",
            "success": False,
            "returncode": None,
            "output": "",
            "error": f"无法启动 SuperClaw OpenCode: {exc}",
            "stderr": "",
            "elapsed": time.monotonic() - monotonic_start,
            "ttft": None,
            "input_tokens": None,
            "output_tokens": None,
            "reasoning_tokens": None,
            "cache_read_tokens": None,
            "cache_write_tokens": None,
            "cost_usd": None,
            "total_tokens": None,
            "usage_complete": False,
            "step_count": 0,
            "tool_errors": 0,
            "finish_reasons": [],
            "session_id": None,
            "raw_events": [],
            "normalized_events": [],
            "event_counts": {},
            "stdout_lines": [],
            "non_json_stdout_lines": [],
            "prompt_transport": "container_stdin_file",
        }

    if proc.stdout is None or proc.stderr is None:
        base.kill_proc_tree(proc)
        raise RuntimeError("SuperClaw OpenCode stdout/stderr pipe creation failed")

    output_queue: "queue.Queue[tuple[str, Optional[str]]]" = queue.Queue()
    threads = [
        threading.Thread(target=base._stream_reader, args=(proc.stdout, "stdout", output_queue), daemon=True),
        threading.Thread(target=base._stream_reader, args=(proc.stderr, "stderr", output_queue), daemon=True),
    ]
    for thread in threads:
        thread.start()

    open_streams = {"stdout", "stderr"}

    with (
        raw_stdout_path.open("w", encoding="utf-8", newline="") as raw_file,
        stderr_path.open("w", encoding="utf-8", newline="") as err_file,
    ):
        while open_streams or proc.poll() is None:
            if time.monotonic() > deadline:
                timed_out = True
                status = "timeout"
                error_messages.append(f"超时 ({timeout:.0f}s)")
                base.kill_proc_tree(proc)
                break

            try:
                kind, line = output_queue.get(timeout=0.2)
            except queue.Empty:
                continue

            if line is None:
                open_streams.discard(kind)
                continue

            clean_line = line.replace("\x00", "")
            if clean_line.startswith("\ufeff"):
                clean_line = clean_line.lstrip("\ufeff")

            if kind == "stderr":
                stderr_lines.append(clean_line)
                err_file.write(clean_line)
                err_file.flush()
                continue

            stdout_lines.append(clean_line)
            raw_file.write(clean_line)
            raw_file.flush()

            stripped = clean_line.strip()
            if not stripped:
                continue

            try:
                event = json.loads(stripped)
            except json.JSONDecodeError:
                non_json_stdout_lines.append(stripped)
                event_counts["non_json_stdout"] += 1
                pinned = re.search(r"pinned parent session:\s*(ses_[A-Za-z0-9]+)", stripped)
                if pinned and not session_id:
                    session_id = pinned.group(1)
                continue

            if not isinstance(event, dict):
                event_counts["non_object_json"] += 1
                continue

            raw_events.append(event)
            event_type = str(event.get("type") or "unknown")
            event_counts[event_type] += 1

            if not session_id and event.get("sessionID"):
                session_id = str(event.get("sessionID"))

            text = base.event_text(event)
            if text:
                if ttft is None:
                    part = event.get("part")
                    candidate: Optional[float] = None
                    if isinstance(part, dict):
                        part_time = part.get("time")
                        if isinstance(part_time, dict):
                            try:
                                start_ms = float(part_time.get("start"))
                                estimated = (start_ms - wall_start_ms) / 1000.0
                                if 0.0 <= estimated <= (time.monotonic() - monotonic_start + 5.0):
                                    candidate = estimated
                            except (TypeError, ValueError):
                                pass
                    ttft = candidate if candidate is not None else time.monotonic() - monotonic_start
                output_chunks.append(text)

            normalized_events.extend(base.normalize_opencode_event(event))

            usage = base.parse_step_finish(event)
            if usage is not None:
                usage_seen = True
                step_count += 1
                input_tokens += usage["input_tokens"]
                output_tokens += usage["output_tokens"]
                reasoning_tokens += usage["reasoning_tokens"]
                cache_read_tokens += usage["cache_read_tokens"]
                cache_write_tokens += usage["cache_write_tokens"]
                cost_usd += usage["cost_usd"]
                if usage["finish_reason"]:
                    finish_reasons.append(usage["finish_reason"])

            if event_type == "tool_use":
                part = event.get("part")
                if isinstance(part, dict):
                    state = part.get("state")
                    if isinstance(state, dict) and state.get("status") == "error":
                        tool_errors += 1

            event_error = base.extract_event_error(event)
            if event_error:
                error_messages.append(event_error)
                status = "error"

    try:
        proc.wait(timeout=15)
    except subprocess.TimeoutExpired:
        base.kill_proc_tree(proc)
        status = "timeout"
        timed_out = True
        error_messages.append("进程未正常退出，已强制终止")

    drain_deadline = time.monotonic() + 2.0
    while time.monotonic() < drain_deadline:
        try:
            kind, line = output_queue.get_nowait()
        except queue.Empty:
            break
        if line is None:
            continue
        clean_line = line.replace("\x00", "")
        if clean_line.startswith("\ufeff"):
            clean_line = clean_line.lstrip("\ufeff")
        if kind == "stderr":
            stderr_lines.append(clean_line)
        else:
            stdout_lines.append(clean_line)

    for thread in threads:
        thread.join(timeout=1)

    returncode = proc.returncode
    stderr = "".join(stderr_lines).strip()

    # Treat an empty zero-token terminal continuation after prior tool activity
    # as an infrastructure/runtime failure, not as a valid model completion.
    if status == "success" and raw_events:
        last_event = raw_events[-1]
        if last_event.get("type") == "step_finish":
            part = last_event.get("part") if isinstance(last_event.get("part"), dict) else {}
            tokens = part.get("tokens") if isinstance(part.get("tokens"), dict) else {}
            zero_terminal = all(
                int(tokens.get(key, 0) or 0) == 0
                for key in ("input", "output", "reasoning")
            )

            last_step_start = -1
            for idx in range(len(raw_events) - 2, -1, -1):
                if raw_events[idx].get("type") == "step_start":
                    last_step_start = idx
                    break

            semantic_after_start = (
                any(
                    event.get("type") in {"text", "tool_use"}
                    for event in raw_events[last_step_start + 1 : -1]
                )
                if last_step_start >= 0
                else True
            )
            prior_tool_activity = any(
                event.get("type") == "tool_use"
                for event in raw_events[: max(last_step_start, 0)]
            )

            if (
                zero_terminal
                and last_step_start >= 0
                and not semantic_after_start
                and prior_tool_activity
            ):
                status = "agent_infra_error"
                error_messages.append(
                    "SuperClaw execution stack produced an empty 0-token "
                    "terminal continuation after tool activity"
                )

    # PINCHBENCH_INFRA_SIGNATURES_V2
    # Detect two narrow forward-progress failures in the OpenCode/SuperClaw stream.
    if raw_events:
        last_event = raw_events[-1]
        last_type = str(last_event.get("type") or "")

        completed_child_before_last = False
        for event in raw_events[:-1]:
            if event.get("type") != "tool_use":
                continue
            part = event.get("part") if isinstance(event.get("part"), dict) else {}
            state = part.get("state") if isinstance(part.get("state"), dict) else {}
            if part.get("tool") == "task" and state.get("status") == "completed":
                completed_child_before_last = True
                break

        if status == "timeout" and last_type == "step_start" and completed_child_before_last:
            status = "agent_infra_error"
            error_messages.append(
                "SuperClaw child task completed but parent continuation stalled after final step_start"
            )

        if status == "timeout" and last_type == "step_start" and step_count == 0:
            status = "agent_infra_error"
            error_messages.append(
                "SuperClaw timed out with zero completed LLM steps; final event is step_start"
            )

    if returncode not in (0, None) and status == "success":
        status = "error"
        error_messages.append(stderr or f"SuperClaw OpenCode 退出码 {returncode}")

    output = "\n".join(chunk.strip() for chunk in output_chunks if chunk.strip()).strip()

    if (
        status == "success"
        and step_count <= 1
        and not output
        and usage_seen
        and input_tokens == 0
        and output_tokens == 0
        and reasoning_tokens == 0
    ):
        status = "agent_infra_error"
        error_messages.append(
            "SuperClaw process exited successfully with a completely empty 0-token completion"
        )

    success = status == "success" and not timed_out and returncode in (0, None)
    elapsed = time.monotonic() - monotonic_start

    return {
        "status": status,
        "success": success,
        "returncode": returncode,
        "output": output,
        "error": " | ".join(dict.fromkeys(message for message in error_messages if message)),
        "stderr": stderr,
        "elapsed": elapsed,
        "ttft": ttft,
        "input_tokens": input_tokens if usage_seen else None,
        "output_tokens": output_tokens if usage_seen else None,
        "reasoning_tokens": reasoning_tokens if usage_seen else None,
        "cache_read_tokens": cache_read_tokens if usage_seen else None,
        "cache_write_tokens": cache_write_tokens if usage_seen else None,
        "cost_usd": cost_usd if usage_seen else None,
        "usage_complete": usage_seen,
        "step_count": step_count,
        "tool_errors": tool_errors,
        "finish_reasons": finish_reasons,
        "session_id": session_id,
        "raw_events": raw_events,
        "normalized_events": normalized_events,
        "event_counts": dict(event_counts),
        "stdout_lines": stdout_lines,
        "non_json_stdout_lines": non_json_stdout_lines,
        "prompt_transport": "container_stdin_file",
    }


def is_retryable_agent_infra_failure(result: dict[str, Any]) -> bool:
    if str(result.get("status") or "") == "agent_infra_error":
        return True

    text = f"{result.get('error', '')}\n{result.get('stderr', '')}".lower()
    transient_markers = (
        "server disconnected",
        "upstream_status=500",
        "upstream_status=502",
        "upstream_status=503",
        "upstream_status=504",
        "http 500",
        "http 502",
        "http 503",
        "http 504",
        "econnreset",
        "connection reset",
        "connection aborted",
    )
    return any(marker in text for marker in transient_markers)


def task_failure_result(
    task: base.Task,
    workspace: Path,
    transcript_dir: Path,
    args: argparse.Namespace,
    status: str,
    error: str,
    elapsed: float = 0.0,
) -> dict[str, Any]:
    return {
        "task_id": task.task_id,
        "name": task.name,
        "category": task.category,
        "grading_type": task.grading_type,
        "model": args.model,
        "agent": args.agent,
        "network_task": base.is_network_task(task),
        "multi_session": task.multi_session,
        "session_count": 0,
        "success": False,
        "status": status,
        "returncode": None,
        "elapsed": elapsed,
        "ttft": None,
        "input_tokens": None,
        "output_tokens": None,
        "reasoning_tokens": None,
        "cache_read_tokens": None,
        "cache_write_tokens": None,
        "cost_usd": None,
        "total_tokens": None,
        "token_source": "opencode_step_finish",
        "token_coverage_complete": False,
        "token_verified_against_openrouter": False,
        "usage_complete": False,
        "step_count": 0,
        "tool_errors": 0,
        "output": "",
        "error": error,
        "stderr": "",
        "score": None,
        "breakdown": {},
        "grade_notes": "",
        "grade_error": error,
        "workspace": str(workspace),
        "transcript": str(transcript_dir),
        "normalized_transcript": [],
        "turn_results": [],
    }


def execute_task(
    task: base.Task,
    task_index: int,
    task_count: int,
    skill_dir: Path,
    workspace: Path,
    transcript_dir: Path,
    run_id: str,
    args: argparse.Namespace,
) -> dict[str, Any]:
    print(f"[{task_index}/{task_count}] {task.task_id} - {task.name}")
    prompt_preview = re.sub(r"\s+", " ", task.prompt)[:150]
    print(f"  prompt: {prompt_preview}{'...' if len(task.prompt) > 150 else ''}")

    task_started = time.monotonic()
    prerequisites = task.metadata.get("prerequisites") or []
    missing_prerequisites = (
        base.check_prerequisites(list(prerequisites))
        if prerequisites else []
    )
    if missing_prerequisites:
        error = f"缺少依赖: {', '.join(missing_prerequisites)}"
        print(f"  跳过: {error}\n")
        return task_failure_result(task, workspace, transcript_dir, args, "missing_prerequisite", error)

    if workspace.exists():
        shutil.rmtree(workspace)
    workspace.mkdir(parents=True, exist_ok=True)
    transcript_dir.mkdir(parents=True, exist_ok=True)

    staged, fixture_errors = base.stage_workspace_files(task, workspace, skill_dir)
    if staged:
        LOGGER.info(
            "  staged files: %s",
            ", ".join(staged[:8]) + (" ..." if len(staged) > 8 else ""),
        )
    if fixture_errors:
        error = "缺少或无效的 workspace fixture: " + " | ".join(fixture_errors)
        print(f"  失败: {error}\n")
        return task_failure_result(task, workspace, transcript_dir, args, "missing_fixture", error)

    safe_task_dir = re.sub(r"[^A-Za-z0-9_.-]+", "_", task.task_id)
    container_workspace = (
        args.container_workspace_root.rstrip("/")
        + "/"
        + shell_quote(run_id).strip("'").replace("/", "_")
        + "/"
        + safe_task_dir
    )

    container_info = {
        "run_id": run_id,
        "task_id": task.task_id,
        "workspace": str(workspace),
        "transcript_dir": str(transcript_dir),
        "container_workspace": container_workspace,
        "wsl_distro": args.wsl_distro,
        "container": args.container,
        "model": args.model,
        "agent": args.agent,
    }
    write_json(transcript_dir / "container_info.json", container_info)

    try:
        prep_script = (
            f"rm -rf {shell_quote(container_workspace)} && "
            f"mkdir -p {shell_quote(container_workspace)}"
        )
        prep = container_run_capture(
            args,
            prep_script,
            timeout=60.0,
            log_path=transcript_dir / "container_prepare.json",
        )
        if not prep["ok"]:
            raise RuntimeError(compact_error(prep.get("stderr") or prep.get("error") or "container prepare failed"))
        docker_cp_to_container(
            args,
            workspace,
            container_workspace,
            transcript_dir / "container_copy_in_workspace.json",
            copy_contents=True,
        )
    except Exception as exc:
        error = f"准备 SuperClaw container workspace 失败: {exc}"
        print(f"  失败: {error}\n")
        return task_failure_result(task, workspace, transcript_dir, args, "container_prepare_error", error)

    turns = base.build_turns(task)
    total_timeout = (
        args.network_timeout
        if base.is_network_task(task)
        else max(1.0, task.timeout_seconds * args.timeout_multiplier)
    )
    task_deadline = time.monotonic() + total_timeout

    normalized_transcript: list[dict[str, Any]] = []
    outputs: list[str] = []
    errors: list[str] = []
    stderr_chunks: list[str] = []
    turn_results: list[dict[str, Any]] = []

    current_session_id: Optional[str] = None
    task_status = "success"
    task_success = True
    returncode: Optional[int] = 0
    total_elapsed = 0.0
    task_ttft: Optional[float] = None
    input_tokens: Optional[int] = None
    output_tokens: Optional[int] = None
    reasoning_tokens: Optional[int] = None
    cache_read_tokens: Optional[int] = None
    cache_write_tokens: Optional[int] = None
    cost_usd: Optional[float] = None
    usage_complete = True
    step_count = 0
    tool_errors = 0
    event_counts: Counter[str] = Counter()

    for turn_index, turn in enumerate(turns, start=1):
        remaining = task_deadline - time.monotonic()
        if remaining <= 0:
            task_success = False
            task_status = "timeout"
            errors.append(f"任务总超时 ({total_timeout:.0f}s)")
            break

        turn_id = str(turn["id"])
        turn_prompt = str(turn["prompt"])
        new_session = bool(turn.get("new_session"))

        normalized_transcript.append(
            base.make_user_transcript_event(turn_prompt, turn_index, turn_id)
        )

        prompt = turn_prompt
        if not args.no_workspace_instruction:
            prompt += (
                "\n\nIMPORTANT: You are running in an isolated workspace. "
                "Read, write, and edit files only in the current working directory."
            )

        raw_path = transcript_dir / f"turn_{turn_index:02d}_{turn_id}.jsonl"
        stderr_path = transcript_dir / f"turn_{turn_index:02d}_{turn_id}.stderr.txt"
        prompt_path = transcript_dir / f"turn_{turn_index:02d}_{turn_id}.prompt.txt"
        command_path = transcript_dir / f"turn_{turn_index:02d}_{turn_id}.command.json"
        export_path = transcript_dir / f"turn_{turn_index:02d}_{turn_id}.session_export.json"

        prompt_payload = prompt if prompt.endswith("\n") else prompt + "\n"
        prompt_path.write_text(prompt_payload, encoding="utf-8", newline="\n")
        prompt_bytes = prompt_payload.encode("utf-8")
        prompt_sha256 = hashlib.sha256(prompt_bytes).hexdigest()

        container_prompt_path = (
            f"{container_workspace}/.pinchbench_turn_{turn_index:02d}_{turn_id}.prompt.txt"
        )
        try:
            docker_cp_to_container(
                args,
                prompt_path,
                container_prompt_path,
                transcript_dir / f"turn_{turn_index:02d}_{turn_id}.copy_prompt.json",
            )
        except Exception as exc:
            turn_result = {
                "status": "container_copy_error",
                "success": False,
                "returncode": None,
                "output": "",
                "error": f"复制 prompt 到 container 失败: {exc}",
                "stderr": "",
                "elapsed": 0.0,
                "ttft": None,
                "input_tokens": None,
                "output_tokens": None,
                "reasoning_tokens": None,
                "cache_read_tokens": None,
                "cache_write_tokens": None,
                "cost_usd": None,
                "usage_complete": False,
                "step_count": 0,
                "tool_errors": 0,
                "event_counts": {},
                "normalized_events": [],
                "session_id": current_session_id,
            }
        else:
            session_part = ""
            if not new_session and current_session_id:
                session_part = f" --session {shell_quote(current_session_id)}"
            shell_script = (
                f"cd {shell_quote(container_workspace)} && "
                "OPENCODE_DISABLE_AUTOUPDATE=true NO_COLOR=1 "
                "opencode run --format json "
                f"--model {shell_quote(args.model)} "
                f"--agent {shell_quote(args.agent)}"
                f"{session_part} < {shell_quote(container_prompt_path)}"
            )
            print(
                f"  turn {turn_index}/{len(turns)}: model={args.model}, "
                f"agent={args.agent}, timeout={remaining:.0f}s"
            )
            turn_result = parse_superclaw_streaming(
                docker_exec_command(args, shell_script),
                timeout=max(1.0, remaining),
                raw_stdout_path=raw_path,
                stderr_path=stderr_path,
                command_path=command_path,
            )

        normalized_transcript.extend(turn_result["normalized_events"])
        if turn_result.get("output"):
            outputs.append(f"## Turn {turn_index} ({turn_id})\n{turn_result['output']}")
        if turn_result.get("error"):
            errors.append(f"turn {turn_index} ({turn_id}): {turn_result['error']}")
        if turn_result.get("stderr"):
            stderr_chunks.append(f"## Turn {turn_index} ({turn_id})\n{turn_result['stderr']}")

        total_elapsed += float(turn_result.get("elapsed") or 0.0)
        if task_ttft is None and turn_result.get("ttft") is not None:
            task_ttft = float(turn_result["ttft"])

        input_tokens = base.aggregate_optional_int(input_tokens, turn_result.get("input_tokens"))
        output_tokens = base.aggregate_optional_int(output_tokens, turn_result.get("output_tokens"))
        reasoning_tokens = base.aggregate_optional_int(reasoning_tokens, turn_result.get("reasoning_tokens"))
        cache_read_tokens = base.aggregate_optional_int(cache_read_tokens, turn_result.get("cache_read_tokens"))
        cache_write_tokens = base.aggregate_optional_int(cache_write_tokens, turn_result.get("cache_write_tokens"))
        cost_usd = base.aggregate_optional_float(cost_usd, turn_result.get("cost_usd"))

        usage_complete = usage_complete and bool(turn_result.get("usage_complete"))
        step_count += int(turn_result.get("step_count") or 0)
        tool_errors += int(turn_result.get("tool_errors") or 0)
        event_counts.update(turn_result.get("event_counts") or {})

        returned_session_id = turn_result.get("session_id")
        if returned_session_id:
            current_session_id = str(returned_session_id)
            export = container_run_capture(
                args,
                f"cd {shell_quote(container_workspace)} && opencode export {shell_quote(current_session_id)} 2>&1",
                timeout=60.0,
                log_path=transcript_dir / f"turn_{turn_index:02d}_{turn_id}.export_command.json",
            )
            export_path.write_text(export.get("stdout") or export.get("stderr") or "", encoding="utf-8")

        turn_results.append({
            "turn": turn_index,
            "turn_id": turn_id,
            "new_session": new_session,
            "session_id": current_session_id,
            "success": turn_result.get("success"),
            "status": turn_result.get("status"),
            "returncode": turn_result.get("returncode"),
            "elapsed": turn_result.get("elapsed"),
            "ttft": turn_result.get("ttft"),
            "input_tokens": turn_result.get("input_tokens"),
            "output_tokens": turn_result.get("output_tokens"),
            "reasoning_tokens": turn_result.get("reasoning_tokens"),
            "cache_read_tokens": turn_result.get("cache_read_tokens"),
            "cache_write_tokens": turn_result.get("cache_write_tokens"),
            "total_tokens": base.derive_total_tokens(
                turn_result.get("input_tokens"),
                turn_result.get("output_tokens"),
                turn_result.get("reasoning_tokens"),
                turn_result.get("cache_read_tokens"),
                turn_result.get("cache_write_tokens"),
            ),
            "cost_usd": turn_result.get("cost_usd"),
            "token_source": "opencode_step_finish",
            "token_coverage_complete": bool(turn_result.get("usage_complete")),
            "token_verified_against_openrouter": False,
            "usage_complete": turn_result.get("usage_complete"),
            "step_count": turn_result.get("step_count"),
            "tool_errors": turn_result.get("tool_errors"),
            "event_counts": turn_result.get("event_counts"),
            "raw_transcript": str(raw_path),
            "stderr_path": str(stderr_path),
            "command_path": str(command_path),
            "session_export_path": str(export_path) if current_session_id else "",
            "prompt_transport": turn_result.get("prompt_transport"),
            "prompt_path": str(prompt_path),
            "container_prompt_path": container_prompt_path,
            "prompt_chars": len(prompt_payload),
            "prompt_bytes": len(prompt_bytes),
            "prompt_sha256": prompt_sha256,
            "non_json_stdout_lines": turn_result.get("non_json_stdout_lines") or [],
            "error": turn_result.get("error"),
        })

        if not turn_result.get("success"):
            task_success = False
            task_status = str(turn_result.get("status") or "error")
            returncode = turn_result.get("returncode")
            break

        returncode = turn_result.get("returncode")

    try:
        docker_cp_from_container(
            args,
            f"{container_workspace}/.",
            workspace,
            transcript_dir / "container_copy_back_workspace.json",
        )
    except Exception as exc:
        message = f"复制 container workspace 回 Windows 失败: {exc}"
        errors.append(message)
        if task_success:
            task_success = False
            task_status = "container_copy_back_error"

    normalized_path = transcript_dir / "normalized.jsonl"
    with normalized_path.open("w", encoding="utf-8") as file:
        for event in normalized_transcript:
            file.write(json.dumps(event, ensure_ascii=False) + "\n")

    turn_results_path = transcript_dir / "turn_results.json"
    write_json(turn_results_path, turn_results)

    print(
        f"  done: status={task_status}, success={task_success}, "
        f"agent_elapsed={total_elapsed:.1f}s, session={current_session_id or 'N/A'}"
    )

    return {
        "task_id": task.task_id,
        "name": task.name,
        "category": task.category,
        "grading_type": task.grading_type,
        "model": args.model,
        "agent": args.agent,
        "network_task": base.is_network_task(task),
        "multi_session": task.multi_session,
        "session_count": len(turn_results),
        "success": task_success,
        "status": task_status,
        "returncode": returncode,
        "elapsed": total_elapsed,
        "ttft": task_ttft,
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "reasoning_tokens": reasoning_tokens,
        "cache_read_tokens": cache_read_tokens,
        "cache_write_tokens": cache_write_tokens,
        "total_tokens": base.derive_total_tokens(
            input_tokens, output_tokens, reasoning_tokens, cache_read_tokens, cache_write_tokens
        ),
        "cost_usd": cost_usd,
        "token_source": "opencode_step_finish",
        "token_coverage_complete": usage_complete and bool(turn_results),
        "token_verified_against_openrouter": False,
        "usage_complete": usage_complete and bool(turn_results),
        "step_count": step_count,
        "tool_errors": tool_errors,
        "event_counts": dict(event_counts),
        "output": "\n\n".join(outputs),
        "error": " | ".join(errors),
        "stderr": "\n\n".join(stderr_chunks),
        "score": None,
        "breakdown": {},
        "grade_notes": "",
        "grade_error": None,
        "workspace": str(workspace),
        "transcript": str(transcript_dir),
        "container_workspace": container_workspace,
        "normalized_transcript_path": str(normalized_path),
        "transcript_data": normalized_transcript,
        "turn_results": turn_results,
        "task_wall_elapsed": time.monotonic() - task_started,
    }


def save_csv(results: list[dict[str, Any]], output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    fields = [
        "task_id", "name", "category", "grading_type", "model", "agent",
        "network_task", "multi_session", "session_count", "success", "status",
        "returncode", "score", "elapsed", "agent_elapsed", "grading_elapsed",
        "end_to_end_elapsed", "ttft", "input_tokens", "output_tokens",
        "reasoning_tokens", "cache_read_tokens", "cache_write_tokens",
        "total_tokens", "cost_usd", "token_source", "token_coverage_complete",
        "token_verified_against_openrouter", "usage_complete", "step_count",
        "tool_errors", "workspace", "container_workspace", "transcript",
        "error", "grade_error", "grade_notes",
    ]
    with output_path.open("w", newline="", encoding="utf-8-sig") as file:
        writer = csv.DictWriter(file, fieldnames=fields)
        writer.writeheader()
        for row in results:
            writer.writerow({key: base.truncate_excel(row.get(key), 10000) for key in fields})


def write_run_config(
    output_path: Path,
    args: argparse.Namespace,
    skill_dir: Path,
    tasks_dir: Path,
    selected_tasks: list[base.Task],
    all_task_count: int,
    skipped_task_ids: list[str],
    superclaw_snapshot: dict[str, Any],
) -> None:
    task_files = sorted(tasks_dir.glob("task_*.md"))
    config = {
        "runner_revision": RUNNER_REVISION,
        "created_at": dt.datetime.now().isoformat(timespec="seconds"),
        "platform": platform.platform(),
        "python": sys.version,
        "cwd": str(Path.cwd()),
        "skill_dir": str(skill_dir),
        "tasks_dir": str(tasks_dir),
        "manifest_task_count": all_task_count,
        "selected_task_count": len(selected_tasks),
        "selected_task_ids": [task.task_id for task in selected_tasks],
        "skipped_task_ids": skipped_task_ids,
        "default_skipped_tasks": sorted(base.DEFAULT_SKIPPED_TASKS),
        "include_default_skipped": args.include_default_skipped,
        "suite": args.suite,
        "limit": args.limit,
        "skip_network": args.skip_network,
        "model": args.model,
        "agent": args.agent,
        "judge_model": args.judge_model,
        "no_grade": args.no_grade,
        "timeout_multiplier": args.timeout_multiplier,
        "network_timeout": args.network_timeout,
        "judge_timeout": args.judge_timeout,
        "keep_workspaces": args.keep_workspaces,
        "wsl_command": args.wsl_command,
        "wsl_distro": args.wsl_distro,
        "container": args.container,
        "container_workspace_root": args.container_workspace_root,
        "llmrouter_url": args.llmrouter_url,
        "superclaw_snapshot": superclaw_snapshot,
        "task_file_count": len(task_files),
        "task_file_hashes": {
            path.name: base.sha256_file(path)
            for path in task_files
        },
    }
    write_json(output_path, config)


def print_preflight(
    selected: list[base.Task],
    all_task_count: int,
    skill_dir: Path,
    tasks_dir: Path,
    grader_module: Optional[Any],
    grader_error: Optional[str],
    args: argparse.Namespace,
    superclaw_failures: list[str],
) -> tuple[list[str], list[str]]:
    fixture_failures: list[str] = []
    prerequisite_failures: list[str] = []
    categories = Counter(task.category for task in selected)
    grading_types = Counter(task.grading_type for task in selected)

    print("=" * 100)
    print("PinchBench SuperClaw Windows 预检")
    print("=" * 100)
    print(f"Runner revision      : {RUNNER_REVISION}")
    print(f"Skill dir            : {skill_dir}")
    print(f"Tasks dir            : {tasks_dir}")
    print(f"Manifest tasks       : {all_task_count}")
    print(f"Selected tasks       : {len(selected)}")
    print(f"Default skipped      : {len(base.DEFAULT_SKIPPED_TASKS)}")
    print(f"Include default skip : {args.include_default_skipped}")
    print(f"Model                : {args.model}")
    print(f"Agent                : {args.agent}")
    print(f"WSL distro           : {args.wsl_distro}")
    print(f"Container            : {args.container}")
    print(f"Container root       : {args.container_workspace_root}")
    print(f"LLMRouter URL        : {args.llmrouter_url}")
    print(f"Judge model          : {args.judge_model}")
    print(f"Judge key present    : {bool(os.environ.get('OPENROUTER_API_KEY'))}")
    print(f"Grader loaded        : {grader_module is not None}")
    if grader_error:
        print(f"Grader error         : {grader_error}")

    print("-" * 100)
    print("Selected by category:")
    for key, value in sorted(categories.items()):
        print(f"  {key or '(unknown)':<22} {value}")
    print("Selected by grading type:")
    for key, value in sorted(grading_types.items()):
        print(f"  {key:<22} {value}")

    print("-" * 100)
    if superclaw_failures:
        print("SuperClaw checks:")
        for failure in superclaw_failures:
            print(f"  FAIL {failure}")
    else:
        print("SuperClaw checks     : PASS")

    print("-" * 100)
    for task in selected:
        staged, fixture_errors = base.stage_workspace_files(
            task,
            Path(os.environ.get("TEMP") or "/tmp") / f"pinchbench_preflight_{task.task_id}",
            skill_dir,
        )
        if fixture_errors:
            fixture_failures.append(f"{task.task_id}: {' | '.join(fixture_errors)}")
        prerequisites = task.metadata.get("prerequisites") or []
        missing = base.check_prerequisites(list(prerequisites)) if prerequisites else []
        if missing:
            prerequisite_failures.append(f"{task.task_id}: {', '.join(missing)}")

    print(f"Fixture failures     : {len(fixture_failures)}")
    print(f"Prerequisite failures: {len(prerequisite_failures)}")
    if args.verbose:
        for item in fixture_failures[:50]:
            print(f"  fixture: {item}")
        for item in prerequisite_failures[:50]:
            print(f"  prereq : {item}")
    print("=" * 100)
    return prerequisite_failures, fixture_failures


def build_args() -> argparse.Namespace:
    script_path = Path(__file__).resolve()
    inferred_root = script_path.parent.parent
    inferred_skill = inferred_root / "skill"

    parser = argparse.ArgumentParser(
        description=(
            "Run PinchBench through Intel SuperClaw Windows App headless "
            "WSL/container OpenCode path."
        ),
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument("--skill-dir", default=str(inferred_skill if inferred_skill.exists() else Path.cwd()), help="PinchBench skill 仓库根目录")
    parser.add_argument("--tasks-dir", default=None, help="任务目录；默认是 <skill-dir>/tasks")
    parser.add_argument("--suite", default="core", help="all、core、automated-only、llm-judge-only、hybrid-only、judge-required-only，或逗号分隔任务 ID")
    parser.add_argument("--limit", type=int, default=None, help="最多运行多少个任务，仅用于测试 runner")
    parser.add_argument("--skip", default="", help="额外跳过的任务 ID，逗号分隔")
    parser.add_argument("--include-default-skipped", action="store_true", help="包含默认跳过的 4 个外部集成任务；打开后 --suite all 可覆盖本地 manifest 全 147 题")
    parser.add_argument("--skip-network", action="store_true", help="跳过明确标记的联网任务；正式全量测试通常不应使用")
    parser.add_argument("--model", default=DEFAULT_MODEL, help="SuperClaw/OpenCode model，例如 llmrouter/cloud-model、llmrouter/local-model、llmrouter/auto")
    parser.add_argument("--agent", default=DEFAULT_AGENT, help="SuperClaw/OpenCode agent 名称")
    parser.add_argument("--wsl-command", default=DEFAULT_WSL_COMMAND, help="Windows wsl.exe 命令或绝对路径")
    parser.add_argument("--wsl-distro", default=DEFAULT_WSL_DISTRO, help="SuperClaw 使用的 WSL distro")
    parser.add_argument("--container", default=DEFAULT_CONTAINER, help="SuperClaw backend docker container 名称")
    parser.add_argument("--container-workspace-root", default=DEFAULT_CONTAINER_WORKSPACE_ROOT, help="container 内 PinchBench workspace 根目录")
    parser.add_argument("--llmrouter-url", default=DEFAULT_LLMROUTER_URL, help="Windows 侧 LLMRouter OpenAI-compatible URL，用于预检记录")
    parser.add_argument("--copy-timeout", type=float, default=300.0, help="docker cp 单次超时秒数")
    parser.add_argument("--timeout-multiplier", type=float, default=3.0, help="非联网任务 timeout_seconds 的倍数")
    parser.add_argument("--agent-infra-retries", type=int, default=1, help="仅对 0-token 空 continuation 或明确 5xx/断连等基础设施错误整题重试次数")
    parser.add_argument("--network-timeout", type=float, default=300.0, help="明确标记的联网任务总超时秒数")
    parser.add_argument("--judge-timeout", type=float, default=300.0, help="PinchBench 默认 LLM judge 单次请求超时秒数")
    parser.add_argument("--judge-model", default=DEFAULT_JUDGE_MODEL, help="PinchBench LLM judge model；正式口径固定 Claude Opus 5")
    parser.add_argument("--results-dir", default=None, help="运行结果根目录；默认是 <skill-dir>/../runs")
    parser.add_argument("--resume-run", default=None, help="从已有 SuperClaw run 目录的 results.partial.json 继续未完成任务")
    parser.add_argument("--keep-workspaces", action="store_true", help="保留成功任务 workspace；正式评测建议启用")
    parser.add_argument("--no-grade", action="store_true", help="只执行任务，不打分")
    parser.add_argument("--no-xlsx", action="store_true", help="不输出 XLSX")
    parser.add_argument("--no-workspace-instruction", action="store_true", help="不在 prompt 后追加隔离 workspace 提醒")
    parser.add_argument("--preflight", action="store_true", help="只做预检，不调用模型")
    parser.add_argument("--no-superclaw-check", action="store_true", help="跳过 WSL/container/LLMRouter 预检；主要用于非 Windows 环境检查任务选择")
    parser.add_argument("--no-judge-cache", action="store_true", help="禁用 PinchBench Judge 缓存")
    parser.add_argument("--clear-judge-cache", action="store_true", help="运行前清空 PinchBench Judge 缓存")
    parser.add_argument("--verbose", action="store_true", help="打印更详细日志")
    return parser.parse_args()


def main() -> int:
    args = build_args()
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)-8s %(message)s",
        datefmt="%H:%M:%S",
    )

    skill_dir = Path(args.skill_dir).expanduser().resolve()
    tasks_dir = Path(args.tasks_dir).expanduser().resolve() if args.tasks_dir else skill_dir / "tasks"

    if not skill_dir.exists():
        raise SystemExit(f"找不到 PinchBench skill 目录: {skill_dir}")
    if not tasks_dir.exists():
        raise SystemExit(f"找不到 tasks 目录: {tasks_dir}\n请确认 --skill-dir 指向本地 pinchbench/skill 仓库。")

    grader_module, grader_error = base.load_pinchbench_grading(skill_dir)
    judge_key_present = bool(os.environ.get("OPENROUTER_API_KEY"))

    all_tasks, core_tasks = base.load_tasks(tasks_dir)
    selected_before_skip = base.filter_tasks(all_tasks, core_tasks, args.suite, args.limit)

    skip_ids = set()
    if not args.include_default_skipped:
        skip_ids.update(base.DEFAULT_SKIPPED_TASKS)
    skip_ids.update(item.strip() for item in args.skip.split(",") if item.strip())
    if args.skip_network:
        skip_ids.update(task.task_id for task in selected_before_skip if base.is_network_task(task))

    selected = [task for task in selected_before_skip if task.task_id not in skip_ids]
    skipped_task_ids = sorted(task.task_id for task in selected_before_skip if task.task_id in skip_ids)

    if not selected:
        raise SystemExit("没有可运行任务。请检查 --suite/--limit/--skip。")

    resume_run_dir: Optional[Path] = None
    resume_config: dict[str, Any] = {}
    if args.resume_run:
        resume_run_dir = Path(args.resume_run).expanduser().resolve()
        resume_config_path = resume_run_dir / "run_config.json"
        resume_partial_path = resume_run_dir / "results.partial.json"
        if not resume_config_path.exists() or not resume_partial_path.exists():
            raise SystemExit(
                f"--resume-run 目录缺少 run_config.json 或 results.partial.json: {resume_run_dir}"
            )
        resume_config = json.loads(resume_config_path.read_text(encoding="utf-8"))
        original_ids = list(resume_config.get("selected_task_ids") or [])
        task_by_id = {task.task_id: task for task in all_tasks}
        missing_ids = [task_id for task_id in original_ids if task_id not in task_by_id]
        if missing_ids:
            raise SystemExit(f"恢复运行时找不到原任务定义: {missing_ids}")
        selected = [task_by_id[task_id] for task_id in original_ids]
        selected_before_skip = list(selected)
        skipped_task_ids = list(resume_config.get("skipped_task_ids") or [])

        for key, current in (
            ("model", args.model),
            ("agent", args.agent),
            ("judge_model", args.judge_model),
        ):
            original = resume_config.get(key)
            if original and str(original) != str(current):
                raise SystemExit(
                    f"恢复运行参数不一致: {key} 原值={original!r}, 当前={current!r}"
                )

    needs_judge = (
        not args.no_grade
        and any(task.grading_type in {"llm_judge", "hybrid"} for task in selected)
    )

    results_root = Path(args.results_dir).expanduser().resolve() if args.results_dir else skill_dir.parent / "runs"
    if resume_run_dir is not None:
        run_dir = resume_run_dir
        results_root = run_dir.parent
        run_id = run_dir.name
    else:
        run_id = dt.datetime.now().strftime("superclaw_%Y%m%d_%H%M%S")
        run_dir = results_root / run_id
    transcript_root = run_dir / "transcripts"
    workspace_root = run_dir / "workspaces"
    preflight_dir = run_dir / "preflight"
    run_dir.mkdir(parents=True, exist_ok=True)
    workspace_root.mkdir(parents=True, exist_ok=True)
    transcript_root.mkdir(parents=True, exist_ok=True)
    progress_path = run_dir / "progress.jsonl"
    partial_json_path = run_dir / "results.partial.json"

    superclaw_failures: list[str] = []
    superclaw_snapshot: dict[str, Any] = {"skipped": args.no_superclaw_check}
    if not args.no_superclaw_check:
        superclaw_failures, superclaw_snapshot = superclaw_preflight(args, preflight_dir)

    prerequisite_failures, fixture_failures = print_preflight(
        selected,
        len(all_tasks),
        skill_dir,
        tasks_dir,
        grader_module,
        grader_error,
        args,
        superclaw_failures,
    )

    config_output_path = (
        run_dir / f"run_config.resume_{dt.datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
        if resume_run_dir is not None
        else run_dir / "run_config.json"
    )
    write_run_config(
        config_output_path,
        args,
        skill_dir,
        tasks_dir,
        selected,
        len(all_tasks),
        skipped_task_ids,
        superclaw_snapshot,
    )

    if args.preflight:
        if fixture_failures:
            return 2
        if prerequisite_failures:
            return 3
        if grader_error:
            return 4
        if needs_judge and not judge_key_present:
            return 5
        if superclaw_failures:
            return 6
        return 0

    if superclaw_failures:
        raise SystemExit(
            "SuperClaw 预检失败，已停止正式执行。详情见 "
            f"{preflight_dir / 'superclaw_preflight_summary.json'}"
        )
    if grader_error and not args.no_grade:
        raise SystemExit(grader_error)
    if needs_judge and not judge_key_present:
        raise SystemExit(
            "所选任务包含 hybrid/llm_judge，但当前 PowerShell 未设置 OPENROUTER_API_KEY。"
            "为避免跑完后无法评分，已在正式执行前停止。"
        )

    judge_cache_dir = results_root / ".judge_cache"
    if (
        grader_module is not None
        and hasattr(grader_module, "set_judge_cache_dir")
        and not args.no_judge_cache
    ):
        grader_module.set_judge_cache_dir(judge_cache_dir)
        if args.clear_judge_cache and hasattr(grader_module, "clear_judge_cache"):
            grader_module.clear_judge_cache()

    print()
    print(f"Results dir          : {run_dir}")
    print("Agent path           : SuperClaw Windows -> WSL -> docker -> opencode run")
    print(f"SuperClaw model      : {args.model}")
    print(f"SuperClaw agent      : {args.agent}")
    print("Grading engine       : PinchBench scripts/lib_grading.py")
    print("Judge backend        : api")
    print(f"Judge model          : {args.judge_model}")
    print(f"Judge key            : {'set' if judge_key_present else 'not required'}")
    print(f"Judge cache          : {'disabled' if args.no_judge_cache else judge_cache_dir}")
    print()

    results: list[dict[str, Any]] = []
    completed_ids: set[str] = set()
    prior_elapsed = 0.0
    if resume_run_dir is not None and partial_json_path.exists():
        partial_payload = json.loads(partial_json_path.read_text(encoding="utf-8"))
        results = list(partial_payload.get("results") or [])
        completed_ids = {str(item.get("task_id")) for item in results if item.get("task_id")}
        prior_elapsed = sum(float(item.get("end_to_end_elapsed") or 0.0) for item in results)
        print(
            f"Resume               : {len(completed_ids)}/{len(selected)} 已完成, "
            f"剩余 {len(selected) - len(completed_ids)}"
        )

    total_started = time.monotonic()

    for index, task in enumerate(selected, start=1):
        if task.task_id in completed_ids:
            continue
        workspace = workspace_root / task.task_id
        transcript_dir = transcript_root / task.task_id
        task_end_to_end_started = time.monotonic()

        infra_retry_used = 0
        while True:
            try:
                result = execute_task(
                    task,
                    index,
                    len(selected),
                    skill_dir,
                    workspace,
                    transcript_dir,
                    run_id,
                    args,
                )
            except KeyboardInterrupt:
                raise
            except Exception as exc:
                LOGGER.exception("任务执行器内部异常: %s", task.task_id)
                result = task_failure_result(
                    task,
                    workspace,
                    transcript_dir,
                    args,
                    "runner_error",
                    f"{exc}\n{traceback.format_exc(limit=10)}",
                )

            if (
                infra_retry_used >= max(0, int(args.agent_infra_retries))
                or not is_retryable_agent_infra_failure(result)
            ):
                break

            infra_retry_used += 1

            failed_transcript_dir = transcript_dir.with_name(
                transcript_dir.name + f"__infra_failed_{infra_retry_used}"
            )
            failed_workspace = workspace.with_name(
                workspace.name + f"__infra_failed_{infra_retry_used}"
            )

            if failed_transcript_dir.exists():
                shutil.rmtree(failed_transcript_dir, ignore_errors=True)
            if failed_workspace.exists():
                shutil.rmtree(failed_workspace, ignore_errors=True)

            if transcript_dir.exists():
                transcript_dir.rename(failed_transcript_dir)
            if workspace.exists():
                workspace.rename(failed_workspace)

            LOGGER.warning(
                "Agent infrastructure failure for %s; retrying fresh task (%d/%d): %s",
                task.task_id,
                infra_retry_used,
                max(0, int(args.agent_infra_retries)),
                result.get("error") or result.get("status"),
            )

        result["agent_infra_retries_used"] = infra_retry_used

        agent_elapsed = float(result.get("elapsed") or 0.0)
        result["agent_elapsed"] = agent_elapsed

        grading_attempted = (
            result.get("status") not in {
                "missing_prerequisite",
                "missing_fixture",
                "container_prepare_error",
            }
            and not args.no_grade
        )
        grading_elapsed = 0.0
        if grading_attempted:
            grading_started = time.monotonic()
            grading_execution = dict(result)
            grading_execution["transcript"] = result.get("transcript_data", [])
            grade = base.grade_with_pinchbench_default(
                grader_module=grader_module,
                task=task,
                execution_result=grading_execution,
                workspace=workspace,
                skill_dir=skill_dir,
                judge_timeout=args.judge_timeout,
                judge_model=args.judge_model,
                verbose=args.verbose,
            )
            grading_elapsed = time.monotonic() - grading_started
            result["score"] = grade.score
            result["breakdown"] = grade.breakdown
            result["grade_notes"] = grade.notes
            result["grade_error"] = grade.error
            if grade.error:
                result["success"] = False
                if result.get("status") == "success":
                    result["status"] = "grade_error"
        elif args.no_grade:
            result["grade_notes"] = "grading disabled by --no-grade"
        else:
            result["grade_error"] = result.get("error") or "execution failed"

        result["grading_elapsed"] = grading_elapsed
        result["end_to_end_elapsed"] = time.monotonic() - task_end_to_end_started
        if result.get("score") is not None:
            result["score"] = round(float(result["score"]), 4)
        result.pop("transcript_data", None)
        results.append(result)

        with progress_path.open("a", encoding="utf-8") as progress_file:
            progress_file.write(json.dumps(result, ensure_ascii=False) + "\n")
            progress_file.flush()
        write_json(partial_json_path, {"completed": len(results), "results": results})
        save_csv(results, run_dir / "results.partial.csv")

        marker = "OK" if result.get("success") else "FAIL"
        score_text = f"score={result['score']:.3f}" if result.get("score") is not None else "score=N/A"
        token_text = (
            f"{result['input_tokens']}+{result['output_tokens']}"
            if result.get("usage_complete")
            else "N/A"
        )
        print(
            f"  {marker} agent={result['agent_elapsed']:.1f}s "
            f"grade={result['grading_elapsed']:.1f}s "
            f"e2e={result['end_to_end_elapsed']:.1f}s {score_text} "
            f"tokens(in+out)={token_text}"
        )
        if result.get("error"):
            print(f"  运行错误: {str(result['error'])[:500]}")
        if result.get("grade_error"):
            print(f"  打分错误: {str(result['grade_error'])[:500]}")
        if result.get("output"):
            preview = re.sub(r"\s+", " ", str(result["output"]))[:260]
            print(f"  输出预览: {preview}{'...' if len(str(result['output'])) > 260 else ''}")
        print()

        if not args.keep_workspaces and result.get("success") and workspace.exists():
            shutil.rmtree(workspace, ignore_errors=True)

    total_elapsed = prior_elapsed + (time.monotonic() - total_started)
    summary = base.print_summary(results, total_elapsed)
    summary.update({
        "Runner": RUNNER_REVISION,
        "SuperClaw model": args.model,
        "SuperClaw agent": args.agent,
        "Manifest tasks": len(all_tasks),
        "Selected tasks before skip": len(selected_before_skip),
        "Skipped tasks": len(skipped_task_ids),
    })

    write_json(run_dir / "results.json", results)
    save_csv(results, run_dir / "results.csv")
    write_json(run_dir / "summary.json", summary)
    if not args.no_xlsx:
        base.save_xlsx(results, summary, run_dir / "results.xlsx")

    if (
        grader_module is not None
        and hasattr(grader_module, "get_judge_cache_stats")
        and not args.no_judge_cache
    ):
        try:
            stats = grader_module.get_judge_cache_stats()
            print(
                "Judge cache stats   : "
                f"entries={stats.get('entries', 0)} "
                f"hits={stats.get('hits', 0)} "
                f"misses={stats.get('misses', 0)}"
            )
        except Exception as exc:
            LOGGER.warning("读取 Judge cache stats 失败: %s", exc)

    print(f"\n结果目录: {run_dir}")
    print(f"JSON    : {run_dir / 'results.json'}")
    print(f"CSV     : {run_dir / 'results.csv'}")
    if not args.no_xlsx:
        print(f"XLSX    : {run_dir / 'results.xlsx'}")
    print(f"Preflight: {preflight_dir}")
    print(f"Progress: {progress_path}")
    print(f"Partial : {partial_json_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
