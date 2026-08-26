#!/usr/bin/env python3
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import threading
import urllib.parse
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any


def utc_now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


def redact_headers(headers: Any) -> dict[str, str]:
    sensitive = {
        "authorization",
        "proxy-authorization",
        "x-goog-api-key",
        "x-api-key",
        "cookie",
        "set-cookie",
    }
    return {
        key: ("<REDACTED_PRESENT>" if key.lower() in sensitive else value)
        for key, value in headers.items()
    }


class Recorder:
    def __init__(self, log_path: Path) -> None:
        self.log_path = log_path
        self.lock = threading.Lock()
        self.log_path.parent.mkdir(parents=True, exist_ok=True)

    def write(self, record: dict[str, Any]) -> None:
        line = json.dumps(record, ensure_ascii=False, separators=(",", ":"))
        with self.lock:
            with self.log_path.open("a", encoding="utf-8", newline="\n") as file:
                file.write(line + "\n")


def model_entry(name: str) -> dict[str, Any]:
    base = name.removeprefix("models/")
    return {
        "name": f"models/{base}",
        "baseModelId": base,
        "version": "contract-probe-v1",
        "displayName": "Local Gemini CLI Contract Probe",
        "description": "Local protocol recorder. No external model is called.",
        "inputTokenLimit": 1048576,
        "outputTokenLimit": 65536,
        "supportedGenerationMethods": ["generateContent", "countTokens"],
    }


class Handler(BaseHTTPRequestHandler):
    server_version = "GeminiContractProbe/1.0"
    protocol_version = "HTTP/1.1"

    @property
    def recorder(self) -> Recorder:
        return self.server.recorder  # type: ignore[attr-defined]

    def log_message(self, fmt: str, *args: Any) -> None:
        return

    def read_body(self) -> tuple[bytes, Any]:
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = 0
        raw = self.rfile.read(length) if length > 0 else b""
        parsed: Any = None
        if raw:
            try:
                parsed = json.loads(raw.decode("utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError):
                parsed = None
        return raw, parsed

    def record_request(self, raw: bytes, parsed: Any) -> str:
        request_id = str(uuid.uuid4())
        split = urllib.parse.urlsplit(self.path)
        self.recorder.write({
            "timestamp": utc_now(),
            "request_id": request_id,
            "client": self.client_address[0],
            "method": self.command,
            "path": split.path,
            "query": urllib.parse.parse_qs(split.query, keep_blank_values=True),
            "headers": redact_headers(self.headers),
            "body_length": len(raw),
            "body_json": parsed,
            "body_utf8_preview": raw.decode("utf-8", errors="replace")[:2000] if raw else "",
        })
        return request_id

    def send_json(self, status: int, payload: dict[str, Any], request_id: str) -> None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Connection", "close")
        self.send_header("X-Contract-Probe-Request-Id", request_id)
        self.end_headers()
        self.wfile.write(data)
        self.wfile.flush()
        self.close_connection = True

    def send_sse(self, payloads: list[dict[str, Any]], request_id: str) -> None:
        body = b"".join(
            f"data: {json.dumps(payload, ensure_ascii=False)}\n\n".encode("utf-8")
            for payload in payloads
        )
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Connection", "close")
        self.send_header("X-Contract-Probe-Request-Id", request_id)
        self.end_headers()
        self.wfile.write(body)
        self.wfile.flush()
        self.close_connection = True

    def do_GET(self) -> None:
        raw, parsed = self.read_body()
        request_id = self.record_request(raw, parsed)
        path = urllib.parse.urlsplit(self.path).path.lower()

        if path == "/healthz":
            self.send_json(200, {"ok": True, "service": "gemini-cli-contract-probe"}, request_id)
            return

        if path.endswith("/models") or "/models/" in path:
            self.send_json(200, {"models": [
                model_entry("gemini-2.5-flash"),
                model_entry("deepseek/deepseek-v4-pro"),
            ]}, request_id)
            return

        self.send_json(404, {"error": {"code": 404, "message": f"Unimplemented GET endpoint: {path}", "status": "NOT_FOUND"}}, request_id)

    def do_POST(self) -> None:
        raw, parsed = self.read_body()
        request_id = self.record_request(raw, parsed)
        path = urllib.parse.urlsplit(self.path).path.lower()

        if path.endswith(":counttokens"):
            self.send_json(200, {"totalTokens": 1, "promptTokensDetails": [{"modality": "TEXT", "tokenCount": 1}]}, request_id)
            return

        response = {
            "candidates": [{
                "content": {"role": "model", "parts": [{"text": "LOCAL_CONTRACT_PROBE_OK"}]},
                "finishReason": "STOP",
                "index": 0,
            }],
            "usageMetadata": {"promptTokenCount": 1, "candidatesTokenCount": 1, "totalTokenCount": 2},
            "modelVersion": "local-contract-probe-v1",
            "responseId": request_id,
        }

        if path.endswith(":streamgeneratecontent"):
            self.send_sse([response], request_id)
            return
        if path.endswith(":generatecontent"):
            self.send_json(200, response, request_id)
            return

        self.send_json(404, {"error": {"code": 404, "message": f"Unimplemented POST endpoint: {path}", "status": "NOT_FOUND"}}, request_id)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--log", required=True)
    args = parser.parse_args()

    recorder = Recorder(Path(args.log).resolve())
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    server.recorder = recorder  # type: ignore[attr-defined]
    print(json.dumps({"status": "ready", "url": f"http://{args.host}:{args.port}", "log": str(recorder.log_path), "pid": os.getpid()}), flush=True)
    try:
        server.serve_forever(poll_interval=0.2)
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
