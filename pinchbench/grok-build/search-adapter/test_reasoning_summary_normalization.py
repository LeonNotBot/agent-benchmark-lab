#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path


def load_adapter(path: Path):
    spec = importlib.util.spec_from_file_location("adapter_under_test", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Unable to load {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def main() -> int:
    adapter = load_adapter(Path(__file__).with_name("grok_build_search_adapter.py"))

    body = {
        "model": "grok-4.5",
        "stream": True,
        "input": [
            {"type": "message", "role": "user", "content": [{"type": "input_text", "text": "test"}]},
            {"type": "reasoning", "id": "rs_missing", "encrypted_content": "opaque"},
            {"type": "reasoning", "id": "rs_scalar", "summary": "short summary"},
            {
                "type": "web_search_call",
                "id": "ws_1",
                "status": "completed",
                "action": {"type": "search", "query": "q", "sources": []},
            },
            {"type": "function_call", "call_id": "c1", "name": "todo_write", "arguments": {"merge": False}},
            {"type": "function_call_output", "call_id": "c1", "output": {"ok": True}},
        ],
        "tools": [{"type": "function", "name": "todo_write", "parameters": {"type": "object"}}],
    }

    normalized, metadata = adapter.normalize_request(body, "deepseek/deepseek-v4-pro")
    assert normalized["model"] == "deepseek/deepseek-v4-pro"
    reasoning = [item for item in normalized["input"] if item.get("type") == "reasoning"]
    assert reasoning[0]["summary"] == []
    assert reasoning[1]["summary"] == ["short summary"]
    assert metadata["reasoning_summaries_injected"] == 1
    assert metadata["reasoning_summaries_coerced"] == 1
    assert normalized["input"][3]["type"] == "web_search_call"
    assert isinstance(normalized["input"][4]["arguments"], str)
    assert isinstance(normalized["input"][5]["output"], str)

    event = {
        "type": "response.output_item.added",
        "item": {"type": "reasoning", "id": "rs_streamed", "encrypted_content": "opaque"},
    }
    event_text, event_stats = adapter.normalize_response_text(json.dumps(event))
    event_value = json.loads(event_text)
    assert event_value["item"]["summary"] == []
    assert event_stats["reasoning_summaries_injected"] == 1

    print("PASS: request-side missing reasoning summary was injected.")
    print("PASS: scalar reasoning summary was coerced to an array.")
    print("PASS: response-side streamed reasoning item was repaired.")
    print("PASS: web-search and tool-call history were preserved.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
