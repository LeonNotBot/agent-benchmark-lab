from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from urllib import request, error

def load_jsonl(path: Path):
    out = []
    if not path.exists():
        return out
    for line in path.read_text(encoding="utf-8").splitlines():
        try:
            x = json.loads(line)
        except Exception:
            continue
        if isinstance(x, dict):
            out.append(x)
    return out

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("root")
    ap.add_argument("run_dir")
    ap.add_argument("task_id")
    args = ap.parse_args()

    root = Path(args.root).resolve()
    run_dir = Path(args.run_dir).resolve()
    sys.path.insert(0, str(root / "runner"))
    sys.path.insert(0, str(root / "skill" / "scripts"))

    import run_pinchbench_opencode_kimi_windows as base
    import lib_grading
    import lib_agent

    tasks, _ = base.load_tasks(root / "skill" / "tasks")
    task = next((t for t in tasks if t.task_id == args.task_id), None)
    if task is None:
        raise SystemExit(f"Task not found: {args.task_id}")

    transcript = load_jsonl(run_dir / "transcripts" / args.task_id / "normalized.jsonl")
    workspace = run_dir / "workspaces" / args.task_id
    transcript_summary = lib_grading._summarize_transcript(transcript)
    workspace_content = lib_grading._read_workspace_files(str(workspace))
    rubric = task.llm_judge_rubric or lib_grading._format_grading_criteria(task)
    prompt = lib_grading._build_judge_prompt(task, transcript_summary, rubric, workspace_content)

    cfg = json.loads((run_dir / "run_config.json").read_text(encoding="utf-8"))
    model = str(cfg.get("judge_model") or "openrouter/anthropic/claude-opus-5")
    api_model = model.removeprefix("openrouter/")
    key = os.environ.get("OPENROUTER_API_KEY")
    if not key:
        raise SystemExit("OPENROUTER_API_KEY is not set")

    payload_obj = {
        "model": api_model,
        "messages": [
            {"role": "system", "content": lib_agent._JUDGE_SYSTEM_MSG},
            {"role": "user", "content": prompt},
        ],
        "temperature": 0.0,
        "max_completion_tokens": 2048,
    }
    payload = json.dumps(payload_obj).encode("utf-8")
    req = request.Request(
        "https://openrouter.ai/api/v1/chat/completions",
        data=payload,
        headers={
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "HTTP-Referer": "https://pinchbench.com",
            "X-Title": "PinchBench-Judge-Diagnostic",
        },
        method="POST",
    )

    try:
        with request.urlopen(req, timeout=float(cfg.get("judge_timeout") or 300)) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        print("HTTP_ERROR", exc.code)
        print(body[:4000])
        return 2

    choices = data.get("choices") or []
    choice = choices[0] if choices else {}
    message = choice.get("message") or {}
    content = message.get("content")
    reasoning = message.get("reasoning")
    reasoning_details = message.get("reasoning_details")
    usage = data.get("usage") or {}

    print("task_id              :", args.task_id)
    print("requested_model      :", api_model)
    print("served_model         :", data.get("model"))
    print("provider             :", data.get("provider"))
    print("finish_reason        :", choice.get("finish_reason"))
    print("native_finish_reason :", choice.get("native_finish_reason"))
    print("content_type         :", type(content).__name__)
    print("content_length       :", len(content) if isinstance(content, str) else None)
    print("content_preview      :", repr(content[:500]) if isinstance(content, str) else repr(content))
    print("reasoning_type       :", type(reasoning).__name__)
    print("reasoning_length     :", len(reasoning) if isinstance(reasoning, str) else None)
    print("reasoning_details_n  :", len(reasoning_details) if isinstance(reasoning_details, list) else None)
    print("usage                :", json.dumps(usage, ensure_ascii=False))
    print("message_keys         :", sorted(message.keys()))

    out = run_dir / f"judge_raw_{args.task_id}.json"
    out.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    print("raw_saved            :", out)
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
