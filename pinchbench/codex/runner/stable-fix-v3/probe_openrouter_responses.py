#!/usr/bin/env python3
from __future__ import annotations

import argparse
import http.client
import json
import os
import socket
import ssl
import sys
import time
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

HOST = "openrouter.ai"
PATH = "/api/v1/responses"
MODEL = "deepseek/deepseek-v4-pro"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--proxy", default="http://127.0.0.1:10090")
    parser.add_argument("--short-attempts", type=int, default=5)
    parser.add_argument("--long-attempts", type=int, default=2)
    parser.add_argument("--mode", choices=("proxy", "direct"), default="proxy")
    parser.add_argument("--output", required=True)
    return parser.parse_args()


def create_connection(
    mode: str,
    proxy_url: str,
    connect_timeout: float,
) -> http.client.HTTPSConnection:
    context = ssl.create_default_context()

    if mode == "direct":
        return http.client.HTTPSConnection(
            HOST,
            443,
            timeout=connect_timeout,
            context=context,
        )

    parsed = urlparse(proxy_url)
    if parsed.scheme not in {"http", "https"}:
        raise RuntimeError(
            f"Only HTTP/HTTPS proxy URLs are supported, got: {proxy_url}"
        )
    if not parsed.hostname or not parsed.port:
        raise RuntimeError(f"Invalid proxy URL: {proxy_url}")

    with socket.create_connection(
        (parsed.hostname, parsed.port),
        timeout=5,
    ):
        pass

    connection = http.client.HTTPSConnection(
        parsed.hostname,
        parsed.port,
        timeout=connect_timeout,
        context=context,
    )
    connection.set_tunnel(HOST, 443)
    return connection


def iter_sse_events(response: http.client.HTTPResponse):
    event_name: str | None = None
    data_lines: list[str] = []

    while True:
        raw = response.readline()
        if not raw:
            if event_name is not None or data_lines:
                yield event_name, "\n".join(data_lines)
            break

        line = raw.decode("utf-8", errors="replace").rstrip("\r\n")

        if line == "":
            yield event_name, "\n".join(data_lines)
            event_name = None
            data_lines = []
            continue

        if line.startswith(":"):
            continue

        if line.startswith("event:"):
            event_name = line[6:].strip()
        elif line.startswith("data:"):
            data_lines.append(line[5:].lstrip())


def run_stream(
    *,
    key: str,
    mode: str,
    proxy_url: str,
    label: str,
    prompt: str,
    max_output_tokens: int,
) -> dict[str, Any]:
    payload = json.dumps(
        {
            "model": MODEL,
            "input": prompt,
            "stream": True,
            "max_output_tokens": max_output_tokens,
        },
        ensure_ascii=False,
    ).encode("utf-8")

    headers = {
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Accept": "text/event-stream",
        "Content-Length": str(len(payload)),
        "HTTP-Referer": "https://localhost/pinchbench-codex-diagnostic",
        "X-Title": "PinchBench Codex transport diagnostic",
        "Connection": "close",
    }

    started = time.monotonic()
    first_event_s: float | None = None
    completed = False
    failed = False
    done_marker = False
    last_type: str | None = None
    response_id: str | None = None
    data_bytes = 0
    error_events: list[dict[str, Any]] = []
    headers_out: dict[str, str] = {}
    connection: http.client.HTTPSConnection | None = None

    try:
        connection = create_connection(mode, proxy_url, 30)
        connection.request("POST", PATH, body=payload, headers=headers)
        response = connection.getresponse()

        headers_out = {
            name: response.getheader(name, "")
            for name in (
                "x-request-id",
                "cf-ray",
                "x-openrouter-generation-id",
                "server",
            )
            if response.getheader(name)
        }

        if response.status < 200 or response.status >= 300:
            body = response.read(4096).decode("utf-8", errors="replace")
            raise RuntimeError(
                f"HTTP {response.status} {response.reason}: {body}"
            )

        # Allow long reads after connection establishment.
        if connection.sock is not None:
            connection.sock.settimeout(420)

        for event_name, data in iter_sse_events(response):
            if first_event_s is None and (event_name or data):
                first_event_s = time.monotonic() - started

            data_bytes += len(data.encode("utf-8"))
            if event_name:
                last_type = event_name

            if data == "[DONE]":
                done_marker = True
                continue

            event: dict[str, Any] | None = None
            if data:
                try:
                    parsed = json.loads(data)
                    if isinstance(parsed, dict):
                        event = parsed
                except json.JSONDecodeError:
                    pass

            event_type = (
                str((event or {}).get("type") or event_name or "")
            )
            if event_type:
                last_type = event_type

            if event_type == "response.created":
                response_obj = (event or {}).get("response") or {}
                if isinstance(response_obj, dict):
                    response_id = response_obj.get("id") or response_id
            elif event_type == "response.completed":
                completed = True
                response_obj = (event or {}).get("response") or {}
                if isinstance(response_obj, dict):
                    response_id = response_obj.get("id") or response_id
            elif event_type in {"response.failed", "error"}:
                failed = True
                if event is not None:
                    error_events.append(event)

        elapsed = time.monotonic() - started
        success = completed and not failed
        return {
            "label": label,
            "success": success,
            "completed": completed,
            "failed": failed,
            "done_marker": done_marker,
            "last_type": last_type,
            "elapsed_s": round(elapsed, 3),
            "first_event_s": (
                None
                if first_event_s is None
                else round(first_event_s, 3)
            ),
            "data_bytes": data_bytes,
            "response_id": response_id,
            "headers": headers_out,
            "error_events": error_events,
            "exception": None,
        }
    except Exception as exc:
        elapsed = time.monotonic() - started
        return {
            "label": label,
            "success": False,
            "completed": completed,
            "failed": failed,
            "done_marker": done_marker,
            "last_type": last_type,
            "elapsed_s": round(elapsed, 3),
            "first_event_s": (
                None
                if first_event_s is None
                else round(first_event_s, 3)
            ),
            "data_bytes": data_bytes,
            "response_id": response_id,
            "headers": headers_out,
            "error_events": error_events,
            "exception": f"{type(exc).__name__}: {exc}",
        }
    finally:
        if connection is not None:
            try:
                connection.close()
            except Exception:
                pass


def main() -> int:
    args = parse_args()
    key = os.environ.get("OPENROUTER_API_KEY", "").strip()
    if not key:
        print("FAIL: OPENROUTER_API_KEY is not set.", file=sys.stderr)
        return 2

    tests: list[tuple[str, str, int]] = []

    for index in range(1, args.short_attempts + 1):
        tests.append(
            (
                f"short-{index}",
                "Reply with exactly the single word OK. Do not use tools.",
                64,
            )
        )

    for index in range(1, args.long_attempts + 1):
        tests.append(
            (
                f"long-{index}",
                (
                    "Write a self-contained 1800-2200 word technical essay "
                    "about deterministic benchmarking of coding-agent "
                    "harnesses. Use headings and complete paragraphs. "
                    "Do not use tools, do not browse, and do not stop early."
                ),
                5200,
            )
        )

    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    results: list[dict[str, Any]] = []

    print(f"Mode: {args.mode}")
    print(f"Model: {MODEL}")
    if args.mode == "proxy":
        print(f"Proxy: {args.proxy}")

    for label, prompt, max_tokens in tests:
        result = run_stream(
            key=key,
            mode=args.mode,
            proxy_url=args.proxy,
            label=label,
            prompt=prompt,
            max_output_tokens=max_tokens,
        )
        results.append(result)

        status = "PASS" if result["success"] else "FAIL"
        print(
            f"[{status}] {label} "
            f"elapsed={result['elapsed_s']}s "
            f"first_event={result['first_event_s']}s "
            f"completed={result['completed']} "
            f"last={result['last_type']} "
            f"bytes={result['data_bytes']}"
        )
        if result["exception"]:
            print(f"       {result['exception']}")

    summary = {
        "mode": args.mode,
        "model": MODEL,
        "proxy": args.proxy if args.mode == "proxy" else None,
        "total": len(results),
        "passed": sum(1 for item in results if item["success"]),
        "failed": sum(1 for item in results if not item["success"]),
        "results": results,
    }

    output_path.write_text(
        json.dumps(summary, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    print(f"Diagnostic JSON: {output_path}")

    if summary["failed"]:
        print(
            f"FAIL: {summary['failed']}/{summary['total']} streams did not "
            "receive response.completed.",
            file=sys.stderr,
        )
        return 1

    print(
        f"PASS: {summary['passed']}/{summary['total']} streams received "
        "response.completed."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
