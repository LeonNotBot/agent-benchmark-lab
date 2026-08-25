#!/usr/bin/env python3
from __future__ import annotations

import argparse
import copy
import csv
import datetime as dt
import importlib.util
import json
import os
import shutil
import sys
import time
import traceback
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

FAILURE_MARKERS = (
    "llm judge failed",
    "no parseable response",
    "response parsed but no score",
    "openrouter_api_key not set",
    "judge api call failed",
)

def load_module(path: Path, name: str):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Cannot import {path}")
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod

def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8-sig"))

def read_jsonl(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8-sig", errors="replace") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                item = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(item, dict):
                rows.append(item)
    return rows

def resolve_bash() -> str | None:
    # Benchmark policy is Windows-native. Prefer Git for Windows Bash and do
    # not silently fall into the Windows System32 WSL bash launcher.
    candidates = [
        Path(r"C:\Program Files\Git\bin\bash.exe"),
        Path(r"C:\Program Files\Git\usr\bin\bash.exe"),
        Path(r"C:\Program Files (x86)\Git\bin\bash.exe"),
    ]
    for p in candidates:
        if p.exists():
            return str(p)
    found = shutil.which("bash")
    if found and "\\git\\" in str(found).lower():
        return str(Path(found).resolve())
    return None

def normalize_content(content: Any) -> str:
    if content is None:
        return ""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for item in content:
            if isinstance(item, str):
                parts.append(item)
            elif isinstance(item, dict):
                text = item.get("text") or item.get("content")
                if text is not None:
                    parts.append(str(text))
        return "\n".join(parts)
    return str(content)

def install_patches(grader: Any, judge_model: str) -> dict[str, Any]:
    patches: dict[str, Any] = {
        "utf8_process_mode": bool(sys.flags.utf8_mode),
        "judge_model": judge_model,
        "judge_json_schema": True,
        "judge_parse_retry": True,
        "judge_none_content_guard": True,
        "windows_git_bash_compat": False,
    }

    # 1) Guard against OpenRouter returning message.content = null.
    original_parse = grader._parse_judge_text
    def safe_parse(raw_text: Any) -> dict[str, Any]:
        text = normalize_content(raw_text)
        if not text.strip():
            return {}
        return original_parse(text)
    grader._parse_judge_text = safe_parse

    # 2) Windows compatibility for the one task whose embedded official
    # automated check hard-codes executable="/bin/bash".
    bash_path = resolve_bash()
    original_extract = grader._extract_grading_code
    def patched_extract(task: Any) -> str:
        code = original_extract(task)
        if os.name == "nt" and '/bin/bash' in code:
            if not bash_path:
                raise RuntimeError(
                    "task_git_rescue_recovery grader requires Git Bash, but bash.exe was not found."
                )
            code = code.replace('executable="/bin/bash"', f"executable={bash_path!r}")
            code = code.replace("executable='/bin/bash'", f"executable={bash_path!r}")
        return code
    grader._extract_grading_code = patched_extract
    patches["windows_git_bash_compat"] = bool(bash_path)
    patches["bash_path"] = bash_path or ""

    # 3) Make an API response count as success only when it contains a parseable
    # judge payload. This activates the official grader's existing retry loop
    # instead of accepting malformed/empty content as a successful API call.
    def robust_call_judge_api(*, prompt: str, model: str, timeout_seconds: float = 300.0) -> dict[str, Any]:
        key = os.environ.get("OPENROUTER_API_KEY", "")
        if not key:
            return {"status": "error", "text": "", "error": "OPENROUTER_API_KEY not set"}

        bare_model = model.removeprefix("openrouter/")
        endpoint = "https://openrouter.ai/api/v1/chat/completions"
        system_msg = (
            "You are a strict grading function. "
            "Respond with ONLY a JSON object, no prose, no markdown fences, no extra text."
        )
        schema = {
            "name": "pinchbench_grade",
            "strict": True,
            "schema": {
                "type": "object",
                "properties": {
                    "scores": {
                        "type": "object",
                        "additionalProperties": {"type": "number", "minimum": 0.0, "maximum": 1.0},
                    },
                    "total": {"type": "number", "minimum": 0.0, "maximum": 1.0},
                    "notes": {"type": "string"},
                },
                "required": ["scores", "total", "notes"],
                "additionalProperties": False,
            },
        }

        last_error = ""
        # First try structured output. If an upstream route rejects the optional
        # parameter, fall back to the same request without it while preserving
        # the same model, prompt and default OpenRouter routing.
        for structured in (True, False):
            body: dict[str, Any] = {
                "model": bare_model,
                "messages": [
                    {"role": "system", "content": system_msg},
                    {"role": "user", "content": prompt},
                ],
                "temperature": 0.0,
                "max_completion_tokens": 2048,
            }
            if structured:
                body["response_format"] = {"type": "json_schema", "json_schema": schema}

            req = urllib.request.Request(
                endpoint,
                data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
                headers={
                    "Authorization": f"Bearer {key}",
                    "Content-Type": "application/json",
                },
                method="POST",
            )
            try:
                with urllib.request.urlopen(req, timeout=timeout_seconds) as resp:
                    data = json.loads(resp.read().decode("utf-8"))
            except urllib.error.HTTPError as exc:
                try:
                    detail = exc.read().decode("utf-8", errors="replace")[:1000]
                except Exception:
                    detail = ""
                last_error = f"HTTP {exc.code}: {detail}"
                # Structured-output support can vary by provider route; try the
                # fallback request before surfacing the error.
                if structured and exc.code in (400, 404, 422):
                    continue
                return {"status": "error", "text": "", "error": last_error}
            except urllib.error.URLError as exc:
                return {"status": "error", "text": "", "error": str(exc)}
            except TimeoutError:
                return {"status": "timeout", "text": "", "error": "Request timed out"}
            except Exception as exc:
                return {"status": "error", "text": "", "error": f"{type(exc).__name__}: {exc}"}

            choices = data.get("choices") or []
            if not choices:
                last_error = "No choices in response"
                if structured:
                    continue
                return {"status": "error", "text": "", "error": last_error}

            message = choices[0].get("message") or {}
            text = normalize_content(message.get("content"))
            parsed = safe_parse(text)
            looks_like = getattr(grader, "_looks_like_judge_payload", lambda x: bool(x))(parsed)
            if looks_like:
                # Canonicalize so the downstream parser sees clean JSON.
                return {
                    "status": "success",
                    "text": json.dumps(parsed, ensure_ascii=False),
                }

            last_error = "Judge response had empty or non-parseable JSON content"
            # Return error, not success: the official _grade_llm_judge loop will
            # retry instead of breaking immediately.
            if structured:
                continue
            return {"status": "error", "text": text, "error": last_error}

        return {"status": "error", "text": "", "error": last_error or "Judge call failed"}

    grader.call_judge_api = robust_call_judge_api
    return patches

def score_from_grade_result(result: Any, task: Any) -> tuple[float | None, dict[str, Any], str, str | None]:
    raw_score = getattr(result, "score", None)
    max_score = getattr(result, "max_score", 1.0) or 1.0
    notes = str(getattr(result, "notes", "") or "")
    breakdown = dict(getattr(result, "breakdown", {}) or {})
    error: str | None = None

    if task.grading_type in {"llm_judge", "hybrid"}:
        low = notes.lower()
        if any(marker in low for marker in FAILURE_MARKERS):
            error = notes or "LLM judge failed"

    if error or raw_score is None:
        return None, breakdown, notes, error

    score = float(raw_score) / float(max_score)
    return max(0.0, min(1.0, score)), breakdown, notes, None

def result_rows(payload: Any) -> list[dict[str, Any]]:
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        rows = payload.get("results") or payload.get("tasks")
        if isinstance(rows, list):
            return rows
    raise RuntimeError("Unsupported results.json shape")

def make_summary(rows: list[dict[str, Any]], original_rows: list[dict[str, Any]], meta: dict[str, Any]) -> dict[str, Any]:
    scores = [float(r["score"]) for r in rows if r.get("score") is not None]
    orig_scores = [float(r["score"]) for r in original_rows if r.get("score") is not None]
    clean = [
        float(r["score"]) for r in rows
        if r.get("success") and not r.get("grade_error") and r.get("score") is not None
    ]
    return {
        "任务总数": len(rows),
        "执行成功": sum(1 for r in rows if r.get("success")),
        "执行失败": sum(1 for r in rows if not r.get("success")),
        "超时任务数": sum(1 for r in rows if r.get("status") == "timeout"),
        "重评分有分数任务数": len(scores),
        "重评分失败任务数": sum(1 for r in rows if r.get("grade_error")),
        "原始平均分": round(sum(orig_scores) / len(orig_scores), 4) if orig_scores else None,
        "重评分平均分": round(sum(scores) / len(scores), 4) if scores else None,
        "执行成功且评分干净平均分": round(sum(clean) / len(clean), 4) if clean else None,
        "Judge": meta["judge_model"],
        "重评分范围": meta["scope"],
        "原Agent输出是否冻结": True,
        "原run是否修改": False,
        "UTF8模式": bool(sys.flags.utf8_mode),
        "Judge结构化输出": True,
        "Judge解析失败重试": True,
        "Windows Git Bash兼容补丁": meta["patches"].get("windows_git_bash_compat"),
    }

def save_comparison_csv(path: Path, originals: dict[str, dict[str, Any]], rows: list[dict[str, Any]]) -> None:
    fields = [
        "task_id","name","grading_type","success","status","network_task",
        "original_score","regraded_score","delta","regrade_error","regrade_notes",
        "agent_elapsed","ttft","error","workspace","transcript",
    ]
    with path.open("w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        for r in rows:
            o = originals[r["task_id"]]
            old = o.get("score")
            new = r.get("score")
            delta = None if old is None or new is None else float(new) - float(old)
            w.writerow({
                "task_id": r.get("task_id"),
                "name": r.get("name"),
                "grading_type": r.get("grading_type"),
                "success": r.get("success"),
                "status": r.get("status"),
                "network_task": r.get("network_task"),
                "original_score": old,
                "regraded_score": new,
                "delta": delta,
                "regrade_error": r.get("grade_error") or "",
                "regrade_notes": r.get("grade_notes") or "",
                "agent_elapsed": r.get("agent_elapsed") or r.get("elapsed"),
                "ttft": r.get("ttft"),
                "error": r.get("error") or "",
                "workspace": r.get("workspace"),
                "transcript": r.get("transcript"),
            })

def main() -> int:
    ap = argparse.ArgumentParser(description="Frozen-output regrade for OpenCode + Kimi K3 PinchBench run")
    ap.add_argument("--root", default=r"C:\pinchbench-opencode-kimi")
    ap.add_argument("--run-dir", required=True)
    ap.add_argument("--judge-model", default="openrouter/anthropic/claude-opus-5")
    ap.add_argument("--judge-timeout", type=float, default=300.0)
    ap.add_argument("--scope", choices=("full","problems"), default="full")
    ap.add_argument("--verbose", action="store_true")
    args = ap.parse_args()

    root = Path(args.root).resolve()
    run_dir = Path(args.run_dir).resolve()
    skill_dir = root / "skill"
    runner_path = root / "runner" / "run_pinchbench_opencode_kimi_windows.py"
    if not runner_path.exists():
        raise SystemExit(f"Runner not found: {runner_path}")
    if not (run_dir / "results.json").exists():
        raise SystemExit(f"results.json not found: {run_dir}")
    if not os.environ.get("OPENROUTER_API_KEY"):
        raise SystemExit("OPENROUTER_API_KEY is missing in this PowerShell window")

    config = read_json(run_dir / "run_config.json")
    expected_commit = str(config.get("pinchbench_commit") or "")
    actual_commit = ""
    try:
        import subprocess
        actual_commit = subprocess.check_output(
            ["git", "-C", str(skill_dir), "rev-parse", "HEAD"],
            text=True, encoding="utf-8", errors="replace"
        ).strip()
    except Exception:
        pass
    if expected_commit and actual_commit and expected_commit != actual_commit:
        raise SystemExit(f"PinchBench commit mismatch: run={expected_commit} current={actual_commit}")

    runner = load_module(runner_path, "kimi_runner_regrade")
    scripts_dir = skill_dir / "scripts"
    sys.path.insert(0, str(scripts_dir))
    # Force a fresh import so patches affect this process only.
    for name in ("lib_grading", "lib_agent"):
        sys.modules.pop(name, None)
    import lib_grading as grader  # type: ignore

    patches = install_patches(grader, args.judge_model)

    tasks, _ = runner.load_tasks(skill_dir / "tasks")
    task_by_id = {t.task_id: t for t in tasks}

    payload = read_json(run_dir / "results.json")
    originals = result_rows(payload)
    original_by_id = {r["task_id"]: copy.deepcopy(r) for r in originals}

    if args.scope == "problems":
        selected_ids = {
            r["task_id"] for r in originals
            if r.get("grade_error") or r.get("score") is None
        }
    else:
        selected_ids = {r["task_id"] for r in originals}

    stamp = dt.datetime.now().strftime("%Y%m%d_%H%M%S")
    out_dir = run_dir / f"regrade_opus5_{args.scope}_{stamp}"
    scratch_root = out_dir / "_scratch"
    out_dir.mkdir(parents=True, exist_ok=True)
    scratch_root.mkdir(parents=True, exist_ok=True)

    rows = [copy.deepcopy(r) for r in originals]
    row_by_id = {r["task_id"]: r for r in rows}
    log_path = out_dir / "regrade.log"

    def log(msg: str) -> None:
        print(msg, flush=True)
        with log_path.open("a", encoding="utf-8") as f:
            f.write(msg + "\n")

    meta = {
        "created_at": dt.datetime.now(dt.timezone.utc).astimezone().isoformat(),
        "source_run": str(run_dir),
        "source_run_config": config,
        "judge_model": args.judge_model,
        "judge_timeout": args.judge_timeout,
        "scope": args.scope,
        "patches": patches,
        "selected_task_ids": [r["task_id"] for r in originals if r["task_id"] in selected_ids],
    }
    (out_dir / "regrade_config.json").write_text(
        json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    selected_order = [r["task_id"] for r in originals if r["task_id"] in selected_ids]
    log(f"Frozen-output regrade: {len(selected_order)} task(s)")
    log(f"Judge: {args.judge_model}")
    log(f"Source run: {run_dir}")
    log("Original Agent outputs are read-only; grading uses scratch workspace copies.")

    for i, tid in enumerate(selected_order, 1):
        row = row_by_id[tid]
        task = task_by_id.get(tid)
        if task is None:
            row["score"] = None
            row["grade_error"] = "Regrade: task definition not found"
            row["grade_notes"] = ""
            log(f"[{i}/{len(selected_order)}] {tid}: ERROR task definition not found")
            continue

        src_ws = Path(str(original_by_id[tid].get("workspace") or (run_dir / "workspaces" / tid)))
        transcript_path = Path(
            str(original_by_id[tid].get("normalized_transcript_path") or
                (run_dir / "transcripts" / tid / "normalized.jsonl"))
        )
        scratch = scratch_root / tid

        try:
            if scratch.exists():
                shutil.rmtree(scratch)
            if not src_ws.exists():
                raise FileNotFoundError(f"Frozen workspace missing: {src_ws}")
            shutil.copytree(src_ws, scratch)
            if not transcript_path.exists():
                raise FileNotFoundError(f"Normalized transcript missing: {transcript_path}")
            transcript = read_jsonl(transcript_path)

            execution = copy.deepcopy(original_by_id[tid])
            execution["workspace"] = str(scratch)
            execution["transcript"] = transcript

            t0 = time.monotonic()
            result = grader.grade_task(
                task=task,
                execution_result=execution,
                skill_dir=skill_dir,
                judge_model=args.judge_model,
                judge_timeout_seconds=args.judge_timeout,
                judge_backend="api",
                verbose=args.verbose,
            )
            elapsed = time.monotonic() - t0
            score, breakdown, notes, grade_error = score_from_grade_result(result, task)

            row["score"] = round(score, 4) if score is not None else None
            row["breakdown"] = breakdown
            row["grade_notes"] = notes
            row["grade_error"] = grade_error
            row["regrade_elapsed"] = round(elapsed, 3)
            old = original_by_id[tid].get("score")
            log(
                f"[{i}/{len(selected_order)}] {tid}: "
                f"{old!s} -> {row['score']!s} "
                f"({elapsed:.1f}s)"
                + (f" ERROR={grade_error}" if grade_error else "")
            )
        except Exception as exc:
            row["score"] = None
            row["breakdown"] = {}
            row["grade_notes"] = ""
            row["grade_error"] = f"Regrade failed: {exc}\n{traceback.format_exc(limit=8)}"
            log(f"[{i}/{len(selected_order)}] {tid}: ERROR {exc}")
        finally:
            if scratch.exists():
                shutil.rmtree(scratch, ignore_errors=True)

        # Incremental checkpoint after every task.
        checkpoint = {
            "source_run": str(run_dir),
            "judge_model": args.judge_model,
            "scope": args.scope,
            "results": rows,
        }
        (out_dir / "results.regraded.partial.json").write_text(
            json.dumps(checkpoint, ensure_ascii=False, indent=2), encoding="utf-8"
        )

    shutil.rmtree(scratch_root, ignore_errors=True)

    summary = make_summary(rows, originals, meta)
    final_payload = {
        "regrade": meta,
        "summary": summary,
        "results": rows,
    }
    (out_dir / "results.regraded.json").write_text(
        json.dumps(final_payload, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    save_comparison_csv(out_dir / "regrade_comparison.csv", original_by_id, rows)

    # Standard runner-format CSV/XLSX for convenient downstream comparison.
    runner.save_csv(rows, out_dir / "results.regraded.csv")
    runner.save_xlsx(rows, summary, out_dir / "results.regraded.xlsx")

    log("")
    log("SUMMARY")
    for k, v in summary.items():
        log(f"{k}: {v}")
    log(f"Output: {out_dir}")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
