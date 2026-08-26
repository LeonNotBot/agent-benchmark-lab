#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

module_path = Path(__file__).with_name("grok_build_search_adapter.py")
spec = importlib.util.spec_from_file_location("grok_adapter_v013", module_path)
if spec is None or spec.loader is None:
    raise RuntimeError("Unable to load adapter module")
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)

original = {
    "model": "grok-4.5",
    "stream": True,
    "input": [
        {
            "type": "message",
            "role": "user",
            "content": [{"type": "input_text", "text": "Create a report"}],
        },
        [
            {
                "type": "function_call",
                "call_id": "call_write_1",
                "name": "write",
                "arguments": {"file_path": "report.md", "content": "hello"},
            },
            {
                "type": "function_call_output",
                "call_id": "call_write_1",
                "output": [
                    {
                        "type": "text",
                        "text": "write completed",
                    },
                    {
                        "type": "metadata",
                        "edits": 1,
                    },
                ],
            },
        ],
    ],
}

normalized, meta = module.normalize_request(
    json.loads(json.dumps(original)),
    "deepseek/deepseek-v4-pro",
)

assert normalized["model"] == "deepseek/deepseek-v4-pro"
assert len(normalized["input"]) == 3
assert not any(isinstance(item, list) for item in normalized["input"])
assert normalized["input"][0]["content"] == original["input"][0]["content"]
assert isinstance(normalized["input"][1]["arguments"], str)
assert json.loads(normalized["input"][1]["arguments"])["file_path"] == "report.md"
assert isinstance(normalized["input"][2]["output"], str)
assert json.loads(normalized["input"][2]["output"])[0]["text"] == "write completed"
assert meta["input_nested_arrays_flattened"] == 1
assert meta["input_items_recovered"] == 2
assert meta["tool_outputs_stringified"] == 1
assert meta["tool_arguments_stringified"] == 1
assert meta["input_before"]["nested_array"] == 1
assert meta["input_after"]["function_call_output"] == 1

# Strings and already-valid flat items must remain stable.
valid = {
    "model": "alias",
    "input": [
        {"type": "function_call_output", "call_id": "c", "output": "ok"},
        {"type": "message", "role": "user", "content": [{"type": "input_text", "text": "next"}]},
    ],
}
valid_normalized, valid_meta = module.normalize_request(valid, "deepseek/deepseek-v4-pro")
assert valid_normalized["input"][0]["output"] == "ok"
assert valid_meta["input_nested_arrays_flattened"] == 0
assert valid_meta["tool_outputs_stringified"] == 0

print("PASS: nested Responses input arrays are flattened and structured tool payloads are JSON-stringified.")
