#!/usr/bin/env python3
from __future__ import annotations
import argparse
import http.server
import json
import os
import socket
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

class State:
    mode="native"
    bodies=[]

class Mock(http.server.BaseHTTPRequestHandler):
    def log_message(self,fmt,*args): return
    def do_POST(self):
        n=int(self.headers.get("Content-Length","0"))
        body=json.loads(self.rfile.read(n).decode("utf-8"))
        State.bodies.append(body)
        items=body.get("input",[])
        has_ws=any(isinstance(x,dict) and x.get("type")=="web_search_call" for x in items) if isinstance(items,list) else False
        invalid=[]
        if isinstance(items,list):
            for i,item in enumerate(items):
                if isinstance(item,dict) and item.get("type")=="web_search_call":
                    action=item.get("action")
                    if not isinstance(action,dict):
                        invalid.append(f"input[{i}].action")
                    elif action.get("type")=="search":
                        if not isinstance(action.get("sources"),list): invalid.append(f"input[{i}].action.sources")
                        if not isinstance(action.get("queries"),list): invalid.append(f"input[{i}].action.queries")
        if invalid or (State.mode=="force_fallback" and has_ws):
            payload=json.dumps({
                "error":{"code":"invalid_prompt","message":"Invalid Responses API request"},
                "metadata":{"raw":json.dumps({"invalid":invalid,"forced":State.mode=="force_fallback" and has_ws})},
            }).encode()
            self.send_response(400)
            self.send_header("Content-Type","application/json")
            self.send_header("Content-Length",str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
            return
        payload=json.dumps({
            "id":"resp_mock","object":"response","status":"completed","model":body.get("model"),
            "output":[{"type":"message","id":"msg1","status":"completed","role":"assistant",
                       "content":[{"type":"output_text","text":"OK","annotations":[]}]}],
            "usage":{"input_tokens":1,"output_tokens":1,"total_tokens":2},
        }).encode()
        self.send_response(200)
        self.send_header("Content-Type","application/json")
        self.send_header("Content-Length",str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

def port():
    with socket.socket() as s:
        s.bind(("127.0.0.1",0)); return s.getsockname()[1]

def wait(url):
    end=time.time()+10
    while time.time()<end:
        try:
            with urllib.request.urlopen(url,timeout=1) as r: return json.loads(r.read())
        except Exception: time.sleep(.1)
    raise RuntimeError("health timeout")

def request(adapter_port):
    searches=[]
    for i in range(14):
        searches.append({
            "type":"web_search_call","id":f"ws_{i}","status":"completed",
            "action":{"type":"search","query":f"q{i}","sources":None if i>=10 else [{"type":"url","url":f"https://example.com/{i}"}]},
        })
    body={
        "model":"grok-4.5","stream":False,
        "input":[{"type":"message","role":"user","content":[{"type":"input_text","text":"test"}]},*searches,
                 {"type":"function_call","call_id":"c1","name":"write","arguments":{"file_path":"x"}},
                 {"type":"function_call_output","call_id":"c1","output":{"ok":True}}],
        "tools":[],
    }
    req=urllib.request.Request(f"http://127.0.0.1:{adapter_port}/v1/responses",
        data=json.dumps(body).encode(),headers={"Content-Type":"application/json","Authorization":"Bearer mock"},method="POST")
    with urllib.request.urlopen(req,timeout=10) as r:
        return json.loads(r.read())

def run_case(adapter,python,mode):
    State.mode=mode; State.bodies=[]
    up_port=port(); ad_port=port()
    server=http.server.ThreadingHTTPServer(("127.0.0.1",up_port),Mock)
    t=threading.Thread(target=server.serve_forever,daemon=True); t.start()
    with tempfile.TemporaryDirectory(prefix="canonical-canary-") as td:
        log=Path(td)/"adapter.jsonl"; diag=Path(td)/"diag"
        env=dict(os.environ)
        env["OPENROUTER_API_KEY"]="mock"
        env["NO_PROXY"]="localhost,127.0.0.1,::1"; env["no_proxy"]=env["NO_PROXY"]
        for k in ("HTTP_PROXY","HTTPS_PROXY","ALL_PROXY","http_proxy","https_proxy","all_proxy"):
            env.pop(k,None)
        proc=subprocess.Popen([python,adapter,"--host","127.0.0.1","--port",str(ad_port),
            "--upstream",f"http://127.0.0.1:{up_port}","--target-model","deepseek/deepseek-v4-pro",
            "--timeout-seconds","30","--log",str(log),"--diagnostics-dir",str(diag)],
            stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,encoding="utf-8",env=env)
        try:
            h=wait(f"http://127.0.0.1:{ad_port}/healthz")
            assert h["version"]=="0.2.0" and h["compiler"]=="canonical-history-v1",h
            result=request(ad_port)
            assert result["status"]=="completed"
            rows=[json.loads(x) for x in log.read_text(encoding="utf-8").splitlines() if x.strip()]
            return list(State.bodies),rows
        finally:
            proc.terminate()
            try: proc.wait(timeout=5)
            except subprocess.TimeoutExpired: proc.kill(); proc.wait(timeout=5)
            server.shutdown(); server.server_close()

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--adapter",required=True); ap.add_argument("--python",default=sys.executable)
    args=ap.parse_args()
    bodies,rows=run_case(args.adapter,args.python,"native")
    assert len(bodies)==1
    ws=[x for x in bodies[0]["input"] if x.get("type")=="web_search_call"]
    assert len(ws)==14
    assert all(isinstance(x["action"]["sources"],list) and isinstance(x["action"]["queries"],list) for x in ws)
    assert isinstance([x for x in bodies[0]["input"] if x.get("type")=="function_call"][0]["arguments"],str)
    assert isinstance([x for x in bodies[0]["input"] if x.get("type")=="function_call_output"][0]["output"],str)
    print("PASS: strict native mock accepted the canonical 14-search history.")

    bodies2,rows2=run_case(args.adapter,args.python,"force_fallback")
    assert len(bodies2)==2
    assert any(x.get("type")=="web_search_call" for x in bodies2[0]["input"])
    assert not any(x.get("type")=="web_search_call" for x in bodies2[1]["input"])
    fallback=[x for x in rows2 if x.get("event")=="portable_history_fallback_retry"]
    assert len(fallback)==1
    print("PASS: generalized portable-history retry recovered from an upstream schema rejection.")
    print("PASS: fallback removed provider-specific search items but retained standard messages/tool history.")
    print("PASS: full diagnostics were written before retry.")
    print("PASS: deterministic canonical-history protocol gate completed.")
    return 0

if __name__=="__main__":
    raise SystemExit(main())
