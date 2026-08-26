#!/usr/bin/env python3
from __future__ import annotations

import argparse
import http.server
import importlib.util
import json
import socket
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request
from pathlib import Path
from typing import Any


class UpstreamHandler(http.server.BaseHTTPRequestHandler):
    received: dict[str, Any] | None = None

    def log_message(self, fmt: str, *args: Any) -> None:
        return

    def do_POST(self) -> None:
        length = int(self.headers.get("Content-Length", "0"))
        body = json.loads(self.rfile.read(length).decode("utf-8"))
        UpstreamHandler.received = body

        reasoning = [item for item in body.get("input", []) if isinstance(item, dict) and item.get("type") == "reasoning"]
        if not reasoning or any(not isinstance(item.get("summary"), list) for item in reasoning):
            payload = json.dumps(
                {
                    "error": {"code": "invalid_prompt", "message": "Invalid Responses API request"},
                    "metadata": {"raw": "reasoning.summary must be an array"},
                }
            ).encode("utf-8")
            self.send_response(400)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
            return

        payload = json.dumps(
            {
                "id": "resp_mock",
                "object": "response",
                "status": "completed",
                "model": body.get("model"),
                "output": [
                    {
                        "type": "reasoning",
                        "id": "rs_returned",
                        "encrypted_content": "opaque",
                    },
                    {
                        "type": "message",
                        "id": "msg_mock",
                        "status": "completed",
                        "role": "assistant",
                        "content": [{"type": "output_text", "text": "OK", "annotations": []}],
                    },
                ],
                "usage": {"input_tokens": 1, "output_tokens": 1, "total_tokens": 2},
            }
        ).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)


def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def wait_health(url: str, timeout: float = 10.0) -> dict[str, Any]:
    deadline = time.time() + timeout
    last: Exception | None = None
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=1) as response:
                return json.loads(response.read().decode("utf-8"))
        except Exception as exc:
            last = exc
            time.sleep(0.1)
    raise RuntimeError(f"health timeout: {last}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--adapter", required=True)
    parser.add_argument("--python", default=sys.executable)
    args = parser.parse_args()

    upstream_port = free_port()
    adapter_port = free_port()
    upstream = http.server.ThreadingHTTPServer(("127.0.0.1", upstream_port), UpstreamHandler)
    thread = threading.Thread(target=upstream.serve_forever, daemon=True)
    thread.start()

    with tempfile.TemporaryDirectory(prefix="grok-reasoning-canary-") as temp_dir:
        log_path = Path(temp_dir) / "adapter.jsonl"
        proc = subprocess.Popen(
            [
                args.python,
                args.adapter,
                "--host", "127.0.0.1",
                "--port", str(adapter_port),
                "--upstream", f"http://127.0.0.1:{upstream_port}",
                "--target-model", "deepseek/deepseek-v4-pro",
                "--timeout-seconds", "30",
                "--log", str(log_path),
            ],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            env={**__import__("os").environ, "OPENROUTER_API_KEY": "mock-key"},
        )
        try:
            health = wait_health(f"http://127.0.0.1:{adapter_port}/healthz")
            assert health["version"] == "0.1.4", health

            request_body = {
                "model": "deepseek/deepseek-v4-pro",
                "stream": False,
                "input": [
                    {"type": "message", "role": "user", "content": [{"type": "input_text", "text": "continue"}]},
                    {"type": "reasoning", "id": "rs_bad", "encrypted_content": "opaque"},
                    {
                        "type": "web_search_call",
                        "id": "ws_1",
                        "status": "completed",
                        "action": {"type": "search", "query": "WASI status", "sources": []},
                    },
                    {"type": "function_call", "call_id": "c1", "name": "todo_write", "arguments": "{}"},
                    {"type": "function_call_output", "call_id": "c1", "output": "{}"},
                ],
                "tools": [],
            }
            data = json.dumps(request_body).encode("utf-8")
            request = urllib.request.Request(
                f"http://127.0.0.1:{adapter_port}/v1/responses",
                data=data,
                headers={"Content-Type": "application/json", "Authorization": "Bearer mock-key"},
                method="POST",
            )
            with urllib.request.urlopen(request, timeout=10) as response:
                returned = json.loads(response.read().decode("utf-8"))

            received = UpstreamHandler.received
            assert received is not None
            reasoning = [item for item in received["input"] if item.get("type") == "reasoning"]
            assert reasoning[0]["summary"] == []
            assert any(item.get("type") == "web_search_call" for item in received["input"])
            assert returned["output"][0]["type"] == "reasoning"
            assert returned["output"][0]["summary"] == []

            rows = [json.loads(line) for line in log_path.read_text(encoding="utf-8").splitlines() if line.strip()]
            request_evidence = [
                row for row in rows
                if row.get("event") == "request_wire_format_normalized"
                and int(row.get("reasoning_summaries_injected", 0)) >= 1
            ]
            response_evidence = [
                row for row in rows
                if row.get("event") == "request_completed"
                and int(row.get("reasoning_summaries_injected", 0)) >= 1
            ]
            assert request_evidence, rows
            assert response_evidence, rows

            print("PASS: malformed reasoning history reached Adapter v0.1.4.")
            print("PASS: request reasoning.summary=[] reached the mock upstream.")
            print("PASS: web-search and local-tool history remained present.")
            print("PASS: malformed reasoning item in the upstream response was repaired.")
            print("REQUEST_EVIDENCE=" + json.dumps(request_evidence[-1], ensure_ascii=False, separators=(",", ":")))
            print("RESPONSE_EVIDENCE=" + json.dumps(response_evidence[-1], ensure_ascii=False, separators=(",", ":")))
        finally:
            proc.terminate()
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait(timeout=5)
            upstream.shutdown()
            upstream.server_close()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
