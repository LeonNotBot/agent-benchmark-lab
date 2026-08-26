from __future__ import annotations

import argparse
import ast
import json
from pathlib import Path

NAMES = ("RUNNER_REVISION", "DEFAULT_ADAPTER_VERSION", "DEFAULT_MODEL_ID")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--runner", required=True)
    args = parser.parse_args()

    path = Path(args.runner)
    tree = ast.parse(path.read_text(encoding="utf-8-sig"), filename=str(path))

    values: dict[str, object] = {}
    counts = {name: 0 for name in NAMES}

    for node in tree.body:
        targets: list[ast.expr] = []
        value: ast.expr | None = None
        if isinstance(node, ast.Assign):
            targets = list(node.targets)
            value = node.value
        elif isinstance(node, ast.AnnAssign) and node.value is not None:
            targets = [node.target]
            value = node.value

        if value is None:
            continue

        for target in targets:
            if isinstance(target, ast.Name) and target.id in counts:
                counts[target.id] += 1
                try:
                    values[target.id] = ast.literal_eval(value)
                except Exception:
                    values[target.id] = None

    for name in NAMES:
        if counts[name] != 1:
            raise SystemExit(f"{name} assignment count must be 1, actual={counts[name]}")
        if not isinstance(values.get(name), str):
            raise SystemExit(f"{name} must be a string literal, actual={values.get(name)!r}")

    print(json.dumps(values, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
