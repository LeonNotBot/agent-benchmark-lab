from pathlib import Path
import shutil, sys

root = Path(sys.argv[1]) if len(sys.argv) > 1 else Path.cwd()
runner = root / "runner" / "run_pinchbench_superclaw_windows.py"
if not runner.exists():
    raise SystemExit(f"NOT FOUND: {runner}")

s = runner.read_text(encoding="utf-8")

if "--judge-infra-retries" in s or 'result["judge_infra_retries_used"]' in s:
    raise SystemExit(
        "ABORT: older all-in-one reliability patch is already present. "
        "Restore run_pinchbench_superclaw_windows.py.before_reliability_fix.bak first, "
        "then run this agent-only patch."
    )

bak = runner.with_suffix(runner.suffix + ".before_agent_infra_retry_fix.bak")
if not bak.exists():
    shutil.copy2(runner, bak)

anchor = '''    returncode = proc.returncode
    stderr = "".join(stderr_lines).strip()

    if returncode not in (0, None) and status == "success":
'''
insert = '''    returncode = proc.returncode
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

    if returncode not in (0, None) and status == "success":
'''
if "empty 0-token terminal continuation after tool activity" not in s:
    if anchor not in s:
        raise SystemExit("Patch point A not found; file left unchanged")
    s = s.replace(anchor, insert, 1)

anchor2 = '''def task_failure_result(
'''
helper = '''def is_retryable_agent_infra_failure(result: dict[str, Any]) -> bool:
    if str(result.get("status") or "") == "agent_infra_error":
        return True

    text = f"{result.get('error', '')}\\n{result.get('stderr', '')}".lower()
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


'''
if "def is_retryable_agent_infra_failure" not in s:
    if anchor2 not in s:
        raise SystemExit("Patch point B not found; file left unchanged")
    s = s.replace(anchor2, helper + anchor2, 1)

anchor3 = '''    parser.add_argument("--timeout-multiplier", type=float, default=3.0, help="非联网任务 timeout_seconds 的倍数")
'''
opts = '''    parser.add_argument("--timeout-multiplier", type=float, default=3.0, help="非联网任务 timeout_seconds 的倍数")
    parser.add_argument("--agent-infra-retries", type=int, default=1, help="仅对 0-token 空 continuation 或明确 5xx/断连等基础设施错误整题重试次数")
'''
if "--agent-infra-retries" not in s:
    if anchor3 not in s:
        raise SystemExit("Patch point C not found; file left unchanged")
    s = s.replace(anchor3, opts, 1)

old = '''        try:
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
                f"{exc}\\n{traceback.format_exc(limit=10)}",
            )
'''
new = '''        infra_retry_used = 0
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
                    f"{exc}\\n{traceback.format_exc(limit=10)}",
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
'''
if 'result["agent_infra_retries_used"]' not in s:
    if old not in s:
        raise SystemExit("Patch point D not found; file left unchanged")
    s = s.replace(old, new, 1)

runner.write_text(s, encoding="utf-8", newline="\n")
print("PATCHED:", runner)
print("BACKUP :", bak)
print("FIX    : agent-only infrastructure retry; Judge logic is untouched")
