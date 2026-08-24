#!/usr/bin/env python3
import json, tempfile, subprocess, sys
from pathlib import Path

CLASSIFIER=Path(__file__).with_name("classify_replacement_attempt.py")

def run(status, sdk_objs, expected, infra_reasons="[]"):
    with tempfile.TemporaryDirectory() as td:
        td=Path(td)
        sdk=td/"sdk.jsonl"
        sdk.write_text("\n".join(json.dumps(x) for x in sdk_objs)+"\n",encoding="utf-8")
        results=td/"results.json"
        doc={"results":[{
            "task_id":"t","status":status,"success":status=="success","score":0.1,
            "error":"","infra_retry_reasons_json":infra_reasons,
            "turn_results":[{"raw_sdk_messages":str(sdk),"raw_server_events":""}]
        }]}
        results.write_text(json.dumps(doc),encoding="utf-8")
        cp=subprocess.run([sys.executable,str(CLASSIFIER),"--results-json",str(results),"--task-id","t"],capture_output=True,text=True,encoding="utf-8")
        assert cp.returncode==0,cp.stderr
        out=json.loads(cp.stdout)
        assert out["decision"]==expected,(status,out)
        return out

# success wins even with recovered tool-level 429
run("success",[{"type":"user","message":{"content":[{"type":"tool_result","content":"API Error: 429 Provider returned error"}]}}],"accept")
# clean timeout is a valid benchmark outcome
run("timeout",[],"accept")
# timeout contaminated by infra gets a fresh retry
run("timeout",[{"type":"assistant","error":{"error":{"code":504,"message":"The operation was aborted"}}}],"retry")
# exact live failure shape: status=error + synthetic structured 504
o=run("error",[{"type":"assistant","model":"<synthetic>","content":[{"type":"text","text":"API Error: The operation was aborted"}],"error":{"error":{"code":504,"message":"The operation was aborted","metadata":{"error_type":"timeout"}},"code":504}}],"retry")
assert any(e["kind"]=="operation_aborted_504" for e in o["infra_evidence"])
run("error",[{"type":"result","is_error":True,"result":"API Error: 429 Provider returned error"}],"retry")
run("error",[{"type":"assistant","error":{"code":502,"message":"Gateway error: fetch failed"}}],"retry")
# unknown model/framework error cannot be silently accepted or sampled again
run("error",[{"type":"result","is_error":True,"result":"some unknown model/tool failure"}],"review")

# missing raw SDK must never be silently accepted because final token recount depends on it
with tempfile.TemporaryDirectory() as td:
    td=Path(td)
    results=td/"results.json"
    doc={"results":[{"task_id":"t","status":"success","success":True,"score":1.0,
                    "error":"","infra_retry_reasons_json":"[]",
                    "turn_results":[{"raw_sdk_messages":str(td/"missing.sdk.jsonl"),"raw_server_events":""}]}]}
    results.write_text(json.dumps(doc),encoding="utf-8")
    cp=subprocess.run([sys.executable,str(CLASSIFIER),"--results-json",str(results),"--task-id","t"],capture_output=True,text=True,encoding="utf-8")
    out=json.loads(cp.stdout)
    assert out["decision"]=="review",out
    assert out["reason"]=="raw_sdk_missing_or_unreadable",out

print("ALL CLASSIFIER TESTS PASS")
