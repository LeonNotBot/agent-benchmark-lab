#!/usr/bin/env python3
from __future__ import annotations
import importlib.util
import json
import sys
from pathlib import Path

def load(path: Path):
    spec=importlib.util.spec_from_file_location("adapter_under_test",path)
    module=importlib.util.module_from_spec(spec)
    sys.modules[spec.name]=module
    assert spec.loader
    spec.loader.exec_module(module)
    return module

def main():
    a=load(Path(__file__).with_name("grok_build_search_adapter.py"))
    searches=[]
    for i in range(14):
        searches.append({
            "type":"web_search_call",
            "id":f"ws_{i}",
            "status":"completed",
            "action":{
                "type":"search",
                "query":f"query {i}",
                "sources": None if i>=10 else [{"type":"url","url":f"https://example.com/{i}"}],
            },
        })
    body={
        "model":"grok-4.5",
        "stream":True,
        "input":[
            {"type":"message","role":"user","content":[{"type":"input_text","text":"research"}]},
            *searches,
            {"type":"function_call","id":"fc1","call_id":"call1","name":"write","arguments":{"file_path":"x.md"}},
            {"type":"function_call_output","call_id":"call1","output":{"ok":True}},
            {"type":"mystery_provider_item","foo":[1,2,3]},
        ],
        "tools":[{"type":"function","name":"write","parameters":{"type":"object"}}],
    }
    normalized,meta=a.normalize_request(body,"deepseek/deepseek-v4-pro")
    assert normalized["model"]=="deepseek/deepseek-v4-pro"
    ws=[x for x in normalized["input"] if x.get("type")=="web_search_call"]
    assert len(ws)==14
    assert all(isinstance(x["action"]["sources"],list) for x in ws)
    assert all(isinstance(x["action"]["queries"],list) for x in ws)
    assert isinstance(normalized["input"][-3]["arguments"],str)
    assert isinstance(normalized["input"][-2]["output"],str)
    assert normalized["input"][-1]["type"]=="message"
    assert not a.validate_canonical_input(normalized["input"])
    portable,pstats=a.compile_portable_history(normalized)
    assert not any(x.get("type")=="web_search_call" for x in portable["input"])
    assert pstats["web_search_items_textualized"]==14
    assert not a.validate_canonical_input(portable["input"])

    event={"type":"response.output_item.added","item":{
        "type":"openrouter:web_search",
        "id":"ws_resp",
        "status":"completed",
        "action":{"type":"search","query":"q","sources":None},
    }}
    text,stats=a.normalize_response_text(json.dumps(event))
    value=json.loads(text)
    assert value["item"]["type"]=="web_search_call"
    assert value["item"]["action"]["sources"]==[]
    assert value["item"]["action"]["queries"]==["q"]
    assert stats["type_translated"]==1
    assert stats["null_arrays_repaired"]>=2

    print("PASS: 14-search real failure shape canonicalized in one pass.")
    print("PASS: null search arrays became schema-valid arrays.")
    print("PASS: structured local tool payloads became JSON strings.")
    print("PASS: unknown history item used general portable-message fallback.")
    print("PASS: full portable history compiler removed provider-specific search items.")
    print("PASS: response-side search events were canonicalized before Grok replay.")
    return 0

if __name__=="__main__":
    raise SystemExit(main())
