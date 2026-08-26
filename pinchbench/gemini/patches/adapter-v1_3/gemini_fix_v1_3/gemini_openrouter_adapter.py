#!/usr/bin/env python3
from __future__ import annotations

import argparse
import base64
import datetime as dt
import hashlib
import json
import os
import re
import signal
import ssl
import sys
import threading
import time
import traceback
import urllib.error
import urllib.parse
import urllib.request
import uuid
from collections import defaultdict, deque
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Iterable, Iterator, Optional


VERSION = "1.3.0"
DEFAULT_MODEL = "deepseek/deepseek-v4-pro"
DEFAULT_UPSTREAM = "https://openrouter.ai/api/v1/responses"
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8766

MODEL_PATH_RE = re.compile(
    r"^/(?P<api>v1beta|v1)/models/(?P<model>.+):"
    r"(?P<method>streamGenerateContent|generateContent|countTokens)$"
)


def utc_now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


def compact_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def json_copy(value: Any) -> Any:
    return json.loads(json.dumps(value, ensure_ascii=False))


def env_bool(name: str, default: bool = False) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def env_int(name: str, default: Optional[int] = None) -> Optional[int]:
    raw = os.environ.get(name)
    if raw is None or not raw.strip():
        return default
    return int(raw)


def env_float(name: str, default: float) -> float:
    raw = os.environ.get(name)
    if raw is None or not raw.strip():
        return default
    return float(raw)


CLIENT_DISCONNECT_ERRORS = (
    BrokenPipeError,
    ConnectionResetError,
    ConnectionAbortedError,
)


def safe_error_text(raw: bytes, limit: int = 8000) -> str:
    text = raw.decode("utf-8", errors="replace")
    return text[:limit]


def sanitize_for_log(value: Any, max_string: int = 500) -> Any:
    sensitive_keys = {
        "authorization",
        "proxy-authorization",
        "x-goog-api-key",
        "api_key",
        "apikey",
        "token",
        "access_token",
        "refresh_token",
        "cookie",
        "set-cookie",
    }

    if isinstance(value, dict):
        output: dict[str, Any] = {}
        for key, child in value.items():
            if str(key).lower() in sensitive_keys:
                output[str(key)] = "<REDACTED_PRESENT>"
            else:
                output[str(key)] = sanitize_for_log(child, max_string)
        return output

    if isinstance(value, list):
        return [sanitize_for_log(item, max_string) for item in value]

    if isinstance(value, str):
        redacted = re.sub(
            r"sk-or-v1-[A-Za-z0-9_-]{20,}",
            "<REDACTED_OPENROUTER_KEY>",
            value,
        )
        redacted = re.sub(
            r"AIzaSy[A-Za-z0-9_-]{20,}",
            "<REDACTED_GEMINI_KEY>",
            redacted,
        )
        if len(redacted) > max_string:
            return redacted[:max_string] + f"...<truncated:{len(redacted)}>"
        return redacted

    return value


class JsonlLogger:
    def __init__(self, path: Path) -> None:
        self.path = path
        self.lock = threading.Lock()
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def write(self, record: dict[str, Any]) -> None:
        line = compact_json(sanitize_for_log(record))
        with self.lock:
            with self.path.open("a", encoding="utf-8", newline="\n") as handle:
                handle.write(line + "\n")


@dataclass
class AdapterConfig:
    host: str
    port: int
    model: str
    upstream_url: str
    timeout_seconds: int
    heartbeat_seconds: float
    log_dir: Path
    log_payloads: bool
    parallel_tool_calls: bool
    reasoning_mode: str
    max_output_tokens: Optional[int]
    web_search_engine: str
    web_search_max_results: int
    web_search_max_uses: int
    web_search_max_total_results: int
    web_search_context_size: str
    web_search_max_characters: int
    app_title: str
    app_url: str

    @classmethod
    def from_args(cls, args: argparse.Namespace) -> "AdapterConfig":
        log_dir = Path(
            args.log_dir
            or os.environ.get(
                "GEMINI_OPENROUTER_LOG_DIR",
                r"C:\pinchbench-gemini\logs\adapter-v1",
            )
        )
        return cls(
            host=args.host,
            port=args.port,
            model=os.environ.get("OPENROUTER_MODEL", args.model),
            upstream_url=os.environ.get(
                "OPENROUTER_RESPONSES_URL",
                args.upstream_url,
            ),
            timeout_seconds=int(
                os.environ.get("OPENROUTER_TIMEOUT_SECONDS", args.timeout)
            ),
            heartbeat_seconds=max(
                1.0,
                env_float(
                    "ADAPTER_HEARTBEAT_SECONDS",
                    args.heartbeat_seconds,
                ),
            ),
            log_dir=log_dir,
            log_payloads=env_bool("ADAPTER_LOG_PAYLOADS", False),
            parallel_tool_calls=env_bool(
                "ADAPTER_PARALLEL_TOOL_CALLS",
                True,
            ),
            reasoning_mode=os.environ.get(
                "ADAPTER_REASONING_MODE",
                "auto",
            ).strip().lower(),
            max_output_tokens=env_int(
                "ADAPTER_MAX_OUTPUT_TOKENS",
                32768,
            ),
            web_search_engine=os.environ.get(
                "ADAPTER_WEB_SEARCH_ENGINE",
                "exa",
            ).strip().lower(),
            web_search_max_results=max(
                1,
                env_int("ADAPTER_WEB_SEARCH_MAX_RESULTS", 5) or 5,
            ),
            web_search_max_uses=max(
                1,
                env_int("ADAPTER_WEB_SEARCH_MAX_USES", 1) or 1,
            ),
            web_search_max_total_results=max(
                1,
                env_int("ADAPTER_WEB_SEARCH_MAX_TOTAL_RESULTS", 5) or 5,
            ),
            web_search_context_size=os.environ.get(
                "ADAPTER_WEB_SEARCH_CONTEXT_SIZE",
                "low",
            ).strip().lower(),
            web_search_max_characters=max(
                500,
                env_int("ADAPTER_WEB_SEARCH_MAX_CHARACTERS", 3000) or 3000,
            ),
            app_title=os.environ.get(
                "OPENROUTER_APP_TITLE",
                "PinchBench Gemini CLI Adapter",
            ),
            app_url=os.environ.get(
                "OPENROUTER_APP_URL",
                "http://127.0.0.1",
            ),
        )


@dataclass
class TranslationResult:
    payload: dict[str, Any]
    requested_model: str
    tool_names: list[str]
    content_count: int
    ignored_generation_fields: list[str] = field(default_factory=list)
    call_count: int = 0
    response_count: int = 0


@dataclass
class UpstreamAggregate:
    response_id: str = ""
    model: str = ""
    provider: str = ""
    text: str = ""
    function_calls: list[dict[str, Any]] = field(default_factory=list)
    usage: dict[str, Any] = field(default_factory=dict)
    finish_reason: str = "STOP"
    event_counts: dict[str, int] = field(default_factory=lambda: defaultdict(int))
    completed_response: dict[str, Any] = field(default_factory=dict)
    raw_error: Optional[dict[str, Any]] = None


def flatten_text_parts(content: Any) -> str:
    if not isinstance(content, dict):
        return ""
    chunks: list[str] = []
    parts = content.get("parts")
    if not isinstance(parts, list):
        return ""
    for part in parts:
        if isinstance(part, dict) and isinstance(part.get("text"), str):
            chunks.append(part["text"])
    return "\n".join(chunks)


def normalize_schema(schema: Any) -> dict[str, Any]:
    if not isinstance(schema, dict):
        return {"type": "object", "properties": {}}

    allowed = {
        "type",
        "description",
        "properties",
        "required",
        "items",
        "enum",
        "anyOf",
        "oneOf",
        "allOf",
        "additionalProperties",
        "default",
        "minimum",
        "maximum",
        "exclusiveMinimum",
        "exclusiveMaximum",
        "minLength",
        "maxLength",
        "minItems",
        "maxItems",
        "pattern",
        "format",
        "nullable",
    }

    output: dict[str, Any] = {}
    for key, value in schema.items():
        if key not in allowed:
            continue
        if key == "properties" and isinstance(value, dict):
            output[key] = {
                str(name): normalize_schema(child)
                for name, child in value.items()
            }
        elif key == "items":
            output[key] = normalize_schema(value)
        elif key in {"anyOf", "oneOf", "allOf"} and isinstance(value, list):
            output[key] = [normalize_schema(item) for item in value]
        else:
            output[key] = json_copy(value)

    if not output:
        return {"type": "object", "properties": {}}

    if "type" not in output and "properties" in output:
        output["type"] = "object"

    if output.get("type") == "object":
        output.setdefault("properties", {})

    return output


def translate_tools(
    gemini_tools: Any,
    config: AdapterConfig,
) -> tuple[list[dict[str, Any]], list[str]]:
    translated: list[dict[str, Any]] = []
    names: list[str] = []

    if not isinstance(gemini_tools, list):
        return translated, names

    for tool_block in gemini_tools:
        if not isinstance(tool_block, dict):
            continue

        # Gemini CLI's built-in google_web_search tool performs an internal
        # generateContent request containing a native Gemini googleSearch
        # declaration. OpenRouter does not understand that declaration, so map
        # it to OpenRouter's server-side web-search tool. This keeps the search
        # request real and grounded instead of silently dropping the capability.
        if any(
            key in tool_block
            for key in (
                "googleSearch",
                "google_search",
                "googleSearchRetrieval",
                "google_search_retrieval",
            )
        ):
            translated.append(
                {
                    "type": "openrouter:web_search",
                    "parameters": {
                        "engine": config.web_search_engine,
                        "max_results": config.web_search_max_results,
                        "max_uses": config.web_search_max_uses,
                        "max_total_results": (
                            config.web_search_max_total_results
                        ),
                        "search_context_size": (
                            config.web_search_context_size
                        ),
                        "max_characters": (
                            config.web_search_max_characters
                        ),
                    },
                }
            )
            names.append("openrouter:web_search")

        if any(
            key in tool_block
            for key in ("urlContext", "url_context")
        ):
            translated.append({"type": "openrouter:web_fetch"})
            names.append("openrouter:web_fetch")

        declarations = tool_block.get("functionDeclarations")
        if not isinstance(declarations, list):
            declarations = tool_block.get("function_declarations")
        if not isinstance(declarations, list):
            continue

        for declaration in declarations:
            if not isinstance(declaration, dict):
                continue
            name = declaration.get("name")
            if not isinstance(name, str) or not name:
                continue
            schema = (
                declaration.get("parametersJsonSchema")
                if declaration.get("parametersJsonSchema") is not None
                else declaration.get("parameters")
            )
            translated.append(
                {
                    "type": "function",
                    "name": name,
                    "description": str(declaration.get("description") or ""),
                    "strict": None,
                    "parameters": normalize_schema(schema),
                }
            )
            names.append(name)

    return translated, names


def deterministic_call_id(
    name: str,
    args: Any,
    index: int,
) -> str:
    raw = compact_json(
        {
            "name": name,
            "args": args,
            "index": index,
        }
    ).encode("utf-8")
    return "call_" + hashlib.sha256(raw).hexdigest()[:24]


def response_output_to_string(value: Any) -> str:
    if isinstance(value, str):
        return value
    return compact_json(value)


def part_fallback_text(part: dict[str, Any]) -> str:
    safe = {
        key: value
        for key, value in part.items()
        if key not in {"thoughtSignature"}
    }
    return "[Gemini non-text part]\n" + compact_json(safe)


def translate_contents(contents: Any) -> tuple[list[dict[str, Any]], int, int]:
    items: list[dict[str, Any]] = []
    pending_calls: dict[str, deque[str]] = defaultdict(deque)
    all_pending: deque[tuple[str, str]] = deque()
    call_count = 0
    response_count = 0

    if not isinstance(contents, list):
        return items, call_count, response_count

    for content_index, content in enumerate(contents):
        if not isinstance(content, dict):
            continue

        role = str(content.get("role") or "user").lower()
        parts = content.get("parts")
        if not isinstance(parts, list):
            continue

        text_buffer: list[str] = []

        def flush_text() -> None:
            nonlocal text_buffer
            if not text_buffer:
                return
            text = "\n".join(text_buffer)
            text_buffer = []
            if role == "model":
                items.append(
                    {
                        "type": "message",
                        "role": "assistant",
                        "status": "completed",
                        "content": [
                            {
                                "type": "output_text",
                                "text": text,
                                "annotations": [],
                            }
                        ],
                    }
                )
            else:
                items.append(
                    {
                        "type": "message",
                        "role": "user",
                        "content": [
                            {
                                "type": "input_text",
                                "text": text,
                            }
                        ],
                    }
                )

        for part_index, part in enumerate(parts):
            if not isinstance(part, dict):
                continue

            if isinstance(part.get("text"), str):
                text_buffer.append(part["text"])
                continue

            function_call = part.get("functionCall")
            if function_call is None:
                function_call = part.get("function_call")

            if isinstance(function_call, dict):
                flush_text()
                name = str(function_call.get("name") or "")
                args = function_call.get("args")
                if args is None:
                    args = function_call.get("arguments")
                if args is None:
                    args = {}
                call_id = str(
                    function_call.get("id")
                    or part.get("id")
                    or deterministic_call_id(
                        name,
                        args,
                        content_index * 1000 + part_index,
                    )
                )
                fc_id = "fc_" + hashlib.sha256(
                    call_id.encode("utf-8")
                ).hexdigest()[:24]
                items.append(
                    {
                        "type": "function_call",
                        "id": fc_id,
                        "call_id": call_id,
                        "name": name,
                        "arguments": (
                            args
                            if isinstance(args, str)
                            else compact_json(args)
                        ),
                    }
                )
                pending_calls[name].append(call_id)
                all_pending.append((name, call_id))
                call_count += 1
                continue

            function_response = part.get("functionResponse")
            if function_response is None:
                function_response = part.get("function_response")

            if isinstance(function_response, dict):
                flush_text()
                name = str(function_response.get("name") or "")
                call_id = str(
                    function_response.get("id")
                    or part.get("id")
                    or ""
                )

                if not call_id and pending_calls.get(name):
                    call_id = pending_calls[name].popleft()

                if not call_id and all_pending:
                    _, call_id = all_pending.popleft()

                if not call_id:
                    call_id = deterministic_call_id(
                        name,
                        function_response,
                        content_index * 1000 + part_index,
                    )

                response_value = function_response.get("response")
                if response_value is None:
                    response_value = {
                        key: value
                        for key, value in function_response.items()
                        if key not in {"id", "name"}
                    }

                items.append(
                    {
                        "type": "function_call_output",
                        "call_id": call_id,
                        "output": response_output_to_string(response_value),
                    }
                )
                response_count += 1
                continue

            if "inlineData" in part or "fileData" in part:
                text_buffer.append(part_fallback_text(part))
                continue

            if part:
                text_buffer.append(part_fallback_text(part))

        flush_text()

    return items, call_count, response_count


def generation_config_to_openrouter(
    generation_config: Any,
    config: AdapterConfig,
) -> tuple[dict[str, Any], list[str]]:
    output: dict[str, Any] = {}
    ignored: list[str] = []

    if not isinstance(generation_config, dict):
        generation_config = {}

    mapping = {
        "temperature": "temperature",
        "topP": "top_p",
        "maxOutputTokens": "max_output_tokens",
        "stopSequences": "stop",
        "presencePenalty": "presence_penalty",
        "frequencyPenalty": "frequency_penalty",
        "seed": "seed",
    }

    for source, target in mapping.items():
        if generation_config.get(source) is not None:
            output[target] = json_copy(generation_config[source])

    for key in generation_config:
        if key not in mapping and key != "thinkingConfig":
            ignored.append(key)

    if config.max_output_tokens is not None:
        output["max_output_tokens"] = config.max_output_tokens

    thinking = generation_config.get("thinkingConfig")
    if isinstance(thinking, dict):
        if config.reasoning_mode == "enabled":
            output["reasoning"] = {
                "enabled": True,
                "exclude": True,
            }
        elif config.reasoning_mode == "disabled":
            output["reasoning"] = {
                "effort": "none",
            }
        elif config.reasoning_mode == "auto":
            # Preserve provider/model defaults. includeThoughts controls display
            # in Gemini, not necessarily whether the model reasons.
            pass
        else:
            ignored.append("thinkingConfig")

    return output, ignored


def translate_request(
    request_body: dict[str, Any],
    requested_model: str,
    config: AdapterConfig,
) -> TranslationResult:
    items, call_count, response_count = translate_contents(
        request_body.get("contents")
    )
    translated_tools, tool_names = translate_tools(
        request_body.get("tools"),
        config,
    )
    generation, ignored = generation_config_to_openrouter(
        request_body.get("generationConfig"),
        config,
    )

    system_text = flatten_text_parts(
        request_body.get("systemInstruction")
        or request_body.get("system_instruction")
    )

    payload: dict[str, Any] = {
        "model": config.model,
        "input": items,
        "stream": True,
    }

    if system_text:
        payload["instructions"] = system_text

    if translated_tools:
        payload["tools"] = translated_tools
        payload["tool_choice"] = "auto"
        payload["parallel_tool_calls"] = config.parallel_tool_calls
        if any(
            str(tool.get("type") or "").startswith("openrouter:")
            for tool in translated_tools
            if isinstance(tool, dict)
        ):
            # A Gemini CLI web-search invocation asks one focused question.
            # Bound OpenRouter's internal server-tool loop so one search cannot
            # consume most of the task's 300-second execution budget.
            payload["max_tool_calls"] = max(
                config.web_search_max_uses,
                1,
            )

    payload.update(generation)

    return TranslationResult(
        payload=payload,
        requested_model=requested_model,
        tool_names=tool_names,
        content_count=len(
            request_body.get("contents")
            if isinstance(request_body.get("contents"), list)
            else []
        ),
        ignored_generation_fields=ignored,
        call_count=call_count,
        response_count=response_count,
    )


def json_object_or_none(raw: Any) -> Optional[dict[str, Any]]:
    if isinstance(raw, dict):
        return raw
    if raw is None:
        return None
    text = str(raw).strip()
    if not text:
        return None
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        return None
    return parsed if isinstance(parsed, dict) else None


def merge_argument_text(existing: Any, candidate: Any) -> str:
    """Reconcile streamed and terminal function-call arguments safely.

    Some Responses providers emit complete argument deltas but a shorter or
    truncated `arguments` value in the terminal item. Never replace a complete
    accumulated JSON object with a malformed shorter terminal copy.
    """
    old = str(existing or "")
    new = str(candidate or "")
    if not old:
        return new
    if not new:
        return old

    old_valid = json_object_or_none(old) is not None
    new_valid = json_object_or_none(new) is not None
    if old_valid and not new_valid:
        return old
    if new_valid and not old_valid:
        return new
    if old_valid and new_valid:
        return new

    if new.startswith(old):
        return new
    if old.startswith(new):
        return old
    return new if len(new) >= len(old) else old


def parse_json_arguments(raw: Any) -> dict[str, Any]:
    if isinstance(raw, dict):
        return raw
    if raw is None:
        return {}
    text = str(raw).strip()
    if not text:
        return {}

    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)

    try:
        parsed = json.loads(text)
        if isinstance(parsed, dict):
            return parsed
        return {"value": parsed}
    except json.JSONDecodeError:
        return {"_raw_arguments": text}


def malformed_function_calls(
    aggregate: UpstreamAggregate,
) -> list[dict[str, Any]]:
    malformed: list[dict[str, Any]] = []
    for call in aggregate.function_calls:
        args = call.get("args")
        if isinstance(args, dict) and set(args) == {"_raw_arguments"}:
            raw = str(args.get("_raw_arguments") or "")
            malformed.append(
                {
                    "id": str(call.get("id") or ""),
                    "name": str(call.get("name") or ""),
                    "argument_length": len(raw),
                }
            )
    return malformed


def map_finish_reason(status: str, incomplete_details: Any = None) -> str:
    status_lower = (status or "").lower()
    reason = ""
    if isinstance(incomplete_details, dict):
        reason = str(incomplete_details.get("reason") or "").lower()

    if "max" in reason or "token" in reason:
        return "MAX_TOKENS"
    if status_lower in {"failed", "cancelled", "incomplete"}:
        return "OTHER"
    return "STOP"


def extract_completed_output(
    response: dict[str, Any],
    aggregate: UpstreamAggregate,
) -> None:
    aggregate.completed_response = response
    aggregate.response_id = str(
        response.get("id") or aggregate.response_id
    )
    aggregate.model = str(
        response.get("model") or aggregate.model
    )
    aggregate.provider = str(
        response.get("provider") or aggregate.provider
    )
    aggregate.usage = (
        response.get("usage")
        if isinstance(response.get("usage"), dict)
        else aggregate.usage
    )
    aggregate.finish_reason = map_finish_reason(
        str(response.get("status") or ""),
        response.get("incomplete_details"),
    )

    output = response.get("output")
    if not isinstance(output, list):
        return

    completed_text: list[str] = []
    completed_calls: list[dict[str, Any]] = []

    for item in output:
        if not isinstance(item, dict):
            continue
        item_type = item.get("type")
        if item_type == "message":
            content = item.get("content")
            if isinstance(content, list):
                for part in content:
                    if (
                        isinstance(part, dict)
                        and part.get("type") in {
                            "output_text",
                            "text",
                        }
                        and isinstance(part.get("text"), str)
                    ):
                        completed_text.append(part["text"])
        elif item_type == "function_call":
            completed_calls.append(
                {
                    "id": str(
                        item.get("call_id")
                        or item.get("id")
                        or uuid.uuid4()
                    ),
                    "name": str(item.get("name") or ""),
                    "args": parse_json_arguments(
                        item.get("arguments")
                    ),
                }
            )

    if not aggregate.text and completed_text:
        aggregate.text = "".join(completed_text)

    if not aggregate.function_calls and completed_calls:
        aggregate.function_calls = completed_calls


def parse_openrouter_sse(
    lines: Iterable[bytes],
    on_text_delta: Optional[callable] = None,
    on_keepalive: Optional[callable] = None,
) -> UpstreamAggregate:
    aggregate = UpstreamAggregate()
    call_state: dict[str, dict[str, Any]] = {}
    call_aliases: dict[str, str] = {}
    latest_call_key: Optional[str] = None

    def register_call(item: dict[str, Any], fallback: Any = None) -> str:
        nonlocal latest_call_key
        item_id = str(item.get("id") or "")
        call_id = str(item.get("call_id") or "")
        canonical = item_id or call_id or str(fallback or uuid.uuid4())
        existing = call_state.get(canonical, {})
        candidate_arguments = (
            item.get("arguments")
            if item.get("arguments") is not None
            else ""
        )
        call_state[canonical] = {
            "id": call_id or existing.get("id") or item_id or canonical,
            "name": str(item.get("name") or existing.get("name") or ""),
            "arguments": merge_argument_text(
                existing.get("arguments") or "",
                candidate_arguments,
            ),
            "done": bool(existing.get("done", False)),
        }
        for alias in (canonical, item_id, call_id):
            if alias:
                call_aliases[alias] = canonical
        latest_call_key = canonical
        return canonical

    def resolve_call_key(event: dict[str, Any]) -> str:
        candidate = str(
            event.get("item_id")
            or event.get("call_id")
            or latest_call_key
            or ""
        )
        return call_aliases.get(candidate, candidate)

    for raw_line in lines:
        if on_keepalive is not None:
            on_keepalive()

        line = raw_line.decode("utf-8", errors="replace").strip()
        if not line or line.startswith(":"):
            continue
        if not line.startswith("data:"):
            continue

        data = line[5:].strip()
        if data == "[DONE]":
            break

        try:
            event = json.loads(data)
        except json.JSONDecodeError:
            continue

        event_type = str(event.get("type") or "")
        aggregate.event_counts[event_type] += 1

        if event_type == "response.created":
            response = event.get("response")
            if isinstance(response, dict):
                aggregate.response_id = str(
                    response.get("id") or aggregate.response_id
                )
                aggregate.model = str(
                    response.get("model") or aggregate.model
                )
            continue

        if event_type == "response.output_text.delta":
            delta = event.get("delta")
            if isinstance(delta, str):
                aggregate.text += delta
                if on_text_delta is not None:
                    on_text_delta(delta)
            continue

        if event_type == "response.output_item.added":
            item = event.get("item")
            if isinstance(item, dict) and item.get("type") == "function_call":
                register_call(item, event.get("output_index"))
            continue

        if event_type == "response.function_call_arguments.delta":
            key = resolve_call_key(event)
            if not key:
                key = str(uuid.uuid4())
            if key not in call_state:
                key = register_call(
                    {
                        "id": event.get("item_id"),
                        "call_id": event.get("call_id"),
                        "name": event.get("name"),
                        "arguments": "",
                    }
                )
            delta = event.get("delta")
            if isinstance(delta, str):
                call_state[key]["arguments"] += delta
            latest_call_key = key
            continue

        if event_type == "response.function_call_arguments.done":
            key = resolve_call_key(event)
            if not key:
                key = str(uuid.uuid4())
            if key not in call_state:
                key = register_call(
                    {
                        "id": event.get("item_id"),
                        "call_id": event.get("call_id"),
                        "name": event.get("name"),
                        "arguments": "",
                    }
                )
            if isinstance(event.get("arguments"), str):
                call_state[key]["arguments"] = merge_argument_text(
                    call_state[key].get("arguments") or "",
                    event["arguments"],
                )
            if event.get("name"):
                call_state[key]["name"] = str(event["name"])
            call_state[key]["done"] = True
            latest_call_key = key
            continue

        if event_type == "response.output_item.done":
            item = event.get("item")
            if isinstance(item, dict) and item.get("type") == "function_call":
                key = register_call(item, event.get("output_index"))
                call_state[key]["done"] = True
            continue

        if event_type == "response.completed":
            response = event.get("response")
            if isinstance(response, dict):
                extract_completed_output(response, aggregate)
            continue

        if event_type in {"response.failed", "error"}:
            error_value = event.get("error")
            if isinstance(error_value, dict):
                aggregate.raw_error = error_value
            else:
                aggregate.raw_error = {
                    "message": str(error_value or event)
                }

    if call_state:
        aggregate.function_calls = []
        seen_call_ids: set[str] = set()
        for state in call_state.values():
            call_id = str(state["id"])
            if call_id in seen_call_ids:
                continue
            seen_call_ids.add(call_id)
            aggregate.function_calls.append(
                {
                    "id": call_id,
                    "name": state["name"],
                    "args": parse_json_arguments(
                        state["arguments"]
                    ),
                }
            )

    return aggregate

def usage_to_gemini(usage: Any) -> dict[str, int]:
    if not isinstance(usage, dict):
        return {
            "promptTokenCount": 0,
            "candidatesTokenCount": 0,
            "totalTokenCount": 0,
        }

    input_tokens = int(
        usage.get("input_tokens")
        or usage.get("prompt_tokens")
        or 0
    )
    output_tokens = int(
        usage.get("output_tokens")
        or usage.get("completion_tokens")
        or 0
    )
    total_tokens = int(
        usage.get("total_tokens")
        or input_tokens + output_tokens
    )
    details = usage.get("output_tokens_details")
    thoughts = 0
    if isinstance(details, dict):
        thoughts = int(
            details.get("reasoning_tokens")
            or details.get("reasoning")
            or 0
        )

    result = {
        "promptTokenCount": input_tokens,
        "candidatesTokenCount": output_tokens,
        "totalTokenCount": total_tokens,
    }
    if thoughts:
        result["thoughtsTokenCount"] = thoughts
    return result


def build_gemini_response(
    aggregate: UpstreamAggregate,
    include_text: bool = True,
    include_calls: bool = True,
    include_finish: bool = True,
) -> dict[str, Any]:
    parts: list[dict[str, Any]] = []

    if include_text and aggregate.text:
        parts.append({"text": aggregate.text})

    if include_calls:
        for call in aggregate.function_calls:
            parts.append(
                {
                    "functionCall": {
                        "id": call["id"],
                        "name": call["name"],
                        "args": call["args"],
                    }
                }
            )

    candidate: dict[str, Any] = {
        "content": {
            "role": "model",
            "parts": parts,
        },
        "index": 0,
    }
    if include_finish:
        candidate["finishReason"] = aggregate.finish_reason

    return {
        "candidates": [candidate],
        "usageMetadata": usage_to_gemini(aggregate.usage),
        "modelVersion": aggregate.model or "openrouter-adapter",
        "responseId": aggregate.response_id or str(uuid.uuid4()),
    }


def approximate_token_count(body: dict[str, Any]) -> int:
    text = compact_json(body)
    # Conservative character-based estimate. The adapter logs that this is
    # approximate; generation usage comes from OpenRouter.
    return max(1, (len(text) + 2) // 3)


class AdapterRuntime:
    def __init__(self, config: AdapterConfig) -> None:
        self.config = config
        self.request_log = JsonlLogger(
            config.log_dir / "adapter_requests.jsonl"
        )
        self.event_log = JsonlLogger(
            config.log_dir / "adapter_upstream_events.jsonl"
        )
        self.started_at = utc_now()
        self.api_key_present = bool(
            os.environ.get("OPENROUTER_API_KEY", "").strip()
        )

    def upstream_opener(self) -> urllib.request.OpenerDirector:
        proxy_map: dict[str, str] = {}
        for scheme, name in (
            ("http", "HTTP_PROXY"),
            ("https", "HTTPS_PROXY"),
        ):
            value = os.environ.get(name) or os.environ.get(name.lower())
            if value:
                proxy_map[scheme] = value
        handlers: list[Any] = []
        if proxy_map:
            handlers.append(urllib.request.ProxyHandler(proxy_map))
        context = ssl.create_default_context()
        handlers.append(urllib.request.HTTPSHandler(context=context))
        return urllib.request.build_opener(*handlers)

    def call_openrouter(
        self,
        payload: dict[str, Any],
        request_id: str,
    ) -> tuple[Any, dict[str, str]]:
        api_key = os.environ.get("OPENROUTER_API_KEY", "").strip()
        if not api_key:
            raise RuntimeError(
                "OPENROUTER_API_KEY is missing in the adapter process."
            )

        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "Accept": "text/event-stream",
            "HTTP-Referer": self.config.app_url,
            "X-Title": self.config.app_title,
            "X-OpenRouter-Metadata": "enabled",
            "User-Agent": f"pinchbench-gemini-adapter/{VERSION}",
            "X-Adapter-Request-Id": request_id,
        }

        request = urllib.request.Request(
            self.config.upstream_url,
            data=compact_json(payload).encode("utf-8"),
            headers=headers,
            method="POST",
        )
        response = self.upstream_opener().open(
            request,
            timeout=self.config.timeout_seconds,
        )
        response_headers = {
            key.lower(): value
            for key, value in response.headers.items()
        }
        return response, response_headers


class AdapterHandler(BaseHTTPRequestHandler):
    server_version = f"GeminiOpenRouterAdapter/{VERSION}"
    protocol_version = "HTTP/1.1"

    @property
    def runtime(self) -> AdapterRuntime:
        return self.server.runtime  # type: ignore[attr-defined]

    def log_message(self, fmt: str, *args: Any) -> None:
        return

    def read_json_body(self) -> tuple[bytes, dict[str, Any]]:
        length_text = self.headers.get("Content-Length", "0")
        try:
            length = int(length_text)
        except ValueError:
            length = 0

        raw = self.rfile.read(length) if length > 0 else b""
        if not raw:
            return raw, {}

        try:
            body = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ValueError(f"Invalid UTF-8 JSON request: {exc}") from exc

        if not isinstance(body, dict):
            raise ValueError("Request body must be a JSON object.")

        return raw, body

    def send_json(
        self,
        status: int,
        payload: dict[str, Any],
        request_id: Optional[str] = None,
    ) -> None:
        data = json.dumps(
            payload,
            ensure_ascii=False,
        ).encode("utf-8")
        try:
            self.send_response(status)
            self.send_header(
                "Content-Type",
                "application/json; charset=utf-8",
            )
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Connection", "close")
            if request_id:
                self.send_header("X-Adapter-Request-Id", request_id)
            self.end_headers()
            self.wfile.write(data)
            self.wfile.flush()
        except CLIENT_DISCONNECT_ERRORS:
            pass
        self.close_connection = True

    def begin_sse(self, request_id: str) -> bool:
        try:
            self.send_response(200)
            self.send_header(
                "Content-Type",
                "text/event-stream; charset=utf-8",
            )
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Connection", "close")
            self.send_header("X-Accel-Buffering", "no")
            self.send_header("X-Adapter-Request-Id", request_id)
            self.end_headers()
        except CLIENT_DISCONNECT_ERRORS:
            self.close_connection = True
            return False
        return True

    def send_sse_json(self, payload: dict[str, Any]) -> None:
        data = json.dumps(payload, ensure_ascii=False)
        self.wfile.write(f"data: {data}\n\n".encode("utf-8"))
        self.wfile.flush()

    def send_sse_buffered(
        self,
        payload: dict[str, Any],
        request_id: str,
    ) -> None:
        """Compatibility helper retained for diagnostics."""
        data = json.dumps(payload, ensure_ascii=False)
        body = f"data: {data}\n\n".encode("utf-8")
        self.send_response(200)
        self.send_header(
            "Content-Type",
            "text/event-stream; charset=utf-8",
        )
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Connection", "close")
        self.send_header("X-Accel-Buffering", "no")
        self.send_header("X-Adapter-Request-Id", request_id)
        self.end_headers()
        try:
            self.wfile.write(body)
            self.wfile.flush()
        except CLIENT_DISCONNECT_ERRORS:
            pass
        self.close_connection = True

    def heartbeat_payload(
        self,
        request_id: str,
    ) -> dict[str, Any]:
        # Use a valid Gemini JSON event, never an SSE comment.
        return {
            "candidates": [
                {
                    "content": {
                        "role": "model",
                        "parts": [],
                    },
                    "index": 0,
                }
            ],
            "modelVersion": self.runtime.config.model,
            "responseId": request_id,
        }

    def safe_sse_error(
        self,
        code: int,
        message: str,
        status: str = "INTERNAL",
    ) -> None:
        try:
            self.send_sse_json(
                {
                    "error": {
                        "code": code,
                        "message": message,
                        "status": status,
                    }
                }
            )
        except CLIENT_DISCONNECT_ERRORS:
            pass

    def do_GET(self) -> None:
        request_id = str(uuid.uuid4())
        split = urllib.parse.urlsplit(self.path)
        path = split.path

        if path in {"/healthz", "/readyz"}:
            self.send_json(
                200,
                {
                    "ok": True,
                    "ready": self.runtime.api_key_present,
                    "service": "gemini-openrouter-adapter",
                    "version": VERSION,
                    "startedAt": self.runtime.started_at,
                    "forcedModel": self.runtime.config.model,
                    "upstream": self.runtime.config.upstream_url,
                    "apiKeyPresent": self.runtime.api_key_present,
                    "heartbeatSeconds": (
                        self.runtime.config.heartbeat_seconds
                    ),
                    "responseMode": "heartbeat_stream",
                    "maxOutputTokens": (
                        self.runtime.config.max_output_tokens
                    ),
                    "nativeWebSearchBridge": True,
                    "webSearchEngine": (
                        self.runtime.config.web_search_engine
                    ),
                },
                request_id,
            )
            return

        if path.endswith("/models"):
            model = self.runtime.config.model
            self.send_json(
                200,
                {
                    "models": [
                        {
                            "name": f"models/{model}",
                            "baseModelId": model,
                            "version": "openrouter-adapter-v1",
                            "displayName": model,
                            "description": (
                                "Gemini CLI compatibility adapter backed "
                                "by OpenRouter Responses API."
                            ),
                            "inputTokenLimit": 1048576,
                            "outputTokenLimit": 65536,
                            "supportedGenerationMethods": [
                                "generateContent",
                                "countTokens",
                            ],
                        }
                    ]
                },
                request_id,
            )
            return

        if "/models/" in path:
            model = urllib.parse.unquote(
                path.split("/models/", 1)[1]
            )
            self.send_json(
                200,
                {
                    "name": f"models/{model}",
                    "baseModelId": model,
                    "version": "openrouter-adapter-v1",
                    "displayName": model,
                    "description": (
                        "Gemini CLI compatibility adapter backed "
                        "by OpenRouter Responses API."
                    ),
                    "inputTokenLimit": 1048576,
                    "outputTokenLimit": 65536,
                    "supportedGenerationMethods": [
                        "generateContent",
                        "countTokens",
                    ],
                },
                request_id,
            )
            return

        self.send_json(
            404,
            {
                "error": {
                    "code": 404,
                    "message": f"Endpoint not implemented: {path}",
                    "status": "NOT_FOUND",
                }
            },
            request_id,
        )

    def do_POST(self) -> None:
        request_id = str(uuid.uuid4())
        started = time.monotonic()
        split = urllib.parse.urlsplit(self.path)
        match = MODEL_PATH_RE.match(split.path)

        if not match:
            self.send_json(
                404,
                {
                    "error": {
                        "code": 404,
                        "message": (
                            "Expected /v1beta/models/<model>:"
                            "streamGenerateContent, generateContent, "
                            "or countTokens."
                        ),
                        "status": "NOT_FOUND",
                    }
                },
                request_id,
            )
            return

        requested_model = urllib.parse.unquote(match.group("model"))
        method = match.group("method")

        try:
            raw, body = self.read_json_body()
        except ValueError as exc:
            self.send_json(
                400,
                {
                    "error": {
                        "code": 400,
                        "message": str(exc),
                        "status": "INVALID_ARGUMENT",
                    }
                },
                request_id,
            )
            return

        if method == "countTokens":
            count = approximate_token_count(body)
            self.runtime.request_log.write(
                {
                    "timestamp": utc_now(),
                    "request_id": request_id,
                    "method": method,
                    "requested_model": requested_model,
                    "forced_model": self.runtime.config.model,
                    "body_length": len(raw),
                    "approximate_token_count": count,
                    "duration_ms": int(
                        (time.monotonic() - started) * 1000
                    ),
                }
            )
            self.send_json(
                200,
                {
                    "totalTokens": count,
                    "promptTokensDetails": [
                        {
                            "modality": "TEXT",
                            "tokenCount": count,
                        }
                    ],
                },
                request_id,
            )
            return

        try:
            translation = translate_request(
                body,
                requested_model,
                self.runtime.config,
            )
        except Exception as exc:
            self.runtime.request_log.write(
                {
                    "timestamp": utc_now(),
                    "request_id": request_id,
                    "phase": "translate",
                    "error": str(exc),
                    "traceback": traceback.format_exc(),
                }
            )
            self.send_json(
                400,
                {
                    "error": {
                        "code": 400,
                        "message": f"Request translation failed: {exc}",
                        "status": "INVALID_ARGUMENT",
                    }
                },
                request_id,
            )
            return

        request_record: dict[str, Any] = {
            "timestamp": utc_now(),
            "request_id": request_id,
            "method": method,
            "requested_model": requested_model,
            "forced_model": self.runtime.config.model,
            "body_length": len(raw),
            "content_count": translation.content_count,
            "tool_count": len(translation.tool_names),
            "tool_names": translation.tool_names,
            "history_function_calls": translation.call_count,
            "history_function_responses": translation.response_count,
            "ignored_generation_fields": (
                translation.ignored_generation_fields
            ),
            "stream_requested": method == "streamGenerateContent",
        }
        if self.runtime.config.log_payloads:
            request_record["translated_payload"] = translation.payload
        self.runtime.request_log.write(request_record)

        try:
            upstream, upstream_headers = self.runtime.call_openrouter(
                translation.payload,
                request_id,
            )
        except urllib.error.HTTPError as exc:
            raw_error = exc.read()
            message = safe_error_text(raw_error)
            self.runtime.request_log.write(
                {
                    "timestamp": utc_now(),
                    "request_id": request_id,
                    "phase": "upstream_http",
                    "status": exc.code,
                    "error": message,
                    "duration_ms": int(
                        (time.monotonic() - started) * 1000
                    ),
                }
            )
            self.send_json(
                int(exc.code),
                {
                    "error": {
                        "code": int(exc.code),
                        "message": message,
                        "status": "UPSTREAM_ERROR",
                    }
                },
                request_id,
            )
            return
        except Exception as exc:
            self.runtime.request_log.write(
                {
                    "timestamp": utc_now(),
                    "request_id": request_id,
                    "phase": "upstream_connect",
                    "error": str(exc),
                    "traceback": traceback.format_exc(),
                    "duration_ms": int(
                        (time.monotonic() - started) * 1000
                    ),
                }
            )
            self.send_json(
                502,
                {
                    "error": {
                        "code": 502,
                        "message": f"OpenRouter connection failed: {exc}",
                        "status": "UNAVAILABLE",
                    }
                },
                request_id,
            )
            return

        safe_headers = {
            key: value
            for key, value in upstream_headers.items()
            if key in {
                "content-type",
                "x-request-id",
                "x-openrouter-provider",
                "x-openrouter-model",
                "cf-ray",
            }
        }

        if method == "generateContent":
            # The adapter still requests an upstream stream, then aggregates it
            # into one normal Gemini response.
            try:
                aggregate = parse_openrouter_sse(
                    upstream,
                    on_text_delta=None,
                )
            finally:
                upstream.close()

            if aggregate.raw_error:
                self.send_json(
                    502,
                    {
                        "error": {
                            "code": 502,
                            "message": str(
                                aggregate.raw_error.get("message")
                                or aggregate.raw_error
                            ),
                            "status": "UPSTREAM_ERROR",
                        }
                    },
                    request_id,
                )
                return

            malformed_calls = malformed_function_calls(aggregate)
            if malformed_calls:
                self.runtime.request_log.write(
                    {
                        "timestamp": utc_now(),
                        "request_id": request_id,
                        "phase": "malformed_tool_arguments",
                        "duration_ms": int(
                            (time.monotonic() - started) * 1000
                        ),
                        "calls": malformed_calls,
                        "finish_reason": aggregate.finish_reason,
                    }
                )
                self.send_json(
                    502,
                    {
                        "error": {
                            "code": 502,
                            "message": (
                                "OpenRouter returned malformed or truncated "
                                "function-call arguments; retry the model call."
                            ),
                            "status": "UPSTREAM_ERROR",
                        }
                    },
                    request_id,
                )
                return

            response_payload = build_gemini_response(aggregate)
            self.runtime.request_log.write(
                {
                    "timestamp": utc_now(),
                    "request_id": request_id,
                    "phase": "completed",
                    "duration_ms": int(
                        (time.monotonic() - started) * 1000
                    ),
                    "upstream_headers": safe_headers,
                    "upstream_model": aggregate.model,
                    "upstream_provider": aggregate.provider,
                    "response_id": aggregate.response_id,
                    "usage": aggregate.usage,
                    "tool_call_count": len(
                        aggregate.function_calls
                    ),
                    "text_length": len(aggregate.text),
                    "event_counts": dict(
                        aggregate.event_counts
                    ),
                }
            )
            self.send_json(200, response_payload, request_id)
            return

        # Keep Gemini CLI's fetch alive without corrupting the SDK parser.
        # OpenRouter is consumed in a background thread. The client receives
        # complete JSON SSE heartbeat events, followed by one final event.
        if not self.begin_sse(request_id):
            self.runtime.request_log.write(
                {
                    "timestamp": utc_now(),
                    "request_id": request_id,
                    "phase": "client_disconnected_before_sse",
                    "duration_ms": int(
                        (time.monotonic() - started) * 1000
                    ),
                }
            )
            return

        state: dict[str, Any] = {
            "aggregate": None,
            "error": None,
            "traceback": None,
        }
        parse_done = threading.Event()

        def consume_upstream() -> None:
            try:
                state["aggregate"] = parse_openrouter_sse(upstream)
            except Exception as exc:
                state["error"] = exc
                state["traceback"] = traceback.format_exc()
            finally:
                parse_done.set()

        reader = threading.Thread(
            target=consume_upstream,
            name=f"openrouter-reader-{request_id[:8]}",
            daemon=True,
        )
        reader.start()

        heartbeat_count = 0
        client_disconnected = False
        disconnect_error = ""

        try:
            self.send_sse_json(self.heartbeat_payload(request_id))
            heartbeat_count += 1

            while not parse_done.wait(
                timeout=self.runtime.config.heartbeat_seconds
            ):
                self.send_sse_json(
                    self.heartbeat_payload(request_id)
                )
                heartbeat_count += 1
        except CLIENT_DISCONNECT_ERRORS as exc:
            client_disconnected = True
            disconnect_error = f"{type(exc).__name__}: {exc}"
        finally:
            if client_disconnected:
                try:
                    upstream.close()
                except Exception:
                    pass
                parse_done.wait(timeout=2.0)
            else:
                parse_done.wait()

        if client_disconnected:
            self.runtime.request_log.write(
                {
                    "timestamp": utc_now(),
                    "request_id": request_id,
                    "phase": "client_disconnected",
                    "duration_ms": int(
                        (time.monotonic() - started) * 1000
                    ),
                    "heartbeat_count": heartbeat_count,
                    "error": disconnect_error,
                    "upstream_cancel_requested": True,
                }
            )
            self.close_connection = True
            return

        try:
            upstream.close()
        except Exception:
            pass

        if state["error"] is not None:
            exc = state["error"]
            self.runtime.request_log.write(
                {
                    "timestamp": utc_now(),
                    "request_id": request_id,
                    "phase": "stream_parse",
                    "error": str(exc),
                    "traceback": state["traceback"],
                    "duration_ms": int(
                        (time.monotonic() - started) * 1000
                    ),
                    "heartbeat_count": heartbeat_count,
                }
            )
            self.safe_sse_error(
                502,
                f"OpenRouter stream failed: {exc}",
                "UNAVAILABLE",
            )
            self.close_connection = True
            return

        aggregate = state["aggregate"]
        if not isinstance(aggregate, UpstreamAggregate):
            self.safe_sse_error(
                502,
                "OpenRouter stream produced no aggregate.",
                "UNAVAILABLE",
            )
            self.close_connection = True
            return

        if aggregate.raw_error:
            self.safe_sse_error(
                502,
                str(
                    aggregate.raw_error.get("message")
                    or aggregate.raw_error
                ),
                "UPSTREAM_ERROR",
            )
            self.close_connection = True
            return

        malformed_calls = malformed_function_calls(aggregate)
        if malformed_calls:
            self.runtime.request_log.write(
                {
                    "timestamp": utc_now(),
                    "request_id": request_id,
                    "phase": "malformed_tool_arguments",
                    "duration_ms": int(
                        (time.monotonic() - started) * 1000
                    ),
                    "heartbeat_count": heartbeat_count,
                    "calls": malformed_calls,
                    "finish_reason": aggregate.finish_reason,
                }
            )
            self.safe_sse_error(
                502,
                (
                    "OpenRouter returned malformed or truncated "
                    "function-call arguments; retry the model call."
                ),
                "UPSTREAM_ERROR",
            )
            self.close_connection = True
            return

        response_payload = build_gemini_response(aggregate)
        try:
            self.send_sse_json(response_payload)
        except CLIENT_DISCONNECT_ERRORS as exc:
            self.runtime.request_log.write(
                {
                    "timestamp": utc_now(),
                    "request_id": request_id,
                    "phase": "client_disconnected",
                    "duration_ms": int(
                        (time.monotonic() - started) * 1000
                    ),
                    "heartbeat_count": heartbeat_count,
                    "error": f"{type(exc).__name__}: {exc}",
                    "upstream_cancel_requested": False,
                    "upstream_already_completed": True,
                }
            )
            self.close_connection = True
            return

        self.runtime.request_log.write(
            {
                "timestamp": utc_now(),
                "request_id": request_id,
                "phase": "completed",
                "duration_ms": int(
                    (time.monotonic() - started) * 1000
                ),
                "response_mode": "heartbeat_stream",
                "heartbeat_count": heartbeat_count,
                "heartbeat_seconds": (
                    self.runtime.config.heartbeat_seconds
                ),
                "upstream_headers": safe_headers,
                "upstream_model": aggregate.model,
                "upstream_provider": aggregate.provider,
                "response_id": aggregate.response_id,
                "usage": aggregate.usage,
                "tool_call_count": len(
                    aggregate.function_calls
                ),
                "text_length": len(aggregate.text),
                "streamed_text": False,
                "event_counts": dict(
                    aggregate.event_counts
                ),
                "finish_reason": aggregate.finish_reason,
            }
        )
        self.close_connection = True


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Local Gemini generateContent compatibility adapter backed "
            "by OpenRouter Responses API."
        )
    )
    parser.add_argument("--host", default=DEFAULT_HOST)
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--upstream-url", default=DEFAULT_UPSTREAM)
    parser.add_argument("--timeout", type=int, default=360)
    parser.add_argument(
        "--heartbeat-seconds",
        type=float,
        default=10.0,
    )
    parser.add_argument("--log-dir", default=None)
    parser.add_argument("--version", action="version", version=VERSION)
    return parser


def main() -> int:
    args = build_arg_parser().parse_args()
    config = AdapterConfig.from_args(args)
    config.log_dir.mkdir(parents=True, exist_ok=True)

    runtime = AdapterRuntime(config)
    server = ThreadingHTTPServer(
        (config.host, config.port),
        AdapterHandler,
    )
    server.runtime = runtime  # type: ignore[attr-defined]

    state = {
        "status": "ready",
        "service": "gemini-openrouter-adapter",
        "version": VERSION,
        "url": f"http://{config.host}:{config.port}",
        "forced_model": config.model,
        "upstream": config.upstream_url,
        "api_key_present": runtime.api_key_present,
        "heartbeat_seconds": config.heartbeat_seconds,
        "response_mode": "heartbeat_stream",
        "max_output_tokens": config.max_output_tokens,
        "native_web_search_bridge": True,
        "web_search_engine": config.web_search_engine,
        "log_dir": str(config.log_dir),
        "pid": os.getpid(),
        "started_at": runtime.started_at,
    }
    print(compact_json(state), flush=True)

    stop_event = threading.Event()

    def handle_signal(signum: int, frame: Any) -> None:
        if not stop_event.is_set():
            stop_event.set()
            threading.Thread(
                target=server.shutdown,
                daemon=True,
            ).start()

    if hasattr(signal, "SIGTERM"):
        signal.signal(signal.SIGTERM, handle_signal)
    if hasattr(signal, "SIGINT"):
        signal.signal(signal.SIGINT, handle_signal)

    try:
        server.serve_forever(poll_interval=0.2)
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
