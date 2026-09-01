#!/usr/bin/env python3
"""
WorkBuddy Bench runner for macOS/Linux.

Features
--------
- Run one subset: code / web / office / sec
- Run all four subsets sequentially
- Run all tasks
- Run a 1-based inclusive range, e.g. --range 21-40
- Run one task by task id, e.g. --task some-task-id
- Run one task by 1-based position, e.g. --index 17
- Run the first N tasks, e.g. --count 10
- Run N tasks starting at a 1-based position, e.g. --start 21 --count 10
- Uses CodeBuddy Code (CCB) as the harness
- Injects tested-model and judge endpoint credentials through environment variables
- Uses WorkBuddy Bench's native task_selection; datasets are never modified

Run this script FROM THE ROOT of the Tencent/workbuddy-bench checkout.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from pathlib import Path
from typing import Iterable

SUBSETS = {
    "code": "wb-bench-code-v1.0",
    "web": "wb-bench-web-v1.0",
    "office": "wb-bench-office-v1.0",
    "sec": "wb-bench-sec-v1.0",
}
ALL_SUBSETS = ("code", "web", "office", "sec")

DEFAULT_BASE_URL = "https://openrouter.ai/api/v1"
DEFAULT_JUDGE_MODEL = "anthropic/claude-opus-5"

# Keep credentials out of YAML. WorkBuddy reads these variable NAMES from model YAML,
# while the actual values stay in the process environment (or repo-root .env).
BASE_URL_ENV = "OPENROUTER_BASE_URL"
API_KEY_ENV = "OPENROUTER_API_KEY"


def eprint(*args, **kwargs):
    print(*args, file=sys.stderr, **kwargs)


def yaml_scalar(value: str) -> str:
    """JSON quoted strings are valid YAML scalars and avoid hand-written escaping."""
    return json.dumps(value, ensure_ascii=False)


def slugify(value: str) -> str:
    value = value.strip().lower()
    value = re.sub(r"[^a-z0-9._-]+", "-", value)
    return value.strip("-") or "model"


def parse_semver(name: str) -> tuple[int, ...]:
    nums = re.findall(r"\d+", name)
    return tuple(int(x) for x in nums) if nums else (0,)


def detect_ccb_version(repo: Path) -> str:
    versions_dir = repo / "configs" / "harnesses" / "codebuddy-code" / "versions"
    if not versions_dir.is_dir():
        raise SystemExit(
            f"Cannot find CCB versions directory: {versions_dir}\n"
            "Are you running this from the root of Tencent/workbuddy-bench?"
        )
    versions = [p.stem for p in versions_dir.glob("*.yaml") if not p.name.startswith("_")]
    if not versions:
        raise SystemExit(f"No CodeBuddy Code versions found under {versions_dir}")
    return sorted(versions, key=parse_semver)[-1]


def ensure_repo_root(repo: Path) -> None:
    required = [
        repo / "scripts" / "run.sh",
        repo / "configs" / "models",
        repo / "configs" / "jobs",
        repo / "configs" / "harnesses" / "codebuddy-code",
    ]
    missing = [str(p) for p in required if not p.exists()]
    if missing:
        raise SystemExit(
            "This does not look like the workbuddy-bench repository root.\n"
            "Missing:\n  " + "\n  ".join(missing)
        )


def dataset_tasks_dir(repo: Path, subset: str) -> Path:
    return repo / "datasets" / SUBSETS[subset] / "tasks"


def task_names(repo: Path, subset: str) -> list[str]:
    tasks_dir = dataset_tasks_dir(repo, subset)
    if not tasks_dir.is_dir():
        raise SystemExit(
            f"Dataset not found: {tasks_dir}\n"
            f"Download it first:\n"
            f"  ./scripts/dataset/fetch-dataset.sh {subset}"
        )
    return sorted(p.name for p in tasks_dir.iterdir() if p.is_dir() and not p.name.startswith("."))


def resolve_indices(
    total: int,
    range_text: str | None,
    index: int | None,
    start: int | None,
    count: int | None,
) -> list[int] | None:
    """
    Return 0-based indices for WorkBuddy, while CLI inputs remain 1-based.
    None means "all tasks".
    """
    if range_text:
        m = re.fullmatch(r"\s*(\d+)\s*[-:]\s*(\d+)\s*", range_text)
        if not m:
            raise SystemExit("--range must look like 21-40 or 21:40")
        first, last = map(int, m.groups())
        if first < 1 or last < first or last > total:
            raise SystemExit(f"Invalid --range {first}-{last}; valid positions are 1-{total}")
        return list(range(first - 1, last))

    if index is not None:
        if index < 1 or index > total:
            raise SystemExit(f"Invalid --index {index}; valid positions are 1-{total}")
        return [index - 1]

    if count is not None:
        first = start or 1
        if first < 1 or first > total:
            raise SystemExit(f"Invalid --start {first}; valid positions are 1-{total}")
        if count < 1:
            raise SystemExit("--count must be >= 1")
        last = first + count - 1
        if last > total:
            raise SystemExit(
                f"--start {first} --count {count} exceeds dataset size {total} "
                f"(last requested position would be {last})"
            )
        return list(range(first - 1, last))

    if start is not None:
        raise SystemExit("--start requires --count")

    return None


def create_model_config(
    repo: Path,
    *,
    model_name: str,
    config_slug: str,
    thinking: bool | None = None,
) -> str:
    provider_dir = repo / "configs" / "models" / "openrouter"
    provider_dir.mkdir(parents=True, exist_ok=True)

    path = provider_dir / f"{config_slug}.yaml"
    lines = [
        "model:",
        f"  name: {yaml_scalar(model_name)}",
        "  protocols: [openai]",
        f"  backend_url_env: {BASE_URL_ENV}",
        f"  backend_key_env: {API_KEY_ENV}",
    ]
    if thinking is not None:
        lines += [
            f"  thinking_enabled: {'true' if thinking else 'false'}",
        ]
    lines += [
        "  params:",
        "    temperature: 0.0",
    ]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return f"openrouter/{config_slug}"


def task_selection_yaml(
    *,
    names: list[str],
    explicit_task: str | None,
    indices: list[int] | None,
) -> list[str]:
    if explicit_task is not None:
        if explicit_task not in names:
            sample = "\n  ".join(names[:20])
            raise SystemExit(
                f"Task {explicit_task!r} does not exist in this subset.\n"
                f"Use `list` to see all task ids. First few are:\n  {sample}"
            )
        return [
            "task_selection:",
            "  mode: name",
            "  names:",
            f"    - {yaml_scalar(explicit_task)}",
        ]

    if indices is None:
        return []

    # Native WorkBuddy selection is 0-based for mode:index.
    return [
        "task_selection:",
        "  mode: index",
        "  indices: [" + ", ".join(str(i) for i in indices) + "]",
    ]


def create_job_config(
    repo: Path,
    *,
    subset: str,
    eval_model_slug: str,
    judge_model_slug: str,
    ccb_version: str,
    selection_lines: list[str],
    concurrency: int | None,
    attempts: int | None,
    judge_enabled: bool,
) -> str:
    model_tag = slugify(eval_model_slug.split("/", 1)[-1])
    selection_tag = "all"
    if selection_lines:
        # deterministic enough for filenames without exposing a giant indices list
        selection_tag = "selected"
    job_slug = f"wb-{subset}-{model_tag}-{selection_tag}"

    path = repo / "configs" / "jobs" / f"{job_slug}.yaml"
    lines = [
        f"model: {eval_model_slug}",
        f"harness: codebuddy-code/{ccb_version}",
        f"dataset: datasets/{SUBSETS[subset]}/tasks",
        "harness_backend: local",
        "model_connection: local_proxy",
    ]

    if attempts is not None:
        lines.append(f"n_attempts: {attempts}")

    if concurrency is not None:
        lines += [
            "orchestrator_override:",
            f"  n_concurrent_trials: {concurrency}",
        ]

    # Auto-enable judge only on subsets that actually need/use model judging.
    # Code and Security remain on their canonical deterministic/task-native grading.
    if judge_enabled:
        lines += [
            "llm_judge_override:",
            "  enabled: true",
            f"  model: {judge_model_slug}",
        ]

    lines.extend(selection_lines)
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return job_slug


def print_selection(names: list[str], explicit_task: str | None, indices: list[int] | None) -> None:
    if explicit_task:
        selected = [explicit_task]
    elif indices is None:
        selected = names
    else:
        selected = [names[i] for i in indices]

    print(f"Selected {len(selected)} task(s):")
    preview = selected if len(selected) <= 20 else selected[:10] + ["..."] + selected[-5:]
    for item in preview:
        print(f"  {item}")


def check_runtime(repo: Path, *, dry_run: bool) -> None:
    if not shutil_which("uv"):
        raise SystemExit(
            "`uv` is not installed.\n"
            "On macOS you can install it with Homebrew:\n"
            "  brew install uv"
        )

    if not dry_run:
        if not shutil_which("docker"):
            raise SystemExit(
                "`docker` command not found. Install/start Docker Desktop for Mac first."
            )
        try:
            subprocess.run(
                ["docker", "info"],
                cwd=repo,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                check=True,
            )
        except subprocess.CalledProcessError:
            raise SystemExit("Docker is installed but the daemon is not running. Start Docker Desktop.")


def shutil_which(name: str) -> str | None:
    # avoid importing another module just for one tiny operation
    path = os.environ.get("PATH", "")
    for directory in path.split(os.pathsep):
        candidate = Path(directory) / name
        if candidate.is_file() and os.access(candidate, os.X_OK):
            return str(candidate)
    return None


def run_one(
    repo: Path,
    *,
    subset: str,
    args: argparse.Namespace,
    eval_model_slug: str,
    judge_model_slug: str,
    ccb_version: str,
) -> None:
    names = task_names(repo, subset)
    indices = resolve_indices(
        len(names),
        args.range,
        args.index,
        args.start,
        args.count,
    )

    selection_lines = task_selection_yaml(
        names=names,
        explicit_task=args.task,
        indices=indices,
    )

    # Web + Office use model-based judging. Code + Security stay on canonical
    # deterministic/task-native grading unless --judge-all is explicitly requested.
    judge_enabled = args.judge_all or subset in {"web", "office"}

    job_slug = create_job_config(
        repo,
        subset=subset,
        eval_model_slug=eval_model_slug,
        judge_model_slug=judge_model_slug,
        ccb_version=ccb_version,
        selection_lines=selection_lines,
        concurrency=args.concurrency,
        attempts=args.attempts,
        judge_enabled=judge_enabled,
    )

    print()
    print("=" * 78)
    print(f"Subset       : {subset}")
    print(f"Dataset      : {SUBSETS[subset]}")
    print(f"CCB harness  : codebuddy-code/{ccb_version}")
    print(f"Eval model   : {args.model}")
    print(f"Judge        : {args.judge_model if judge_enabled else 'disabled for this subset'}")
    print(f"Job          : {job_slug}")
    print_selection(names, args.task, indices)
    print("=" * 78)

    env = os.environ.copy()
    env.setdefault(BASE_URL_ENV, args.base_url)

    # Let WorkBuddy auto-build the selected CCB split-mount image if missing.
    if args.auto_build_ccb:
        env["AUTO_BUILD_HARNESS_MOUNT"] = "1"

    if args.shards is not None:
        env["SHARDS"] = str(args.shards)

    cmd = ["uv", "run", "./scripts/run.sh", "--job", job_slug]
    if args.dry_run:
        cmd.append("--dry-run")

    print("$ " + " ".join(cmd))
    subprocess.run(cmd, cwd=repo, env=env, check=True)


def cmd_list(repo: Path, args: argparse.Namespace) -> None:
    subsets: Iterable[str] = ALL_SUBSETS if args.subset == "all" else (args.subset,)
    for subset in subsets:
        names = task_names(repo, subset)
        print(f"\n[{subset}] {len(names)} tasks")
        for i, name in enumerate(names, 1):
            print(f"{i:>3}. {name}")


def cmd_run(repo: Path, args: argparse.Namespace) -> None:
    # API key may come from either shell env or WorkBuddy's repo-root .env.
    repo_env = repo / ".env"
    if API_KEY_ENV not in os.environ and not repo_env.exists() and not args.dry_run:
        raise SystemExit(
            f"{API_KEY_ENV} is not set and {repo_env} does not exist.\n"
            "Recommended:\n"
            f"  export {API_KEY_ENV}='YOUR_OPENROUTER_KEY'\n"
            f"  export {BASE_URL_ENV}='{args.base_url}'"
        )

    check_runtime(repo, dry_run=args.dry_run)

    ccb_version = args.ccb_version or detect_ccb_version(repo)

    eval_config_slug = "eval-" + slugify(args.model)
    judge_config_slug = "judge-" + slugify(args.judge_model)

    eval_model_slug = create_model_config(
        repo,
        model_name=args.model,
        config_slug=eval_config_slug,
        thinking=args.thinking,
    )
    judge_model_slug = create_model_config(
        repo,
        model_name=args.judge_model,
        config_slug=judge_config_slug,
        thinking=None,
    )

    subsets: Iterable[str] = ALL_SUBSETS if args.subset == "all" else (args.subset,)
    for subset in subsets:
        run_one(
            repo,
            subset=subset,
            args=args,
            eval_model_slug=eval_model_slug,
            judge_model_slug=judge_model_slug,
            ccb_version=ccb_version,
        )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="WorkBuddy Bench runner using CodeBuddy Code + OpenRouter.",
        formatter_class=argparse.RawTextHelpFormatter,
    )
    sub = parser.add_subparsers(dest="command", required=True)

    p_list = sub.add_parser("list", help="List task ids with 1-based positions.")
    p_list.add_argument("--subset", choices=[*ALL_SUBSETS, "all"], default="code")

    p_run = sub.add_parser("run", help="Run WorkBuddy Bench.")
    p_run.add_argument(
        "--subset",
        choices=[*ALL_SUBSETS, "all"],
        default="code",
        help="Subset to run; 'all' runs code -> web -> office -> sec sequentially.",
    )
    p_run.add_argument(
        "--model",
        required=True,
        help="OpenRouter model id, e.g. qwen/qwen3.6-35b-a3b",
    )
    p_run.add_argument(
        "--judge-model",
        default=os.environ.get("WORKBUDDY_JUDGE_MODEL", DEFAULT_JUDGE_MODEL),
        help=f"OpenRouter judge model id (default: {DEFAULT_JUDGE_MODEL}).",
    )
    p_run.add_argument(
        "--base-url",
        default=os.environ.get(BASE_URL_ENV, DEFAULT_BASE_URL),
        help=f"OpenRouter API base URL (default: {DEFAULT_BASE_URL}).",
    )
    p_run.add_argument(
        "--ccb-version",
        default=os.environ.get("WORKBUDDY_CCB_VERSION"),
        help="CodeBuddy Code version. Default: newest version found in repo config.",
    )

    selection = p_run.add_argument_group("task selection (choose at most one style)")
    selection.add_argument("--range", metavar="START-END", help="1-based inclusive range, e.g. 21-40")
    selection.add_argument("--task", help="Run exactly one task by task id")
    selection.add_argument("--index", type=int, help="Run exactly one task by 1-based position")
    selection.add_argument("--count", type=int, help="Run N tasks (first N, or from --start)")
    selection.add_argument("--start", type=int, help="1-based start position; requires --count")

    p_run.add_argument("--concurrency", type=int, help="Override concurrent trials.")
    p_run.add_argument(
        "--attempts",
        type=int,
        default=1,
        help="Attempts per task. Default 1 (official Code bench config defaults to 3).",
    )
    p_run.add_argument("--shards", type=int, help="Set WorkBuddy SHARDS.")
    p_run.add_argument(
        "--judge-all",
        action="store_true",
        help="Also enable host-side LLM judge for Code/Security. "
             "By default judge is enabled only for Web/Office.",
    )
    p_run.add_argument(
        "--thinking",
        action=argparse.BooleanOptionalAction,
        default=None,
        help="Set tested model thinking_enabled true/false; omitted by default.",
    )
    p_run.add_argument(
        "--auto-build-ccb",
        action=argparse.BooleanOptionalAction,
        default=True,
        help="Auto-build missing CCB harness mount image (default: true).",
    )
    p_run.add_argument("--dry-run", action="store_true", help="Resolve/validate config without running tasks.")

    return parser


def validate_selection_args(args: argparse.Namespace) -> None:
    if args.command != "run":
        return
    styles = sum(
        bool(x)
        for x in [
            args.range,
            args.task,
            args.index is not None,
            args.count is not None,
        ]
    )
    if styles > 1:
        raise SystemExit("Choose only one of --range / --task / --index / --count.")
    if args.start is not None and args.count is None:
        raise SystemExit("--start requires --count.")
    if args.concurrency is not None and args.concurrency < 1:
        raise SystemExit("--concurrency must be >= 1.")
    if args.attempts is not None and args.attempts < 1:
        raise SystemExit("--attempts must be >= 1.")
    if args.shards is not None and args.shards < 1:
        raise SystemExit("--shards must be >= 1.")


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    validate_selection_args(args)

    repo = Path.cwd().resolve()
    ensure_repo_root(repo)

    if args.command == "list":
        cmd_list(repo, args)
    else:
        cmd_run(repo, args)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
