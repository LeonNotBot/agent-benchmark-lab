#!/usr/bin/env python3
"""
Thin Grok Build -> OpenRouter Responses API compatibility adapter.

Observed incompatibilities addressed:
1. Grok Build's web-search subrequest selected grok-4.5 instead of the benchmark model.
2. OpenRouter streamed item type "openrouter:web_search", while Grok Build expects
   "web_search_call".
3. OpenRouter omitted the required "action" object on in-progress web_search_call items.
4. Some requests explicitly disabled reasoning although the selected endpoint requires it.

This adapter does NOT translate Grok Build local tools, prompts, files, sessions, or
PinchBench Runner behavior.
"""

from __future__ import annotations

import argparse
import datetime as dt
import http.server
import json
import os
import socketserver
import threading
import traceback
import urllib.error
import urllib.request
import uuid
from pathlib import Path
from typing import Any

VERSION = "0.1.1"


def utc_now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


class JsonlLogger:
    def __init__(self, path: Path) -> None:
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.lock = threading.Lock()

    def write(self, event: str, **fields: Any) -> None:
        row = {"ts": utc_now(), "event": event, **fields}
        with self.lock:
            with self.path.open("a", encoding="utf-8") as f:
                f.write(json.dumps(row, ensure_ascii=False) + "\n")


def reasoning_disabled(value: Any) -> bool:
    if value is False or value is None:
        return True
    if isinstance(value, str):
        return value.strip().lower() in {"none", "off", "disabled", "false"}
    if isinstance(value, dict):
        effort = str(value.get("effort", "")).strip().lower()
        enabled = value.get("enabled")
        return effort in {"none", "off", "disabled"} or enabled is False
    return False


def normalize_request(body: dict[str, Any], target_model: str) -> tuple[dict[str, Any], dict[str, Any]]:
    original_model = body.get("model")
    body["model"] = target_model

    removed = []
    for key in ("reasoning", "reasoning_effort"):
        if key in body and reasoning_disabled(body.get(key)):
            body.pop(key, None)
            removed.append(key)

    return body, {
        "original_model": original_model,
        "forced_model": target_model,
        "removed_disabled_reasoning_fields": removed,
        "stream": bool(body.get("stream")),
        "tool_count": len(body.get("tools", [])) if isinstance(body.get("tools"), list) else 0,
    }


def placeholder_search_action() -> dict[str, Any]:
    """
    Grok Build 0.52.0 requires `action` even on an in-progress web_search_call.

    OpenAI's Responses schema models a search action with type/search query fields
    and source URLs. OpenRouter may omit the action object on the initial
    response.output_item.added event, so use an empty, schema-shaped placeholder.
    A later item carrying a real action is preserved unchanged.
    """
    return {
        "type": "search",
        "query": "",
        "queries": [],
        "sources": [],
    }


def normalize_response_value(value: Any, stats: dict[str, int]) -> Any:
    if isinstance(value, list):
        return [normalize_response_value(item, stats) for item in value]

    if not isinstance(value, dict):
        return value

    normalized = {
        key: normalize_response_value(item, stats)
        for key, item in value.items()
    }

    if normalized.get("type") == "openrouter:web_search":
        normalized["type"] = "web_search_call"
        stats["type_translated"] = stats.get("type_translated", 0) + 1

    if (
        normalized.get("type") == "web_search_call"
        and "action" not in normalized
    ):
        normalized["action"] = placeholder_search_action()
        stats["action_injected"] = stats.get("action_injected", 0) + 1

    return normalized


def normalize_response_text(text: str) -> tuple[str, dict[str, int]]:
    stats: dict[str, int] = {
        "type_translated": 0,
        "action_injected": 0,
    }

    stripped = text.strip()
    if not stripped or stripped == "[DONE]":
        return text, stats

    try:
        parsed = json.loads(stripped)
    except json.JSONDecodeError:
        normalized = text.replace(
            '"type":"openrouter:web_search"',
            '"type":"web_search_call"',
        )
        normalized = normalized.replace(
            '"type": "openrouter:web_search"',
            '"type": "web_search_call"',
        )
        if normalized != text:
            stats["type_translated"] += 1
        return normalized, stats

    normalized_value = normalize_response_value(parsed, stats)
    normalized_text = json.dumps(
        normalized_value,
        ensure_ascii=False,
        separators=(",", ":"),
    )
    return normalized_text, stats


class ThreadedHTTPServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True


class AdapterServer(ThreadedHTTPServer):
    def __init__(
        self,
        address: tuple[str, int],
        handler: type[http.server.BaseHTTPRequestHandler],
        upstream: str,
        target_model: str,
        timeout_seconds: int,
        logger: JsonlLogger,
    ) -> None:
        super().__init__(address, handler)
        self.upstream = upstream.rstrip("/")
        self.target_model = target_model
        self.timeout_seconds = timeout_seconds
        self.logger = logger


class Handler(http.server.BaseHTTPRequestHandler):
    server: AdapterServer
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt: str, *args: Any) -> None:
        self.server.logger.write("http_access", message=fmt % args)

    def send_json(self, status: int, obj: dict[str, Any]) -> None:
        data = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Connection", "close")
        self.end_headers()
        self.wfile.write(data)
        self.wfile.flush()
        self.close_connection = True

    def do_GET(self) -> None:
        if self.path.rstrip("/") == "/healthz":
            self.send_json(
                200,
                {
                    "ok": True,
                    "name": "grok-build-search-adapter",
                    "version": VERSION,
                    "target_model": self.server.target_model,
                    "upstream": self.server.upstream,
                },
            )
        else:
            self.send_json(404, {"error": "not_found", "path": self.path})

    def do_POST(self) -> None:
        request_id = str(uuid.uuid4())

        if self.path not in {"/v1/responses", "/responses"}:
            self.send_json(404, {"error": "unsupported_path", "path": self.path})
            return

        try:
            length = int(self.headers.get("Content-Length", "0"))
            raw = self.rfile.read(length)
            body = json.loads(raw.decode("utf-8"))
            if not isinstance(body, dict):
                raise ValueError("Request body must be a JSON object.")

            body, metadata = normalize_request(body, self.server.target_model)
            payload = json.dumps(body, ensure_ascii=False).encode("utf-8")
            stream = bool(body.get("stream"))

            authorization = self.headers.get("Authorization", "").strip()
            if not authorization:
                key = os.environ.get("OPENROUTER_API_KEY", "").strip()
                if not key:
                    raise RuntimeError("OPENROUTER_API_KEY is not set.")
                authorization = f"Bearer {key}"

            headers = {
                "Authorization": authorization,
                "Content-Type": "application/json",
                "Accept": "text/event-stream" if stream else "application/json",
                "Accept-Encoding": "identity",
                "User-Agent": "PinchBench-GrokBuild-Search-Adapter/0.1.1",
                "HTTP-Referer": "https://github.com/xai-org/grok-build",
                "X-Title": "PinchBench Grok Build",
            }

            upstream_url = self.server.upstream + "/responses"
            self.server.logger.write(
                "request_start",
                request_id=request_id,
                path=self.path,
                upstream_url=upstream_url,
                metadata=metadata,
                body_bytes=len(payload),
            )

            req = urllib.request.Request(
                upstream_url,
                data=payload,
                headers=headers,
                method="POST",
            )

            try:
                upstream = urllib.request.urlopen(req, timeout=self.server.timeout_seconds)
            except urllib.error.HTTPError as exc:
                error_body = exc.read()
                self.server.logger.write(
                    "upstream_http_error",
                    request_id=request_id,
                    status=exc.code,
                    body_preview=error_body[:6000].decode("utf-8", errors="replace"),
                )
                self.send_response(exc.code)
                self.send_header("Content-Type", exc.headers.get("Content-Type", "application/json"))
                self.send_header("Content-Length", str(len(error_body)))
                self.send_header("Connection", "close")
                self.end_headers()
                self.wfile.write(error_body)
                self.wfile.flush()
                self.close_connection = True
                return

            status = getattr(upstream, "status", 200)
            content_type = upstream.headers.get("Content-Type", "")
            is_sse = "text/event-stream" in content_type.lower()

            self.server.logger.write(
                "upstream_connected",
                request_id=request_id,
                status=status,
                content_type=content_type,
                stream=is_sse,
            )

            if is_sse:
                self.send_response(status)
                self.send_header("Content-Type", "text/event-stream")
                self.send_header("Cache-Control", "no-cache")
                self.send_header("Connection", "close")
                self.end_headers()

                event_count = 0
                translated_count = 0

                for raw_line in upstream:
                    line = raw_line.decode("utf-8", errors="replace")
                    if line.startswith("data:"):
                        event_count += 1
                        prefix, payload_text = line.split(":", 1)
                        normalized, event_stats = normalize_response_text(payload_text)
                        translated_count += event_stats["type_translated"]
                        if event_stats["type_translated"] or event_stats["action_injected"]:
                            self.server.logger.write(
                                "response_event_normalized",
                                request_id=request_id,
                                type_translated=event_stats["type_translated"],
                                action_injected=event_stats["action_injected"],
                            )
                        line = prefix + ": " + normalized + "\n"

                    self.wfile.write(line.encode("utf-8"))
                    self.wfile.flush()

                self.close_connection = True
                self.server.logger.write(
                    "request_completed",
                    request_id=request_id,
                    status=status,
                    stream=True,
                    event_count=event_count,
                    translated_count=translated_count,
                )
                return

            response_body = upstream.read()
            response_text = response_body.decode("utf-8", errors="replace")
            normalized_text, response_stats = normalize_response_text(response_text)
            response_body = normalized_text.encode("utf-8")

            self.send_response(status)
            self.send_header("Content-Type", content_type or "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(response_body)))
            self.send_header("Connection", "close")
            self.end_headers()
            self.wfile.write(response_body)
            self.wfile.flush()
            self.close_connection = True

            self.server.logger.write(
                "request_completed",
                request_id=request_id,
                status=status,
                stream=False,
                translated_count=response_stats["type_translated"],
                action_injected=response_stats["action_injected"],
            )

        except BrokenPipeError:
            self.server.logger.write(
                "client_disconnected",
                request_id=request_id,
                error="BrokenPipeError",
            )
        except Exception as exc:
            self.server.logger.write(
                "adapter_exception",
                request_id=request_id,
                error=repr(exc),
                traceback=traceback.format_exc(),
            )
            try:
                self.send_json(
                    500,
                    {
                        "error": "adapter_exception",
                        "message": str(exc),
                        "request_id": request_id,
                    },
                )
            except Exception:
                pass


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8767)
    parser.add_argument("--upstream", default="https://openrouter.ai/api/v1")
    parser.add_argument("--target-model", default="deepseek/deepseek-v4-pro")
    parser.add_argument("--timeout-seconds", type=int, default=900)
    parser.add_argument(
        "--log",
        default=r"C:\pinchbench-grok-build\logs\search-adapter.jsonl",
    )
    args = parser.parse_args()

    logger = JsonlLogger(Path(args.log))
    server = AdapterServer(
        (args.host, args.port),
        Handler,
        upstream=args.upstream,
        target_model=args.target_model,
        timeout_seconds=args.timeout_seconds,
        logger=logger,
    )

    logger.write(
        "adapter_started",
        version=VERSION,
        host=args.host,
        port=args.port,
        upstream=args.upstream,
        target_model=args.target_model,
        proxy={
            "HTTP_PROXY": os.environ.get("HTTP_PROXY"),
            "HTTPS_PROXY": os.environ.get("HTTPS_PROXY"),
            "ALL_PROXY": os.environ.get("ALL_PROXY"),
            "NO_PROXY": os.environ.get("NO_PROXY"),
        },
    )

    print(
        f"Grok Build search adapter v{VERSION} listening at "
        f"http://{args.host}:{args.port}",
        flush=True,
    )
    print(f"Target model: {args.target_model}", flush=True)

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        logger.write("adapter_stopped")
        server.server_close()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
