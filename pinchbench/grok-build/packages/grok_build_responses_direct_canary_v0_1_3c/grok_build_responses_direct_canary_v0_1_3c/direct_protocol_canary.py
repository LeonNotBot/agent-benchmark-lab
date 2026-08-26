#!/usr/bin/env python3
from __future__ import annotations

import argparse
import importlib.util
import json
import os
import sys
import tempfile
import threading
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any


class CaptureHandler(BaseHTTPRequestHandler):
    captured: list[dict[str, Any]] = []

    def log_message(self, fmt: str, *args: Any) -> None:
        return

    def do_POST(self) -> None:
        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length)
        body = json.loads(raw.decode("utf-8"))
        self.__class__.captured.append(body)
        response = {
            "id": "resp_direct_protocol_canary",
            "object": "response",
            "status": "completed",
            "model": body.get("model"),
            "output": [],
            "usage": {"input_tokens": 1, "output_tokens": 0, "total_tokens": 1},
        }
        data = json.dumps(response, separators=(",", ":")).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


def load_adapter(path: Path):
    spec = importlib.util.spec_from_file_location("installed_grok_adapter", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Unable to load adapter: {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def start_server(server: Any) -> threading.Thread:
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return thread


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--adapter", required=True)
    parser.add_argument("--expected-version", default="0.1.3")
    args = parser.parse_args()

    adapter_path = Path(args.adapter).resolve()
    if not adapter_path.exists():
        raise SystemExit(f"Adapter not found: {adapter_path}")

    module = load_adapter(adapter_path)
    actual_version = str(getattr(module, "VERSION", ""))
    if actual_version != args.expected_version:
        raise SystemExit(
            f"Expected installed adapter version {args.expected_version}, got {actual_version!r}"
        )

    os.environ["NO_PROXY"] = "localhost,127.0.0.1,::1"
    os.environ["no_proxy"] = "localhost,127.0.0.1,::1"

    CaptureHandler.captured = []
    mock = ThreadingHTTPServer(("127.0.0.1", 0), CaptureHandler)
    mock_thread = start_server(mock)

    with tempfile.TemporaryDirectory(prefix="grok_adapter_direct_canary_") as td:
        log_path = Path(td) / "adapter.jsonl"
        logger = module.JsonlLogger(log_path)
        adapter = module.AdapterServer(
            ("127.0.0.1", 0),
            module.Handler,
            upstream=f"http://127.0.0.1:{mock.server_port}/v1",
            target_model="deepseek/deepseek-v4-pro",
            timeout_seconds=30,
            logger=logger,
        )
        adapter_thread = start_server(adapter)

        malformed = {
            "model": "deepseek-v4-pro-openrouter",
            "stream": False,
            "input": [
                {
                    "type": "message",
                    "role": "user",
                    "content": [
                        {"type": "input_text", "text": "continue after local tool"}
                    ],
                },
                [
                    {
                        "type": "function_call",
                        "call_id": "call_write_canary",
                        "name": "write",
                        "arguments": {
                            "file_path": "report.md",
                            "content": "long report body",
                        },
                    },
                    {
                        "type": "function_call_output",
                        "call_id": "call_write_canary",
                        "output": [
                            {"type": "text", "text": "write completed"},
                            {"type": "metadata", "bytes_written": 12345},
                        ],
                    },
                ],
            ],
        }
        payload = json.dumps(malformed, ensure_ascii=False).encode("utf-8")
        req = urllib.request.Request(
            f"http://127.0.0.1:{adapter.server_port}/v1/responses",
            data=payload,
            headers={
                "Authorization": "Bearer direct-canary",
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
            method="POST",
        )
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        with opener.open(req, timeout=30) as response:
            response_body = json.loads(response.read().decode("utf-8"))

        adapter.shutdown()
        adapter.server_close()
        adapter_thread.join(timeout=5)

        if response_body.get("status") != "completed":
            raise AssertionError(f"Unexpected adapter response: {response_body}")
        if len(CaptureHandler.captured) != 1:
            raise AssertionError(f"Expected one captured upstream request, got {len(CaptureHandler.captured)}")

        forwarded = CaptureHandler.captured[0]
        if forwarded.get("model") != "deepseek/deepseek-v4-pro":
            raise AssertionError(f"Model was not forced: {forwarded.get('model')!r}")
        items = forwarded.get("input")
        if not isinstance(items, list) or len(items) != 3:
            raise AssertionError(f"Expected three flat input items, got: {items!r}")
        if any(isinstance(item, list) for item in items):
            raise AssertionError("Nested array remained in forwarded top-level input")
        if items[0]["content"] != malformed["input"][0]["content"]:
            raise AssertionError("Message content array was incorrectly modified")
        if not isinstance(items[1].get("arguments"), str):
            raise AssertionError("function_call.arguments was not JSON-stringified")
        if json.loads(items[1]["arguments"])["file_path"] != "report.md":
            raise AssertionError("function_call.arguments content changed")
        if not isinstance(items[2].get("output"), str):
            raise AssertionError("function_call_output.output was not JSON-stringified")
        decoded_output = json.loads(items[2]["output"])
        if decoded_output[1]["bytes_written"] != 12345:
            raise AssertionError("function_call_output.output content changed")

        rows = [
            json.loads(line)
            for line in log_path.read_text(encoding="utf-8").splitlines()
            if line.strip()
        ]
        evidence = [row for row in rows if row.get("event") == "request_wire_format_normalized"]
        if len(evidence) != 1:
            raise AssertionError(f"Expected one normalization log row, got {len(evidence)}")
        row = evidence[0]
        expected_counts = {
            "input_nested_arrays_flattened": 1,
            "input_items_recovered": 2,
            "tool_outputs_stringified": 1,
            "tool_arguments_stringified": 1,
        }
        for key, expected in expected_counts.items():
            if int(row.get(key, -1)) != expected:
                raise AssertionError(f"Unexpected {key}: {row.get(key)!r}; expected {expected}")

        print("PASS: installed adapter version is 0.1.3")
        print("PASS: malformed top-level Responses input array was flattened")
        print("PASS: structured tool arguments and outputs were JSON-stringified")
        print("PASS: message content arrays were preserved")
        print("PASS: normalized request reached the mock upstream and completed")
        print("NORMALIZATION_EVIDENCE=" + json.dumps(row, ensure_ascii=False, separators=(",", ":")))

    mock.shutdown()
    mock.server_close()
    mock_thread.join(timeout=5)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
