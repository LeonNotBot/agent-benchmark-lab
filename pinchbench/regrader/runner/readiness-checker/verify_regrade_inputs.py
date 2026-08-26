#!/usr/bin/env python3
"""
PinchBench regrade input readiness checker.

Read-only guarantees:
- Source run directories are only opened for reading.
- All generated files are written under --output-root.
- No source file attributes, timestamps, permissions, or contents are changed.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import html
import json
import os
import sys
import traceback
from collections import Counter
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Iterator, Optional

SCRIPT_VERSION = "1.0.0"
DEFAULT_EXPECTED_COMMIT = "819384ae830492365b8363fc26bc2602e73f216d"
DEFAULT_EXPECTED_TASK_COUNT = 143

TASK_ID_KEYS = (
    "task_id",
    "taskId",
    "id",
    "task",
    "name",
)
WORKSPACE_KEYS = (
    "workspace",
    "workspace_path",
    "workspacePath",
    "workdir",
    "working_directory",
)
TRANSCRIPT_KEYS = (
    "transcript",
    "transcript_path",
    "transcriptPath",
    "logs_path",
    "log_path",
)
SCORE_KEYS = (
    "score",
    "final_score",
    "total_score",
)
STATUS_KEYS = (
    "status",
    "execution_status",
)
GRADING_TYPE_KEYS = (
    "grading_type",
    "grader_type",
    "score_type",
    "evaluation_type",
    "type",
)

DEFAULT_REQUIRED_FILES = (
    "run_config.json",
    "results.json",
    "results.csv",
    "results.xlsx",
    "progress.jsonl",
    "results.partial.json",
)

DEFAULT_EXCLUDED_DIR_NAMES = {
    ".git",
    ".venv",
    "venv",
    "node_modules",
    "__pycache__",
    ".pytest_cache",
    ".mypy_cache",
    ".ruff_cache",
    ".tox",
    ".idea",
    ".vscode",
}


@dataclass
class CandidateSummary:
    agent: str
    path: str
    preferred: bool
    results_parseable: bool
    task_count: int
    required_files_present: int
    workspace_root_present: bool
    transcript_root_present: bool
    score: int
    modified_utc: str
    selected: bool = False
    error: str = ""


@dataclass
class RunSummary:
    agent: str
    selected_path: str
    readiness: str
    results_parseable: bool
    task_count: int
    expected_task_count: int
    unique_task_count: int
    duplicate_task_ids: int
    required_files_present: int
    required_files_expected: int
    missing_required_files: str
    workspace_root: str
    workspace_root_present: bool
    workspace_task_matches: int
    workspace_coverage: float
    transcript_root: str
    transcript_root_present: bool
    transcript_task_matches: int
    transcript_coverage: float
    commit_status: str
    expected_commit: str
    commits_seen: str
    judges_seen: str
    models_seen: str
    score_non_null_count: int
    status_counts: str
    grading_type_counts: str
    evidence_file_count: int
    evidence_total_bytes: int
    files_modified_after_results: int
    warnings: str
    errors: str


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def safe_resolve(path: Path) -> Path:
    try:
        return path.resolve(strict=False)
    except OSError:
        return path.absolute()


def load_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8-sig") as handle:
        return json.load(handle)


def direct_value(obj: Any, keys: Iterable[str]) -> Any:
    if not isinstance(obj, dict):
        return None
    for key in keys:
        if key in obj:
            return obj[key]
    lower_map = {str(k).lower(): v for k, v in obj.items()}
    for key in keys:
        value = lower_map.get(key.lower())
        if value is not None:
            return value
    return None


def looks_like_task_id(value: Any) -> bool:
    if not isinstance(value, str):
        return False
    value = value.strip()
    return (
        len(value) >= 3
        and (
            value.startswith("task_")
            or value.startswith("integration_")
            or "task" in value.lower()
        )
    )


def list_task_score(items: list[Any]) -> int:
    if not items:
        return -1
    dict_items = [item for item in items if isinstance(item, dict)]
    if not dict_items:
        return -1
    task_like = 0
    for item in dict_items[: min(len(dict_items), 200)]:
        if looks_like_task_id(direct_value(item, TASK_ID_KEYS)):
            task_like += 1
    return task_like * 1000 + len(dict_items)


def find_task_rows(data: Any) -> list[dict[str, Any]]:
    candidates: list[list[Any]] = []

    def visit(node: Any, depth: int) -> None:
        if depth > 8:
            return
        if isinstance(node, list):
            candidates.append(node)
            for child in node[:20]:
                if isinstance(child, (dict, list)):
                    visit(child, depth + 1)
        elif isinstance(node, dict):
            preferred_keys = (
                "results",
                "tasks",
                "items",
                "records",
                "task_results",
            )
            for key in preferred_keys:
                value = node.get(key)
                if isinstance(value, list):
                    candidates.append(value)
            for child in node.values():
                if isinstance(child, (dict, list)):
                    visit(child, depth + 1)

    visit(data, 0)
    if isinstance(data, list):
        candidates.append(data)

    best: list[Any] = []
    best_score = -1
    for candidate in candidates:
        score = list_task_score(candidate)
        if score > best_score:
            best = candidate
            best_score = score

    rows = [item for item in best if isinstance(item, dict)]
    return rows


def row_task_id(row: dict[str, Any]) -> str:
    value = direct_value(row, TASK_ID_KEYS)
    if value is None:
        return ""
    return str(value).strip()


def value_as_path(value: Any, run_path: Path) -> Optional[Path]:
    if not isinstance(value, str) or not value.strip():
        return None
    candidate = Path(value.strip())
    if not candidate.is_absolute():
        candidate = run_path / candidate
    return safe_resolve(candidate)


def detect_evidence_root(run_path: Path, names: Iterable[str]) -> Optional[Path]:
    for name in names:
        candidate = run_path / name
        if candidate.is_dir():
            return candidate
    return None


def task_evidence_exists(
    task_id: str,
    row: dict[str, Any],
    run_path: Path,
    root: Optional[Path],
    keys: Iterable[str],
) -> tuple[bool, str]:
    explicit = value_as_path(direct_value(row, keys), run_path)
    if explicit is not None and explicit.exists():
        return True, str(explicit)

    if root is None:
        return False, ""

    exact = root / task_id
    if exact.exists():
        return True, str(exact)

    # Some runners use files rather than task directories.
    try:
        matches = list(root.glob(task_id + "*"))
    except OSError:
        matches = []
    if matches:
        return True, str(matches[0])

    return False, ""


def flatten_json_values(
    node: Any,
    prefix: str = "",
    depth: int = 0,
) -> Iterator[tuple[str, Any]]:
    if depth > 12:
        return
    if isinstance(node, dict):
        for key, value in node.items():
            current = f"{prefix}.{key}" if prefix else str(key)
            if isinstance(value, (dict, list)):
                yield from flatten_json_values(value, current, depth + 1)
            else:
                yield current, value
    elif isinstance(node, list):
        for index, value in enumerate(node):
            current = f"{prefix}[{index}]"
            if isinstance(value, (dict, list)):
                yield from flatten_json_values(value, current, depth + 1)
            else:
                yield current, value


def config_metadata(
    run_config_path: Path,
    expected_commit: str,
) -> tuple[str, list[str], list[str], list[str], list[str]]:
    warnings: list[str] = []
    if not run_config_path.is_file():
        return "MISSING", [], [], [], ["run_config.json missing"]

    try:
        data = load_json(run_config_path)
    except Exception as exc:
        return "UNREADABLE", [], [], [], [f"run_config parse failed: {exc}"]

    commits: list[str] = []
    judges: list[str] = []
    models: list[str] = []

    for path, value in flatten_json_values(data):
        key = path.lower()
        text = str(value)
        if any(token in key for token in ("commit", "revision", "git_sha", "sha")):
            if len(text) >= 7:
                commits.append(text)
        if "judge" in key and isinstance(value, (str, int, float, bool)):
            judges.append(text)
        if (
            "model" in key
            and "judge" not in key
            and isinstance(value, (str, int, float, bool))
        ):
            models.append(text)

    all_text = json.dumps(data, ensure_ascii=False, sort_keys=True)
    if expected_commit in all_text:
        commit_status = "MATCH"
    elif commits:
        commit_status = "MISMATCH_OR_DIFFERENT_FIELD"
        warnings.append("Expected commit was not found in run_config.")
    else:
        commit_status = "UNVERIFIED"
        warnings.append("No commit field was found in run_config.")

    return (
        commit_status,
        sorted(set(commits)),
        sorted(set(judges)),
        sorted(set(models)),
        warnings,
    )


def iter_evidence_files(
    roots: Iterable[Optional[Path]],
    excluded_dir_names: set[str],
) -> Iterator[Path]:
    for root in roots:
        if root is None or not root.is_dir():
            continue
        for current, dirs, files in os.walk(root):
            dirs[:] = [
                name
                for name in dirs
                if name not in excluded_dir_names
            ]
            current_path = Path(current)
            for name in files:
                yield current_path / name


def file_stats(
    roots: Iterable[Optional[Path]],
    excluded_dir_names: set[str],
    results_mtime: Optional[float],
) -> tuple[int, int, int]:
    count = 0
    total = 0
    later = 0
    threshold = None if results_mtime is None else results_mtime + 600.0

    for path in iter_evidence_files(roots, excluded_dir_names):
        try:
            stat = path.stat()
        except OSError:
            continue
        count += 1
        total += stat.st_size
        if threshold is not None and stat.st_mtime > threshold:
            later += 1

    return count, total, later


def hash_file(path: Path, chunk_size: int = 1024 * 1024) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while True:
            chunk = handle.read(chunk_size)
            if not chunk:
                break
            digest.update(chunk)
    return digest.hexdigest().upper()


def candidate_modified_utc(path: Path) -> str:
    try:
        return datetime.fromtimestamp(
            path.stat().st_mtime,
            tz=timezone.utc,
        ).isoformat()
    except OSError:
        return ""


def inspect_candidate(
    agent: str,
    path: Path,
    preferred_path: Optional[Path],
    expected_task_count: int,
) -> CandidateSummary:
    result_path = path / "results.json"
    parseable = False
    task_count = 0
    error = ""
    try:
        rows = find_task_rows(load_json(result_path))
        task_count = len(rows)
        parseable = task_count > 0
    except Exception as exc:
        error = str(exc)

    required_present = sum(
        int((path / name).exists())
        for name in DEFAULT_REQUIRED_FILES
    )
    workspace_present = detect_evidence_root(
        path,
        ("workspaces", "workspace"),
    ) is not None
    transcript_present = detect_evidence_root(
        path,
        ("transcripts", "transcript", "logs"),
    ) is not None

    score = 0
    if parseable:
        score += 500
    if task_count == expected_task_count:
        score += 1000
    else:
        score += min(task_count, expected_task_count)
    score += required_present * 20
    score += int(workspace_present) * 200
    score += int(transcript_present) * 200
    preferred = (
        preferred_path is not None
        and safe_resolve(path) == safe_resolve(preferred_path)
    )
    if preferred:
        score += 250

    return CandidateSummary(
        agent=agent,
        path=str(safe_resolve(path)),
        preferred=preferred,
        results_parseable=parseable,
        task_count=task_count,
        required_files_present=required_present,
        workspace_root_present=workspace_present,
        transcript_root_present=transcript_present,
        score=score,
        modified_utc=candidate_modified_utc(path),
        error=error,
    )


def discover_candidates(
    entry: dict[str, Any],
    expected_task_count: int,
) -> list[CandidateSummary]:
    agent = str(entry["agent"])
    preferred_text = str(entry.get("preferred_path") or "").strip()
    preferred = Path(preferred_text) if preferred_text else None
    candidates: list[Path] = []

    if preferred is not None and preferred.is_dir():
        candidates.append(preferred)

    root_text = str(entry.get("runs_root") or "").strip()
    patterns = entry.get("patterns") or ["*"]
    if root_text:
        root = Path(root_text)
        if root.is_dir():
            for pattern in patterns:
                for candidate in root.glob(str(pattern)):
                    if (
                        candidate.is_dir()
                        and (candidate / "results.json").is_file()
                    ):
                        candidates.append(candidate)

    unique: dict[str, Path] = {}
    for candidate in candidates:
        unique[str(safe_resolve(candidate)).lower()] = candidate

    summaries = [
        inspect_candidate(
            agent,
            path,
            preferred,
            expected_task_count,
        )
        for path in unique.values()
    ]
    summaries.sort(
        key=lambda item: (
            item.score,
            item.modified_utc,
        ),
        reverse=True,
    )
    if summaries:
        summaries[0].selected = True
    return summaries


def comma_join(values: Iterable[Any]) -> str:
    return " | ".join(str(value) for value in values if str(value))


def counter_text(counter: Counter[str]) -> str:
    return " | ".join(
        f"{key or '<blank>'}:{value}"
        for key, value in sorted(counter.items())
    )


def readiness_for(
    *,
    results_parseable: bool,
    task_count: int,
    expected_task_count: int,
    workspace_coverage: float,
    transcript_coverage: float,
    commit_status: str,
) -> str:
    if (
        not results_parseable
        or task_count != expected_task_count
        or workspace_coverage < 0.85
    ):
        return "INCOMPLETE"

    if (
        workspace_coverage >= 0.95
        and transcript_coverage >= 0.90
        and commit_status == "MATCH"
    ):
        return "READY"

    return "READY_WITH_WARNINGS"


def inspect_selected_run(
    agent: str,
    run_path: Path,
    expected_task_count: int,
    expected_commit: str,
    excluded_dir_names: set[str],
) -> tuple[RunSummary, list[dict[str, Any]]]:
    warnings: list[str] = []
    errors: list[str] = []
    results_path = run_path / "results.json"
    results_parseable = False
    rows: list[dict[str, Any]] = []

    try:
        rows = find_task_rows(load_json(results_path))
        results_parseable = bool(rows)
        if not rows:
            errors.append("No task result rows were found in results.json.")
    except Exception as exc:
        errors.append(f"results.json parse failed: {exc}")

    task_ids = [row_task_id(row) for row in rows]
    blank_task_ids = sum(1 for value in task_ids if not value)
    if blank_task_ids:
        warnings.append(f"{blank_task_ids} rows have no recognizable task id.")
    task_ids_nonblank = [value for value in task_ids if value]
    counts = Counter(task_ids_nonblank)
    duplicate_count = sum(value - 1 for value in counts.values() if value > 1)

    workspace_root = detect_evidence_root(
        run_path,
        ("workspaces", "workspace"),
    )
    transcript_root = detect_evidence_root(
        run_path,
        ("transcripts", "transcript", "logs"),
    )

    task_coverage_rows: list[dict[str, Any]] = []
    workspace_matches = 0
    transcript_matches = 0
    score_non_null_count = 0
    status_counts: Counter[str] = Counter()
    grading_counts: Counter[str] = Counter()

    for row in rows:
        task_id = row_task_id(row)
        if not task_id:
            continue

        workspace_exists, workspace_path = task_evidence_exists(
            task_id,
            row,
            run_path,
            workspace_root,
            WORKSPACE_KEYS,
        )
        transcript_exists, transcript_path = task_evidence_exists(
            task_id,
            row,
            run_path,
            transcript_root,
            TRANSCRIPT_KEYS,
        )
        workspace_matches += int(workspace_exists)
        transcript_matches += int(transcript_exists)

        score = direct_value(row, SCORE_KEYS)
        if score is not None:
            score_non_null_count += 1

        status = direct_value(row, STATUS_KEYS)
        grading_type = direct_value(row, GRADING_TYPE_KEYS)
        status_counts[str(status or "")] += 1
        grading_counts[str(grading_type or "")] += 1

        task_coverage_rows.append(
            {
                "agent": agent,
                "task_id": task_id,
                "workspace_exists": workspace_exists,
                "workspace_path": workspace_path,
                "transcript_exists": transcript_exists,
                "transcript_path": transcript_path,
                "score_present": score is not None,
                "status": str(status or ""),
                "grading_type": str(grading_type or ""),
            }
        )

    denominator = len(task_ids_nonblank)
    workspace_coverage = (
        workspace_matches / denominator if denominator else 0.0
    )
    transcript_coverage = (
        transcript_matches / denominator if denominator else 0.0
    )

    missing_required = [
        name
        for name in DEFAULT_REQUIRED_FILES
        if not (run_path / name).exists()
    ]
    required_present = len(DEFAULT_REQUIRED_FILES) - len(missing_required)

    (
        commit_status,
        commits,
        judges,
        models,
        config_warnings,
    ) = config_metadata(run_path / "run_config.json", expected_commit)
    warnings.extend(config_warnings)

    results_mtime = None
    try:
        results_mtime = results_path.stat().st_mtime
    except OSError:
        pass

    evidence_file_count, evidence_total_bytes, later_files = file_stats(
        (workspace_root, transcript_root),
        excluded_dir_names,
        results_mtime,
    )
    if later_files:
        warnings.append(
            f"{later_files} evidence files were modified more than "
            "10 minutes after results.json."
        )

    if len(rows) != expected_task_count:
        errors.append(
            f"Task count is {len(rows)}, expected {expected_task_count}."
        )
    if duplicate_count:
        warnings.append(f"{duplicate_count} duplicate task-id rows found.")
    if workspace_root is None:
        errors.append("No workspaces/workspace directory was found.")
    elif workspace_coverage < 0.95:
        warnings.append(
            f"Workspace coverage is {workspace_coverage:.1%}."
        )
    if transcript_root is None:
        warnings.append("No transcripts/transcript/logs directory was found.")
    elif transcript_coverage < 0.90:
        warnings.append(
            f"Transcript coverage is {transcript_coverage:.1%}."
        )

    readiness = readiness_for(
        results_parseable=results_parseable,
        task_count=len(rows),
        expected_task_count=expected_task_count,
        workspace_coverage=workspace_coverage,
        transcript_coverage=transcript_coverage,
        commit_status=commit_status,
    )

    summary = RunSummary(
        agent=agent,
        selected_path=str(safe_resolve(run_path)),
        readiness=readiness,
        results_parseable=results_parseable,
        task_count=len(rows),
        expected_task_count=expected_task_count,
        unique_task_count=len(counts),
        duplicate_task_ids=duplicate_count,
        required_files_present=required_present,
        required_files_expected=len(DEFAULT_REQUIRED_FILES),
        missing_required_files=comma_join(missing_required),
        workspace_root=str(workspace_root or ""),
        workspace_root_present=workspace_root is not None,
        workspace_task_matches=workspace_matches,
        workspace_coverage=round(workspace_coverage, 6),
        transcript_root=str(transcript_root or ""),
        transcript_root_present=transcript_root is not None,
        transcript_task_matches=transcript_matches,
        transcript_coverage=round(transcript_coverage, 6),
        commit_status=commit_status,
        expected_commit=expected_commit,
        commits_seen=comma_join(commits),
        judges_seen=comma_join(judges),
        models_seen=comma_join(models),
        score_non_null_count=score_non_null_count,
        status_counts=counter_text(status_counts),
        grading_type_counts=counter_text(grading_counts),
        evidence_file_count=evidence_file_count,
        evidence_total_bytes=evidence_total_bytes,
        files_modified_after_results=later_files,
        warnings=comma_join(warnings),
        errors=comma_join(errors),
    )
    return summary, task_coverage_rows


def write_csv(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if not rows:
        path.write_text("", encoding="utf-8-sig")
        return
    fields: list[str] = []
    seen: set[str] = set()
    for row in rows:
        for key in row.keys():
            if key not in seen:
                fields.append(key)
                seen.add(key)
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(value, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def build_html(
    run_summaries: list[RunSummary],
    candidate_rows: list[dict[str, Any]],
    cross_run: dict[str, Any],
    metadata: dict[str, Any],
) -> str:
    status_class = {
        "READY": "ready",
        "READY_WITH_WARNINGS": "warn",
        "INCOMPLETE": "bad",
        "NOT_FOUND": "bad",
    }

    cards = []
    for item in run_summaries:
        cards.append(
            f"""
            <section class="card {status_class.get(item.readiness, 'warn')}">
              <h2>{html.escape(item.agent)}</h2>
              <div class="status">{html.escape(item.readiness)}</div>
              <p><b>任务：</b>{item.task_count}/{item.expected_task_count}</p>
              <p><b>Workspace：</b>{item.workspace_coverage:.1%}</p>
              <p><b>Transcript：</b>{item.transcript_coverage:.1%}</p>
              <p><b>Commit：</b>{html.escape(item.commit_status)}</p>
              <p class="path">{html.escape(item.selected_path)}</p>
              <p><b>警告：</b>{html.escape(item.warnings or '无')}</p>
              <p><b>错误：</b>{html.escape(item.errors or '无')}</p>
            </section>
            """
        )

    rows = []
    for item in run_summaries:
        rows.append(
            "<tr>"
            f"<td>{html.escape(item.agent)}</td>"
            f"<td>{html.escape(item.readiness)}</td>"
            f"<td>{item.task_count}</td>"
            f"<td>{item.workspace_coverage:.1%}</td>"
            f"<td>{item.transcript_coverage:.1%}</td>"
            f"<td>{html.escape(item.commit_status)}</td>"
            f"<td>{item.evidence_file_count:,}</td>"
            f"<td>{item.evidence_total_bytes / (1024 ** 3):.2f} GiB</td>"
            "</tr>"
        )

    candidate_table = []
    for row in candidate_rows:
        candidate_table.append(
            "<tr>"
            f"<td>{html.escape(str(row['agent']))}</td>"
            f"<td>{html.escape(str(row['selected']))}</td>"
            f"<td>{html.escape(str(row['task_count']))}</td>"
            f"<td>{html.escape(str(row['score']))}</td>"
            f"<td class='path'>{html.escape(str(row['path']))}</td>"
            "</tr>"
        )

    return f"""<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>PinchBench 重评分原始数据只读检查</title>
<style>
body {{ font-family: "Segoe UI", "Microsoft YaHei", sans-serif; margin: 28px; color: #1f2937; }}
h1 {{ margin-bottom: 4px; }}
.meta {{ color: #4b5563; margin-bottom: 22px; }}
.grid {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 14px; }}
.card {{ border: 1px solid #d1d5db; border-left-width: 7px; border-radius: 8px; padding: 15px; }}
.card.ready {{ border-left-color: #16a34a; }}
.card.warn {{ border-left-color: #d97706; }}
.card.bad {{ border-left-color: #dc2626; }}
.status {{ font-weight: 700; margin-bottom: 10px; }}
.path {{ font-family: Consolas, monospace; overflow-wrap: anywhere; font-size: 12px; }}
table {{ width: 100%; border-collapse: collapse; margin-top: 12px; }}
th, td {{ border: 1px solid #d1d5db; padding: 8px; text-align: left; vertical-align: top; }}
th {{ background: #f3f4f6; }}
code {{ font-family: Consolas, monospace; }}
</style>
</head>
<body>
<h1>PinchBench 重评分原始数据只读检查</h1>
<div class="meta">
版本 {SCRIPT_VERSION} · 生成时间 {html.escape(str(metadata['generated_at']))} ·
期望任务 {metadata['expected_task_count']} ·
固定 commit <code>{html.escape(str(metadata['expected_commit']))}</code>
</div>

<div class="grid">
{''.join(cards)}
</div>

<h2>四套汇总</h2>
<table>
<thead><tr><th>Agent</th><th>状态</th><th>任务数</th><th>Workspace</th><th>Transcript</th><th>Commit</th><th>证据文件</th><th>证据体积</th></tr></thead>
<tbody>{''.join(rows)}</tbody>
</table>

<h2>跨运行一致性</h2>
<pre>{html.escape(json.dumps(cross_run, ensure_ascii=False, indent=2))}</pre>

<h2>候选运行目录</h2>
<table>
<thead><tr><th>Agent</th><th>已选</th><th>任务数</th><th>候选分</th><th>路径</th></tr></thead>
<tbody>{''.join(candidate_table)}</tbody>
</table>

<p>本报告只检查可重评分性，不修改原始运行目录，也不会调用 OpenRouter。</p>
</body>
</html>
"""


def full_hash_manifests(
    output_dir: Path,
    selected: list[tuple[str, Path]],
    excluded_dir_names: set[str],
) -> dict[str, Any]:
    summary: dict[str, Any] = {}
    manifest_dir = output_dir / "hash_manifests"
    manifest_dir.mkdir(parents=True, exist_ok=True)

    for agent, run_path in selected:
        workspace_root = detect_evidence_root(
            run_path,
            ("workspaces", "workspace"),
        )
        transcript_root = detect_evidence_root(
            run_path,
            ("transcripts", "transcript", "logs"),
        )
        roots: list[tuple[str, Path]] = []
        for name in DEFAULT_REQUIRED_FILES:
            candidate = run_path / name
            if candidate.is_file():
                roots.append(("run", candidate))
        if workspace_root is not None:
            roots.append(("workspace", workspace_root))
        if transcript_root is not None:
            roots.append(("transcript", transcript_root))

        manifest_path = manifest_dir / f"{agent}_sha256.csv"
        rows_written = 0
        bytes_hashed = 0

        with manifest_path.open(
            "w",
            encoding="utf-8-sig",
            newline="",
        ) as handle:
            writer = csv.DictWriter(
                handle,
                fieldnames=(
                    "agent",
                    "root_type",
                    "relative_path",
                    "size_bytes",
                    "modified_utc",
                    "sha256",
                ),
            )
            writer.writeheader()

            for root_type, root in roots:
                if root.is_file():
                    files = [root]
                    base = run_path
                else:
                    files = iter_evidence_files(
                        (root,),
                        excluded_dir_names,
                    )
                    base = run_path

                for path in files:
                    try:
                        stat = path.stat()
                        digest = hash_file(path)
                        relative = str(path.relative_to(base))
                    except Exception:
                        continue

                    writer.writerow(
                        {
                            "agent": agent,
                            "root_type": root_type,
                            "relative_path": relative,
                            "size_bytes": stat.st_size,
                            "modified_utc": datetime.fromtimestamp(
                                stat.st_mtime,
                                tz=timezone.utc,
                            ).isoformat(),
                            "sha256": digest,
                        }
                    )
                    rows_written += 1
                    bytes_hashed += stat.st_size

        summary[agent] = {
            "manifest": str(manifest_path),
            "files_hashed": rows_written,
            "bytes_hashed": bytes_hashed,
            "manifest_sha256": hash_file(manifest_path),
        }

    write_json(output_dir / "full_hash_summary.json", summary)
    return summary


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Read-only PinchBench regrade input checker."
    )
    parser.add_argument(
        "--config",
        default=str(Path(__file__).with_name("regrade_runs.json")),
    )
    parser.add_argument(
        "--output-root",
        default=r"C:\pinchbench-regrade-readiness",
    )
    parser.add_argument(
        "--mode",
        choices=("quick", "full-hash"),
        default="quick",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    config_path = Path(args.config)
    config = load_json(config_path)

    expected_task_count = int(
        config.get("expected_task_count", DEFAULT_EXPECTED_TASK_COUNT)
    )
    expected_commit = str(
        config.get("expected_commit", DEFAULT_EXPECTED_COMMIT)
    )
    excluded = set(
        config.get("hash_exclude_dirs", sorted(DEFAULT_EXCLUDED_DIR_NAMES))
    )

    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    output_dir = Path(args.output_root) / f"readiness_{stamp}"
    output_dir.mkdir(parents=True, exist_ok=False)

    all_candidate_summaries: list[CandidateSummary] = []
    selected: list[tuple[str, Path]] = []
    missing_agents: list[str] = []

    for entry in config["runs"]:
        agent = str(entry["agent"])
        candidates = discover_candidates(entry, expected_task_count)
        all_candidate_summaries.extend(candidates)
        selected_candidate = next(
            (item for item in candidates if item.selected),
            None,
        )
        if selected_candidate is None:
            missing_agents.append(agent)
            continue
        selected.append((agent, Path(selected_candidate.path)))

    run_summaries: list[RunSummary] = []
    task_coverage_rows: list[dict[str, Any]] = []

    for agent, run_path in selected:
        summary, task_rows = inspect_selected_run(
            agent,
            run_path,
            expected_task_count,
            expected_commit,
            excluded,
        )
        run_summaries.append(summary)
        task_coverage_rows.extend(task_rows)

    for agent in missing_agents:
        run_summaries.append(
            RunSummary(
                agent=agent,
                selected_path="",
                readiness="NOT_FOUND",
                results_parseable=False,
                task_count=0,
                expected_task_count=expected_task_count,
                unique_task_count=0,
                duplicate_task_ids=0,
                required_files_present=0,
                required_files_expected=len(DEFAULT_REQUIRED_FILES),
                missing_required_files=comma_join(DEFAULT_REQUIRED_FILES),
                workspace_root="",
                workspace_root_present=False,
                workspace_task_matches=0,
                workspace_coverage=0.0,
                transcript_root="",
                transcript_root_present=False,
                transcript_task_matches=0,
                transcript_coverage=0.0,
                commit_status="MISSING",
                expected_commit=expected_commit,
                commits_seen="",
                judges_seen="",
                models_seen="",
                score_non_null_count=0,
                status_counts="",
                grading_type_counts="",
                evidence_file_count=0,
                evidence_total_bytes=0,
                files_modified_after_results=0,
                warnings="No candidate run directory was found.",
                errors="Run not found.",
            )
        )

    run_summaries.sort(key=lambda item: item.agent.lower())

    task_sets: dict[str, set[str]] = {}
    for row in task_coverage_rows:
        task_sets.setdefault(row["agent"], set()).add(row["task_id"])

    union = set().union(*task_sets.values()) if task_sets else set()
    intersection = (
        set.intersection(*task_sets.values())
        if len(task_sets) >= 2
        else set(union)
    )
    per_agent_missing = {
        agent: sorted(union - values)
        for agent, values in task_sets.items()
    }
    cross_run = {
        "agents_with_task_sets": sorted(task_sets),
        "union_task_count": len(union),
        "intersection_task_count": len(intersection),
        "all_task_sets_equal": (
            len(task_sets) == len(config["runs"])
            and all(values == union for values in task_sets.values())
        ),
        "missing_from_each_agent": per_agent_missing,
    }

    metadata = {
        "checker_version": SCRIPT_VERSION,
        "generated_at": utc_now(),
        "mode": args.mode,
        "config_path": str(safe_resolve(config_path)),
        "output_directory": str(safe_resolve(output_dir)),
        "expected_task_count": expected_task_count,
        "expected_commit": expected_commit,
        "source_mutation": "NONE; checker opens source paths read-only",
    }

    run_rows = [asdict(item) for item in run_summaries]
    candidate_rows = [asdict(item) for item in all_candidate_summaries]

    write_json(output_dir / "metadata.json", metadata)
    write_json(output_dir / "readiness_summary.json", run_rows)
    write_json(output_dir / "cross_run_consistency.json", cross_run)
    write_csv(output_dir / "run_readiness.csv", run_rows)
    write_csv(output_dir / "candidate_runs.csv", candidate_rows)
    write_csv(output_dir / "task_coverage.csv", task_coverage_rows)

    warnings_lines = []
    for item in run_summaries:
        warnings_lines.append(
            f"[{item.agent}] {item.readiness}\n"
            f"Path: {item.selected_path}\n"
            f"Warnings: {item.warnings or 'None'}\n"
            f"Errors: {item.errors or 'None'}\n"
        )
    (output_dir / "warnings.txt").write_text(
        "\n".join(warnings_lines),
        encoding="utf-8",
    )

    report_html = build_html(
        run_summaries,
        candidate_rows,
        cross_run,
        metadata,
    )
    (output_dir / "readiness_report.html").write_text(
        report_html,
        encoding="utf-8",
    )

    if args.mode == "full-hash":
        full_hash_manifests(output_dir, selected, excluded)

    ready_count = sum(
        item.readiness == "READY"
        for item in run_summaries
    )
    warning_count = sum(
        item.readiness == "READY_WITH_WARNINGS"
        for item in run_summaries
    )
    incomplete_count = sum(
        item.readiness in ("INCOMPLETE", "NOT_FOUND")
        for item in run_summaries
    )

    print("")
    print("PINCHBENCH RE-GRADE READINESS CHECK")
    print(f"Output: {output_dir}")
    print(f"Mode: {args.mode}")
    print("")
    for item in run_summaries:
        print(
            f"{item.agent:12} {item.readiness:20} "
            f"tasks={item.task_count}/{item.expected_task_count} "
            f"workspace={item.workspace_coverage:.1%} "
            f"transcript={item.transcript_coverage:.1%} "
            f"commit={item.commit_status}"
        )
        print(f"  {item.selected_path}")
    print("")
    print(
        f"READY={ready_count} "
        f"READY_WITH_WARNINGS={warning_count} "
        f"INCOMPLETE_OR_NOT_FOUND={incomplete_count}"
    )
    print(f"HTML report: {output_dir / 'readiness_report.html'}")
    print("No OpenRouter call was made.")
    print("No source run file was modified.")

    if incomplete_count:
        return 3
    if warning_count or not cross_run["all_task_sets_equal"]:
        return 2
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        print("Interrupted by user.", file=sys.stderr)
        raise SystemExit(130)
    except Exception:
        traceback.print_exc()
        raise SystemExit(1)
