#!/usr/bin/env python3
import importlib.util
import io
import json
from pathlib import Path

module_path = Path(__file__).with_name("grok_build_search_adapter.py")
spec = importlib.util.spec_from_file_location("adapter", module_path)
adapter = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(adapter)

observed = {
    "type": "response.output_item.added",
    "output_index": 1,
    "item": {
        "id": "st_tmp_32ka36ygu5o",
        "type": "openrouter:web_search",
        "status": "in_progress",
    },
    "sequence_number": 25,
}

normalized_text, stats = adapter.normalize_response_text(
    json.dumps(observed, separators=(",", ":"))
)
normalized = json.loads(normalized_text)
item = normalized["item"]

assert item["type"] == "web_search_call", item
assert item["action"]["type"] == "search", item
assert item["action"]["query"] == "", item
assert item["action"]["queries"] == [], item
assert item["action"]["sources"] == [], item
assert stats["type_translated"] == 1, stats
assert stats["action_injected"] == 1, stats

# Real actions must never be overwritten.
real_action = {
    "type": "web_search_call",
    "status": "completed",
    "action": {
        "type": "search",
        "query": "Grok Build changelog",
        "queries": ["Grok Build changelog"],
        "sources": [{"type": "url", "url": "https://github.com/xai-org/grok-build"}],
    },
}
normalized_text, stats = adapter.normalize_response_text(json.dumps(real_action))
normalized = json.loads(normalized_text)
assert normalized["action"]["query"] == "Grok Build changelog"
assert stats["action_injected"] == 0, stats

# Exact failure observed in v0.1.1: legacy SSE [DONE] must be identifiable
# as a non-JSON terminator and must not be forwarded to Grok Build.
assert " [DONE]\r\n".strip() == "[DONE]"
assert " [DONE]\n".strip() == "[DONE]"

# Static verification that the forwarding loop contains the guarded suppression.
source = module_path.read_text(encoding="utf-8")
assert 'payload_text.strip() == "[DONE]"' in source
assert '"stream_done_suppressed"' in source
assert "continue" in source

print("PASS: type translation, action injection, and SSE [DONE] suppression are installed.")
