#!/usr/bin/env python3
from __future__ import annotations

import argparse
import importlib.util
import json
import tempfile
from pathlib import Path


class FakeGrader:
    @staticmethod
    def _read_workspace_files(workspace_path: str) -> str:
        raise RuntimeError("Official unbounded reader should be replaced")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--runner", required=True)
    args = parser.parse_args()

    runner = Path(args.runner).resolve()
    spec = importlib.util.spec_from_file_location(
        "pinchbench_v1_6_smoke",
        runner,
    )
    if spec is None or spec.loader is None:
        raise RuntimeError("Unable to import runner")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    with tempfile.TemporaryDirectory(
        prefix="pinchbench-v1-6-"
    ) as temporary:
        root = Path(temporary)
        dependency = (
            root
            / ".venv"
            / "Lib"
            / "site-packages"
            / "huge.py"
        )
        dependency.parent.mkdir(parents=True)
        dependency.write_text(
            "x" * 2_000_000,
            encoding="utf-8",
        )

        script = root / "attempt.py"
        script.write_text(
            "print('attempted image generation')\n",
            encoding="utf-8",
        )

        grader = FakeGrader()
        context = module.install_bounded_workspace_evidence(
            grader,
            task_id="task_image_gen",
        )
        evidence = grader._read_workspace_files(str(root))

        if len(evidence) > 140_000:
            raise RuntimeError(
                f"Evidence too large: {len(evidence)}"
            )
        if "x" * 1000 in evidence:
            raise RuntimeError(
                "Dependency content leaked into evidence"
            )
        if "attempt.py" not in evidence:
            raise RuntimeError(
                "Relevant user-authored file missing"
            )
        if context["files_skipped_dependency"] < 1:
            raise RuntimeError(
                "Dependency skip was not audited"
            )
        if context["expected_output_present"]:
            raise RuntimeError(
                "Missing output incorrectly marked present"
            )

        audit = root / "audit.json"
        module.write_json_atomic(audit, context)
        loaded = json.loads(
            audit.read_text(encoding="utf-8")
        )
        if loaded["policy"] != (
            "task_image_gen_dependency_exclusion_and_120k_char_cap"
        ):
            raise RuntimeError("Audit policy mismatch")

    print("PASS: v1.6 context-bounding runtime smoke passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
