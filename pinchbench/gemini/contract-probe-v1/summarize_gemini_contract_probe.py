#!/usr/bin/env python3
from __future__ import annotations

import argparse
import collections
import json
from pathlib import Path
from typing import Any


def parse_jsonl(path: Path) -> list[Any]:
    items: list[Any] = []
    if not path.exists():
        return items
    for line in path.read_text(encoding="utf-8-sig", errors="replace").splitlines():
        if not line.strip():
            continue
        try:
            items.append(json.loads(line))
        except json.JSONDecodeError:
            items.append({"_raw": line})
    return items


def walk(value: Any):
    if isinstance(value, dict):
        yield value
        for child in value.values():
            yield from walk(child)
    elif isinstance(value, list):
        for child in value:
            yield from walk(child)


def declarations(body: Any) -> list[dict[str, Any]]:
    found: dict[str, dict[str, Any]] = {}
    for item in walk(body):
        if isinstance(item, dict) and isinstance(item.get("name"), str):
            if "parameters" in item or "parametersJsonSchema" in item:
                found.setdefault(item["name"], item)
    return list(found.values())


def event_summary(events: list[Any]) -> dict[str, Any]:
    types = collections.Counter(
        str(item.get("type")) for item in events
        if isinstance(item, dict) and item.get("type")
    )
    return {
        "line_count": len(events),
        "event_types": dict(types),
        "has_result": types.get("result", 0) > 0,
        "raw_non_json_lines": sum(1 for item in events if isinstance(item, dict) and "_raw" in item),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--requests", required=True)
    parser.add_argument("--custom-output", required=True)
    parser.add_argument("--alias-output", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    requests = parse_jsonl(Path(args.requests))
    custom_events = parse_jsonl(Path(args.custom_output))
    alias_events = parse_jsonl(Path(args.alias_output))

    path_counts = collections.Counter(
        str(item.get("path")) for item in requests
        if isinstance(item, dict) and item.get("path")
    )
    tool_names: set[str] = set()
    models_seen: set[str] = set()
    request_rows: list[dict[str, Any]] = []

    for item in requests:
        if not isinstance(item, dict):
            continue
        body = item.get("body_json")
        decs = declarations(body)
        for dec in decs:
            tool_names.add(str(dec.get("name")))
        if isinstance(body, dict) and body.get("model"):
            models_seen.add(str(body["model"]))
        request_rows.append({
            "method": item.get("method"),
            "path": item.get("path"),
            "query": item.get("query"),
            "body_length": item.get("body_length"),
            "top_level_keys": sorted(body.keys()) if isinstance(body, dict) else [],
            "api_key_header_present": any(key.lower() == "x-goog-api-key" for key in (item.get("headers") or {})),
            "tool_names": [str(dec.get("name")) for dec in decs],
        })

    custom_summary = event_summary(custom_events)
    alias_summary = event_summary(alias_events)
    report = {
        "request_count": len(requests),
        "path_counts": dict(path_counts),
        "models_seen_in_body": sorted(models_seen),
        "tool_names": sorted(tool_names),
        "requests": request_rows,
        "custom_model_run": custom_summary,
        "alias_model_run": alias_summary,
        "interpretation": {
            "custom_model_reached_server": any(
                "deepseek" in (str(item.get("path", "")) + json.dumps(item.get("body_json"), ensure_ascii=False)).lower()
                for item in requests if isinstance(item, dict)
            ),
            "local_stream_response_parsed": custom_summary["has_result"] or alias_summary["has_result"],
            "next_step": "Implement Gemini-to-OpenRouter translation using captured paths and schemas.",
        },
    }

    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8", newline="\n")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
