from pathlib import Path
import shutil
import sys

root = Path(sys.argv[1]) if len(sys.argv) > 1 else Path.cwd()
runner = root / "runner" / "run_pinchbench_superclaw_windows.py"
if not runner.exists():
    raise SystemExit(f"NOT FOUND: {runner}")

s = runner.read_text(encoding="utf-8")
if "--resume-run" in s:
    print("ALREADY PATCHED:", runner)
    raise SystemExit(0)

bak = runner.with_suffix(runner.suffix + ".before_resume_run_fix.bak")
if not bak.exists():
    shutil.copy2(runner, bak)

# Add CLI option.
anchor = '''    parser.add_argument("--results-dir", default=None, help="运行结果根目录；默认是 <skill-dir>/../runs")
'''
replacement = '''    parser.add_argument("--results-dir", default=None, help="运行结果根目录；默认是 <skill-dir>/../runs")
    parser.add_argument("--resume-run", default=None, help="从已有 SuperClaw run 目录的 results.partial.json 继续未完成任务")
'''
if anchor not in s:
    raise SystemExit("Patch point A not found")
s = s.replace(anchor, replacement, 1)

# Override selected task order from original run config when resuming.
anchor2 = '''    if not selected:
        raise SystemExit("没有可运行任务。请检查 --suite/--limit/--skip。")

    needs_judge = (
'''
replacement2 = '''    if not selected:
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
'''
if anchor2 not in s:
    raise SystemExit("Patch point B not found")
s = s.replace(anchor2, replacement2, 1)

# Reuse existing directory.
anchor3 = '''    results_root = Path(args.results_dir).expanduser().resolve() if args.results_dir else skill_dir.parent / "runs"
    run_id = dt.datetime.now().strftime("superclaw_%Y%m%d_%H%M%S")
    run_dir = results_root / run_id
'''
replacement3 = '''    results_root = Path(args.results_dir).expanduser().resolve() if args.results_dir else skill_dir.parent / "runs"
    if resume_run_dir is not None:
        run_dir = resume_run_dir
        results_root = run_dir.parent
        run_id = run_dir.name
    else:
        run_id = dt.datetime.now().strftime("superclaw_%Y%m%d_%H%M%S")
        run_dir = results_root / run_id
'''
if anchor3 not in s:
    raise SystemExit("Patch point C not found")
s = s.replace(anchor3, replacement3, 1)

# Do not overwrite original config; write a resume audit file.
anchor4 = '''    write_run_config(
        run_dir / "run_config.json",
        args,
        skill_dir,
        tasks_dir,
        selected,
        len(all_tasks),
        skipped_task_ids,
        superclaw_snapshot,
    )
'''
replacement4 = '''    config_output_path = (
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
'''
if anchor4 not in s:
    raise SystemExit("Patch point D not found")
s = s.replace(anchor4, replacement4, 1)

# Load persisted results and skip completed tasks.
anchor5 = '''    results: list[dict[str, Any]] = []
    total_started = time.monotonic()

    for index, task in enumerate(selected, start=1):
'''
replacement5 = '''    results: list[dict[str, Any]] = []
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
'''
if anchor5 not in s:
    raise SystemExit("Patch point E not found")
s = s.replace(anchor5, replacement5, 1)

# Include prior elapsed in final wall-time summary approximation.
anchor6 = '''    total_elapsed = time.monotonic() - total_started
'''
replacement6 = '''    total_elapsed = prior_elapsed + (time.monotonic() - total_started)
'''
if anchor6 not in s:
    raise SystemExit("Patch point F not found")
s = s.replace(anchor6, replacement6, 1)

runner.write_text(s, encoding="utf-8", newline="\n")
print("PATCHED:", runner)
print("BACKUP :", bak)
print("FIX    : --resume-run continues only task IDs absent from results.partial.json")
