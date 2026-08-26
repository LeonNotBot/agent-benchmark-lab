from __future__ import annotations

import argparse
import ast
import json
from pathlib import Path


REQUIRED = {
    "RUNNER_REVISION",
    "DEFAULT_ADAPTER_VERSION",
    "DEFAULT_MODEL_ID",
}


def literal_value(node: ast.AST):
    try:
        return ast.literal_eval(node)
    except Exception:
        return None


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--runner", required=True)
    args = parser.parse_args()

    path = Path(args.runner)
    source = path.read_text(encoding="utf-8-sig")
    tree = ast.parse(source, filename=str(path))

    values: dict[str, object] = {}
    counts: dict[str, int] = {name: 0 for name in REQUIRED}

    for node in tree.body:
        if isinstance(node, ast.Assign):
            for target in node.targets:
                if isinstance(target, ast.Name) and target.id in REQUIRED:
                    counts[target.id] += 1
                    values[target.id] = literal_value(node.value)
        elif isinstance(node, ast.AnnAssign):
            target = node.target
            if isinstance(target, ast.Name) and target.id in REQUIRED and node.value is not None:
                counts[target.id] += 1
                values[target.id] = literal_value(node.value)

    for name in REQUIRED:
        if counts[name] != 1:
            raise SystemExit(f"{name} assignment count must be 1, actual={counts[name]}")
        if not isinstance(values.get(name), str):
            raise SystemExit(f"{name} must be a string literal, actual={values.get(name)!r}")

    print(json.dumps(values, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
