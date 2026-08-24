#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Classify one PinchBench replacement attempt using BOTH results.json metadata and raw SDK JSONL.

Decision policy:
- success: ACCEPT (even if a transient tool-level infra error was recovered)
- timeout + no infra evidence: ACCEPT (valid benchmark terminal outcome)
- error/timeout + infra evidence (429/502/504, gateway fetch failure, operation aborted 504): RETRY
- error/other terminal state + no infra evidence: REVIEW (never auto-accept, never auto-rerun)
"""
from __future__ import annotations
import argparse, json, re, sys
from pathlib import Path
from typing import Any

RETRY_CODES = {429, 502, 504}
API_ERROR_RE = re.compile(r"(?i)\bAPI\s+Error\b[^\r\n]{0,180}\b(429|502|504)\b")
GATEWAY_FETCH_RE = re.compile(r"(?i)\b(?:502\s+)?Gateway\s+error\b[^\r\n]{0,120}\bfetch\s+failed\b")
PROVIDER_429_RE = re.compile(r"(?i)\bProvider\s+returned\s+error\b[^\r\n]{0,80}\b429\b")
WEB_429_RE = re.compile(r"(?i)\bWeb(?:Search|Fetch)\b[^\r\n]{0,120}\b429\b")
OP_ABORT_RE = re.compile(r"(?i)\boperation\s+was\s+aborted\b")
INFRA_REASON_RE = re.compile(r"(?i)(429|502|504|websearch_429|provider_429|gateway|upstream)")

def walk(obj: Any):
    if isinstance(obj, dict):
        yield obj
        for v in obj.values():
            yield from walk(v)
    elif isinstance(obj, list):
        for v in obj:
            yield from walk(v)

def strings(obj: Any):
    if isinstance(obj, str):
        yield obj
    elif isinstance(obj, dict):
        for v in obj.values():
            yield from strings(v)
    elif isinstance(obj, list):
        for v in obj:
            yield from strings(v)

def extract_codes(obj: Any):
    for d in walk(obj):
        for key in ("code", "status", "status_code", "statusCode", "http_status", "httpStatus"):
            v=d.get(key)
            if isinstance(v, int):
                yield v
            elif isinstance(v, str) and v.strip().isdigit():
                yield int(v.strip())

def add_evidence(evidence, kind, source, detail):
    item={"kind":kind,"source":source,"detail":detail[:400]}
    if item not in evidence:
        evidence.append(item)

def inspect_obj(obj: Any, source: str, evidence: list[dict]):
    codes=set(extract_codes(obj))
    joined="\n".join(strings(obj))
    for code in sorted(codes & RETRY_CODES):
        add_evidence(evidence, f"http_{code}", source, f"structured code={code}")
    for m in API_ERROR_RE.finditer(joined):
        add_evidence(evidence, f"api_{m.group(1)}", source, m.group(0))
    if GATEWAY_FETCH_RE.search(joined):
        add_evidence(evidence, "gateway_fetch_failed", source, GATEWAY_FETCH_RE.search(joined).group(0))
    if PROVIDER_429_RE.search(joined):
        add_evidence(evidence, "provider_429", source, PROVIDER_429_RE.search(joined).group(0))
    if WEB_429_RE.search(joined):
        add_evidence(evidence, "web_429", source, WEB_429_RE.search(joined).group(0))
    if OP_ABORT_RE.search(joined) and 504 in codes:
        add_evidence(evidence, "operation_aborted_504", source, "operation was aborted with structured code 504")

def resolve_log_path(raw: Any) -> Path | None:
    if not raw:
        return None
    p=Path(str(raw))
    return p

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--results-json", required=True)
    ap.add_argument("--task-id", required=True)
    args=ap.parse_args()

    rp=Path(args.results_json)
    try:
        doc=json.loads(rp.read_text(encoding="utf-8-sig"))
    except Exception as e:
        print(json.dumps({"decision":"retry","reason":"results_json_unreadable","detail":str(e)}, ensure_ascii=False))
        return 0

    rows=doc.get("results") if isinstance(doc,dict) else None
    if not isinstance(rows,list):
        print(json.dumps({"decision":"retry","reason":"results_rows_missing"}, ensure_ascii=False))
        return 0
    row=next((x for x in rows if isinstance(x,dict) and x.get("task_id")==args.task_id), None)
    if row is None:
        print(json.dumps({"decision":"retry","reason":"task_row_missing"}, ensure_ascii=False))
        return 0

    status=str(row.get("status") or "").strip().lower()
    evidence=[]

    # Top-level row fields.
    inspect_obj({
        "error": row.get("error"),
        "grade_error": row.get("grade_error"),
        "stderr": row.get("stderr"),
        "output": row.get("output"),
        "infra_retry_reasons_json": row.get("infra_retry_reasons_json"),
    }, "results_row", evidence)

    reasons_raw=row.get("infra_retry_reasons_json")
    if isinstance(reasons_raw,str) and INFRA_REASON_RE.search(reasons_raw):
        add_evidence(evidence, "runner_infra_retry_reason", "results_row", reasons_raw)

    # Raw SDK is authoritative for errors hidden from results.json.
    log_paths=[]
    sdk_paths=[]
    for tr in row.get("turn_results") or []:
        if not isinstance(tr,dict): continue
        for key in ("raw_sdk_messages","raw_server_events"):
            p=resolve_log_path(tr.get(key))
            if p and p not in log_paths:
                log_paths.append(p)
            if key == "raw_sdk_messages" and p and p not in sdk_paths:
                sdk_paths.append(p)

    scanned=[]
    missing=[]
    for p in log_paths:
        if not p.exists():
            missing.append(str(p))
            continue
        scanned.append(str(p))
        try:
            with p.open("r",encoding="utf-8-sig",errors="replace") as f:
                for lineno,line in enumerate(f,1):
                    s=line.strip()
                    if not s: continue
                    try:
                        obj=json.loads(s)
                    except Exception:
                        # Still inspect textual evidence if one malformed line contains an API error.
                        if API_ERROR_RE.search(s):
                            m=API_ERROR_RE.search(s)
                            add_evidence(evidence,f"api_{m.group(1)}",f"{p.name}:{lineno}",m.group(0))
                        if OP_ABORT_RE.search(s) and '"code":504' in s.replace(" ",""):
                            add_evidence(evidence,"operation_aborted_504",f"{p.name}:{lineno}","operation was aborted with code 504")
                        continue
                    inspect_obj(obj,f"{p.name}:{lineno}",evidence)
        except Exception as e:
            missing.append(f"{p}: {e}")

    has_infra=bool(evidence)
    sdk_scanned=[str(p) for p in sdk_paths if str(p) in scanned]
    sdk_integrity_ok=bool(sdk_scanned) and all(p.exists() for p in sdk_paths)

    # Missing raw SDK makes the attempt unsuitable for final token recount and prevents
    # reliable infra classification. Never silently accept/retry it.
    if not sdk_integrity_ok:
        decision="review"
        reason="raw_sdk_missing_or_unreadable"
    # Methodologically conservative tri-state policy.
    elif status == "success":
        decision="accept"
        reason="success_terminal_outcome"
    elif status == "timeout":
        if has_infra:
            decision="retry"
            reason="timeout_with_infra_evidence"
        else:
            decision="accept"
            reason="clean_benchmark_timeout"
    elif status == "error":
        if has_infra:
            decision="retry"
            reason="error_with_infra_evidence"
        else:
            decision="review"
            reason="error_without_infra_evidence"
    else:
        if has_infra:
            decision="retry"
            reason=f"unexpected_status_{status or 'blank'}_with_infra_evidence"
        else:
            decision="review"
            reason=f"unexpected_status_{status or 'blank'}"

    result={
        "decision":decision,
        "reason":reason,
        "task_id":args.task_id,
        "status":status,
        "success":bool(row.get("success")),
        "score":row.get("score"),
        "infra_evidence":evidence,
        "raw_logs_scanned":scanned,
        "raw_logs_missing":missing,
        "raw_sdk_integrity_ok":sdk_integrity_ok,
        "qwen_calls":row.get("qwen_calls"),
        "kimi_calls":row.get("kimi_calls"),
        "critical_task_count":row.get("critical_task_count"),
        "escalation_count":row.get("escalation_count"),
        "deescalation_count":row.get("deescalation_count"),
    }
    print(json.dumps(result,ensure_ascii=False,separators=(",",":")))
    return 0

if __name__=="__main__":
    raise SystemExit(main())
