#!/usr/bin/env python3
from __future__ import annotations

import argparse
import datetime as dt
import json
import shutil
import sqlite3
from pathlib import Path


AGENT = "Codex"
TASK_ID = "task_image_gen"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-dir", required=True)
    parser.add_argument(
        "--cache-dir",
        default=(
            r"C:\pinchbench-regrades\.judge_cache"
            r"\openrouter_anthropic_claude-opus-5"
        ),
    )
    args = parser.parse_args()

    run_dir = Path(args.run_dir).resolve()
    state_path = run_dir / "state.sqlite"
    if not state_path.is_file():
        raise FileNotFoundError(state_path)

    stamp = dt.datetime.now().strftime("%Y%m%d-%H%M%S")
    backup = (
        run_dir
        / "single_task_rejudge_backup"
        / f"{AGENT}_{TASK_ID}_{stamp}"
    )
    backup.mkdir(parents=True, exist_ok=False)

    connection = sqlite3.connect(state_path)
    connection.row_factory = sqlite3.Row
    try:
        active = connection.execute(
            """
            SELECT COUNT(*)
            FROM jobs
            WHERE status IN ('pending', 'running')
            """
        ).fetchone()[0]
        if active:
            raise RuntimeError(
                "The formal queue still has pending/running jobs. "
                "Do not reset a single task while it is active."
            )

        row = connection.execute(
            """
            SELECT *
            FROM jobs
            WHERE agent=? AND task_id=?
            """,
            (AGENT, TASK_ID),
        ).fetchone()
        if row is None:
            raise KeyError(f"Missing job: {AGENT} / {TASK_ID}")

        shutil.copy2(state_path, backup / "state.sqlite")
        (backup / "job_before_reset.json").write_text(
            json.dumps(
                dict(row),
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )

        for column in (
            "worker_result_path",
            "stdout_path",
            "stderr_path",
        ):
            value = str(row[column] or "").strip()
            if not value:
                continue
            source = Path(value)
            if source.is_file():
                destination = backup / column / source.name
                destination.parent.mkdir(
                    parents=True,
                    exist_ok=True,
                )
                shutil.copy2(source, destination)
                source.unlink()

        job_input = (
            run_dir
            / "job_inputs"
            / (
                f"{int(row['id']):04d}_"
                f"{row['agent_slug']}_{TASK_ID}.json"
            )
        )
        if job_input.is_file():
            destination = backup / "job_inputs" / job_input.name
            destination.parent.mkdir(
                parents=True,
                exist_ok=True,
            )
            shutil.copy2(job_input, destination)
            job_input.unlink()

        raw_dir = (
            run_dir
            / "judge_raw_responses"
            / str(row["agent_slug"])
            / TASK_ID
        )
        if raw_dir.is_dir():
            destination = backup / "judge_raw_responses"
            shutil.copytree(raw_dir, destination)
            shutil.rmtree(raw_dir)

        connection.execute(
            """
            UPDATE jobs
            SET status='pending',
                started_at=NULL,
                ended_at=NULL,
                heartbeat_at=NULL,
                worker_pid=NULL,
                elapsed_seconds=NULL,
                new_score=NULL,
                score_delta=NULL,
                grade_error=NULL
            WHERE id=?
            """,
            (int(row["id"]),),
        )
        connection.commit()
    finally:
        connection.close()

    cache_dir = Path(args.cache_dir)
    if cache_dir.is_dir():
        cache_backup = cache_dir.with_name(
            cache_dir.name + "-before-image-gen-" + stamp
        )
        if cache_backup.exists():
            raise FileExistsError(cache_backup)
        cache_dir.rename(cache_backup)
        print(f"Old Judge cache preserved: {cache_backup}")
    else:
        print(f"Judge cache did not exist: {cache_dir}")

    print(f"Backup: {backup}")
    print(f"Reset exactly: {AGENT} / {TASK_ID}")
    print("Other jobs reset: 0")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
