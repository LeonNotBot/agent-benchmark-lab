#!/usr/bin/env python3
from pathlib import Path
import importlib.util, json, tempfile, sys

p = Path(__file__).with_name("run_pinchbench_grok_build_windows.py")
spec = importlib.util.spec_from_file_location("runner", p)
runner = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = runner
assert spec.loader is not None
spec.loader.exec_module(runner)

assistant = {
  "type":"assistant",
  "message":{"role":"assistant","model":"deepseek/deepseek-v4-pro","content":[
    {"type":"text","text":"hello"},
    {"type":"tool_use","id":"c1","name":"read_file","input":{"path":"a.txt"}}
  ],"stop_reason":"tool_use"},
  "session_id":"s1"
}
normalized = runner.normalize_grok_build_event(assistant)
assert normalized[0]["message"]["role"] == "assistant"
assert normalized[0]["message"]["content"][1]["type"] == "toolCall"

user = {"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"c1","content":"ok","is_error":False}]}}
normalized = runner.normalize_grok_build_event(user)
assert normalized[0]["message"]["role"] == "toolResult"

web = {"type":"assistant","message":{"role":"assistant","model":"deepseek/deepseek-v4-pro","content":[
 {"type":"server_tool_use","id":"w1","name":"web_search","input":{"query":"x"}},
 {"type":"web_search_tool_result","tool_use_id":"w1","content":[{"type":"web_search_result","url":"https://x.ai","title":"x"}]}
]}}
normalized = runner.normalize_grok_build_event(web)
assert normalized[0]["message"]["content"][0]["name"] == "web_search"
assert normalized[1]["message"]["role"] == "toolResult"

usage = {}
runner.merge_model_usage_rows(usage, {"deepseek/deepseek-v4-pro": {"inputTokens": 10, "modelCalls": 1, "contextWindow": 1000000}})
runner.merge_model_usage_rows(usage, {"deepseek/deepseek-v4-pro": {"inputTokens": 7, "modelCalls": 1, "contextWindow": 1000000}})
assert usage["deepseek/deepseek-v4-pro"]["inputTokens"] == 17
assert usage["deepseek/deepseek-v4-pro"]["modelCalls"] == 2
assert usage["deepseek/deepseek-v4-pro"]["contextWindow"] == 1000000

with tempfile.TemporaryDirectory() as td:
    path = Path(td) / "state.json"
    runner.write_json_atomic(path, {"ok": True})
    assert json.loads(path.read_text(encoding="utf-8"))["ok"] is True

print("PASS: Grok Build runner parser, model usage aggregation, and atomic-write self-test.")
