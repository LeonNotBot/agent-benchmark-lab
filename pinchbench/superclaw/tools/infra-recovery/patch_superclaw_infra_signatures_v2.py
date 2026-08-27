from pathlib import Path
import shutil
import sys

root = Path(sys.argv[1]) if len(sys.argv) > 1 else Path.cwd()
runner = root / "runner" / "run_pinchbench_superclaw_windows.py"
if not runner.exists():
    raise SystemExit(f"NOT FOUND: {runner}")

s = runner.read_text(encoding="utf-8")
bak = runner.with_suffix(runner.suffix + ".before_infra_signatures_v2.bak")
if not bak.exists():
    shutil.copy2(runner, bak)

anchor = '    if returncode not in (0, None) and status == "success":\n'
insert = '''    # PINCHBENCH_INFRA_SIGNATURES_V2
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
'''
if "PINCHBENCH_INFRA_SIGNATURES_V2" not in s:
    if anchor not in s:
        raise SystemExit("Patch point A not found; runner left unchanged")
    s = s.replace(anchor, insert, 1)

old = '''    success = status == "success" and not timed_out and returncode in (0, None)
    output = "\\n".join(chunk.strip() for chunk in output_chunks if chunk.strip()).strip()
    elapsed = time.monotonic() - monotonic_start
'''
new = '''    output = "\\n".join(chunk.strip() for chunk in output_chunks if chunk.strip()).strip()

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
'''
if "completely empty 0-token completion" not in s:
    if old not in s:
        raise SystemExit("Patch point B not found; runner left unchanged")
    s = s.replace(old, new, 1)

runner.write_text(s, encoding="utf-8", newline="\n")
print("PATCHED:", runner)
print("BACKUP :", bak)
print("NOTE   : for FUTURE runs only; ordinary token-producing deadline timeouts remain non-retryable")
