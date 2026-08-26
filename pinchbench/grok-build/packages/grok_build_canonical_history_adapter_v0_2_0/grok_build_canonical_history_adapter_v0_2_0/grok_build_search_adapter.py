#!/usr/bin/env python3
"""
Grok Build -> OpenRouter Responses API canonical compatibility adapter.

This version replaces one-off field patches with a schema-aware history compiler.

The compiler:
- forces the benchmark model;
- flattens only top-level Responses input arrays;
- canonicalizes known input item types;
- repairs web_search_call action objects, including null list fields;
- stringifies structured tool arguments/results;
- preserves standard messages and function-call history;
- converts unsupported historical artifacts to portable messages;
- validates the normalized request locally;
- retries one invalid_prompt response with provider-specific history compiled
  to portable messages;
- records full local diagnostic request/error files for any upstream 400;
- preserves the existing web-search response event translation and [DONE]
  suppression behavior.

It does not modify prompts, task files, task selection, or grading.
"""

from __future__ import annotations

import argparse
import copy
import datetime as dt
import hashlib
import http.server
import json
import os
import socketserver
import threading
import traceback
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path
from typing import Any

VERSION = "0.2.0"
TARGET_MODEL_DEFAULT = "deepseek/deepseek-v4-pro"
VALID_ITEM_STATUS = {"in_progress", "searching", "completed", "incomplete", "failed"}
VALID_MESSAGE_STATUS = {"in_progress", "completed", "incomplete"}
VALID_MESSAGE_ROLES = {"user", "assistant", "system", "developer"}


def utc_now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


def json_string(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


def stable_id(prefix: str, value: Any) -> str:
    digest = hashlib.sha256(json_string(value).encode("utf-8")).hexdigest()[:24]
    return f"{prefix}_{digest}"


def nonempty_string(value: Any, default: str = "") -> str:
    if isinstance(value, str):
        return value
    if value is None:
        return default
    if isinstance(value, (dict, list)):
        return json_string(value)
    return str(value)


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


class JsonlLogger:
    def __init__(self, path: Path) -> None:
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.lock = threading.Lock()

    def write(self, event: str, **fields: Any) -> None:
        row = {"ts": utc_now(), "event": event, **fields}
        with self.lock:
            with self.path.open("a", encoding="utf-8") as handle:
                handle.write(json.dumps(row, ensure_ascii=False) + "\n")


class DiagnosticStore:
    def __init__(self, path: Path) -> None:
        self.path = path
        self.path.mkdir(parents=True, exist_ok=True)
        self.lock = threading.Lock()

    def write_json(self, request_id: str, suffix: str, value: Any) -> str:
        destination = self.path / f"{request_id}.{suffix}.json"
        with self.lock:
            destination.write_text(
                json.dumps(value, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )
        return str(destination)


def flatten_top_level_input(value: list[Any], stats: dict[str, int]) -> list[Any]:
    flattened: list[Any] = []
    for item in value:
        if isinstance(item, list):
            stats["input_nested_arrays_flattened"] += 1
            stats["input_items_recovered"] += len(item)
            flattened.extend(flatten_top_level_input(item, stats))
        else:
            flattened.append(item)
    return flattened


def type_summary(value: Any) -> dict[str, int]:
    if isinstance(value, str):
        return {"string": 1}
    if not isinstance(value, list):
        return {type(value).__name__: 1}
    result: dict[str, int] = {}
    for item in value:
        if isinstance(item, list):
            key = "nested_array"
        elif isinstance(item, dict):
            key = str(item.get("type") or "object_without_type")
        else:
            key = type(item).__name__
        result[key] = result.get(key, 0) + 1
    return result


def normalize_source_list(value: Any, stats: dict[str, int]) -> list[dict[str, str]]:
    if value is None:
        stats["null_arrays_repaired"] += 1
        return []
    if not isinstance(value, list):
        stats["nonlist_arrays_repaired"] += 1
        value = [value]

    result: list[dict[str, str]] = []
    seen: set[str] = set()
    for raw in value:
        if isinstance(raw, str):
            url = raw.strip()
        elif isinstance(raw, dict):
            url = nonempty_string(raw.get("url")).strip()
        else:
            continue
        if not url or url in seen:
            continue
        parsed = urllib.parse.urlparse(url)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            stats["invalid_sources_dropped"] += 1
            continue
        seen.add(url)
        result.append({"type": "url", "url": url})
    return result


def normalize_string_list(value: Any, stats: dict[str, int]) -> list[str]:
    if value is None:
        stats["null_arrays_repaired"] += 1
        return []
    if not isinstance(value, list):
        stats["nonlist_arrays_repaired"] += 1
        value = [value]
    result: list[str] = []
    for raw in value:
        text = nonempty_string(raw).strip()
        if text:
            result.append(text)
    return result


def canonical_web_search_action(value: Any, stats: dict[str, int]) -> dict[str, Any]:
    if not isinstance(value, dict):
        stats["web_search_actions_rebuilt"] += 1
        value = {}

    action_type = nonempty_string(value.get("type"), "search")
    if action_type not in {"search", "open_page", "find_in_page"}:
        stats["web_search_actions_rebuilt"] += 1
        action_type = "search"

    if action_type == "open_page":
        return {
            "type": "open_page",
            "url": nonempty_string(value.get("url")),
        }

    if action_type == "find_in_page":
        return {
            "type": "find_in_page",
            "url": nonempty_string(value.get("url")),
            "pattern": nonempty_string(value.get("pattern")),
        }

    query = nonempty_string(value.get("query")).strip()
    queries = normalize_string_list(value.get("queries"), stats)
    if not query and queries:
        query = queries[0]
    if query and not queries:
        queries = [query]

    return {
        "type": "search",
        "query": query,
        "queries": queries,
        "sources": normalize_source_list(value.get("sources"), stats),
    }


def canonical_message_content(role: str, value: Any, stats: dict[str, int]) -> list[dict[str, Any]]:
    target_text_type = "output_text" if role == "assistant" else "input_text"

    if isinstance(value, str):
        return [{"type": target_text_type, "text": value, **({"annotations": []} if role == "assistant" else {})}]

    if value is None:
        stats["null_arrays_repaired"] += 1
        return [{"type": target_text_type, "text": "", **({"annotations": []} if role == "assistant" else {})}]

    if not isinstance(value, list):
        stats["nonlist_arrays_repaired"] += 1
        value = [value]

    result: list[dict[str, Any]] = []
    for part in value:
        if isinstance(part, str):
            result.append(
                {"type": target_text_type, "text": part, **({"annotations": []} if role == "assistant" else {})}
            )
            continue

        if not isinstance(part, dict):
            result.append(
                {"type": target_text_type, "text": nonempty_string(part), **({"annotations": []} if role == "assistant" else {})}
            )
            continue

        part_type = nonempty_string(part.get("type"))
        if part_type in {"input_image", "input_file"} and role != "assistant":
            result.append(copy.deepcopy(part))
            continue
        if part_type == "refusal" and role == "assistant":
            result.append({"type": "refusal", "refusal": nonempty_string(part.get("refusal"))})
            continue
        if part_type in {"input_text", "output_text", "text"} or "text" in part:
            normalized = {
                "type": target_text_type,
                "text": nonempty_string(part.get("text")),
            }
            if role == "assistant":
                annotations = part.get("annotations")
                normalized["annotations"] = annotations if isinstance(annotations, list) else []
            result.append(normalized)
            continue

        # Preserve semantic content without forwarding an unknown content schema.
        result.append(
            {
                "type": target_text_type,
                "text": "[Canonicalized content]\n" + json_string(part),
                **({"annotations": []} if role == "assistant" else {}),
            }
        )
        stats["unknown_content_textualized"] += 1

    if not result:
        result.append(
            {"type": target_text_type, "text": "", **({"annotations": []} if role == "assistant" else {})}
        )
    return result


def canonical_message(item: dict[str, Any], stats: dict[str, int]) -> dict[str, Any]:
    role = nonempty_string(item.get("role"), "user")
    if role not in VALID_MESSAGE_ROLES:
        role = "user"
        stats["message_roles_repaired"] += 1

    normalized: dict[str, Any] = {
        "type": "message",
        "role": role,
        "content": canonical_message_content(role, item.get("content"), stats),
    }
    if isinstance(item.get("id"), str) and item["id"]:
        normalized["id"] = item["id"]
    status = item.get("status")
    if isinstance(status, str) and status in VALID_MESSAGE_STATUS:
        normalized["status"] = status
    return normalized


def canonical_reasoning(item: dict[str, Any], stats: dict[str, int]) -> dict[str, Any]:
    summary = item.get("summary")
    if summary is None:
        summary = []
        stats["reasoning_summaries_injected"] += 1
    elif not isinstance(summary, list):
        summary = [summary]
        stats["reasoning_summaries_coerced"] += 1

    normalized: dict[str, Any] = {
        "type": "reasoning",
        "id": nonempty_string(item.get("id")) or stable_id("rs_canon", item),
        "summary": summary,
    }
    if isinstance(item.get("encrypted_content"), str):
        normalized["encrypted_content"] = item["encrypted_content"]
    if isinstance(item.get("content"), list):
        normalized["content"] = copy.deepcopy(item["content"])
    status = item.get("status")
    if isinstance(status, str) and status in VALID_MESSAGE_STATUS:
        normalized["status"] = status
    return normalized


def portable_history_message(label: str, item: dict[str, Any]) -> dict[str, Any]:
    return {
        "type": "message",
        "role": "assistant",
        "status": "completed",
        "content": [
            {
                "type": "output_text",
                "text": f"[{label}]\n{json_string(item)}",
                "annotations": [],
            }
        ],
    }


def canonical_item(item: Any, stats: dict[str, int]) -> dict[str, Any]:
    if not isinstance(item, dict):
        stats["nonobject_items_textualized"] += 1
        return {
            "type": "message",
            "role": "user",
            "content": [{"type": "input_text", "text": nonempty_string(item)}],
        }

    item_type = nonempty_string(item.get("type"))

    if item_type == "message" or (not item_type and "role" in item and "content" in item):
        return canonical_message(item, stats)

    if item_type == "reasoning":
        return canonical_reasoning(item, stats)

    if item_type in {"web_search_call", "openrouter:web_search"}:
        normalized = {
            "type": "web_search_call",
            "id": nonempty_string(item.get("id")) or stable_id("ws_canon", item),
            "status": nonempty_string(item.get("status"), "completed"),
            "action": canonical_web_search_action(item.get("action"), stats),
        }
        if normalized["status"] not in VALID_ITEM_STATUS:
            normalized["status"] = "completed"
            stats["item_statuses_repaired"] += 1
        return normalized

    if item_type in {"function_call", "custom_tool_call"}:
        normalized = {
            "type": item_type,
            "call_id": nonempty_string(item.get("call_id")) or nonempty_string(item.get("id")) or stable_id("call_canon", item),
            "name": nonempty_string(item.get("name"), "unknown_tool"),
        }
        argument_key = "input" if item_type == "custom_tool_call" else "arguments"
        value = item.get(argument_key)
        if not isinstance(value, str):
            value = json_string({} if value is None else value)
            stats["tool_arguments_stringified"] += 1
        normalized[argument_key] = value
        if isinstance(item.get("id"), str) and item["id"]:
            normalized["id"] = item["id"]
        status = item.get("status")
        if isinstance(status, str) and status in VALID_MESSAGE_STATUS:
            normalized["status"] = status
        return normalized

    if item_type in {"function_call_output", "custom_tool_call_output"}:
        output = item.get("output")
        if not isinstance(output, str):
            output = json_string({} if output is None else output)
            stats["tool_outputs_stringified"] += 1
        normalized = {
            "type": item_type,
            "call_id": nonempty_string(item.get("call_id")) or stable_id("call_canon", item),
            "output": output,
        }
        if isinstance(item.get("id"), str) and item["id"]:
            normalized["id"] = item["id"]
        status = item.get("status")
        if isinstance(status, str) and status in VALID_MESSAGE_STATUS:
            normalized["status"] = status
        return normalized

    if item_type == "item_reference" and isinstance(item.get("id"), str):
        return {"type": "item_reference", "id": item["id"]}

    # Unknown/provider-specific historical items are converted immediately to
    # a standard message. This is the general escape hatch that prevents
    # one-field-at-a-time compatibility patches.
    stats["unknown_items_textualized"] += 1
    return portable_history_message(
        f"Canonicalized historical item type={item_type or 'unknown'}",
        item,
    )


def canonical_tools(value: Any, stats: dict[str, int]) -> list[dict[str, Any]]:
    if value is None:
        return []
    if not isinstance(value, list):
        stats["nonlist_arrays_repaired"] += 1
        value = [value]

    result: list[dict[str, Any]] = []
    for tool in value:
        if not isinstance(tool, dict):
            stats["invalid_tools_dropped"] += 1
            continue
        tool_type = nonempty_string(tool.get("type"))
        if tool_type == "function":
            name = nonempty_string(tool.get("name"))
            if not name and isinstance(tool.get("function"), dict):
                nested = tool["function"]
                name = nonempty_string(nested.get("name"))
                description = nonempty_string(nested.get("description"))
                parameters = nested.get("parameters")
            else:
                description = nonempty_string(tool.get("description"))
                parameters = tool.get("parameters")
            if not name:
                stats["invalid_tools_dropped"] += 1
                continue
            normalized = {
                "type": "function",
                "name": name,
                "description": description,
                "parameters": parameters if isinstance(parameters, dict) else {"type": "object", "properties": {}},
            }
            if isinstance(tool.get("strict"), bool):
                normalized["strict"] = tool["strict"]
            result.append(normalized)
            continue

        # Preserve server tools such as openrouter:web_search.
        result.append(copy.deepcopy(tool))
    return result


def validate_canonical_input(value: Any) -> list[str]:
    errors: list[str] = []
    if isinstance(value, str):
        return errors
    if not isinstance(value, list):
        return [f"input must be string or list, got {type(value).__name__}"]

    for index, item in enumerate(value):
        prefix = f"input[{index}]"
        if not isinstance(item, dict):
            errors.append(f"{prefix} must be object")
            continue
        item_type = item.get("type")
        if item_type == "message":
            if item.get("role") not in VALID_MESSAGE_ROLES:
                errors.append(f"{prefix}.role invalid")
            if not isinstance(item.get("content"), list):
                errors.append(f"{prefix}.content must be array")
        elif item_type == "web_search_call":
            if not isinstance(item.get("id"), str):
                errors.append(f"{prefix}.id must be string")
            if item.get("status") not in VALID_ITEM_STATUS:
                errors.append(f"{prefix}.status invalid")
            action = item.get("action")
            if not isinstance(action, dict):
                errors.append(f"{prefix}.action must be object")
            elif action.get("type") == "search":
                if not isinstance(action.get("queries"), list):
                    errors.append(f"{prefix}.action.queries must be array")
                if not isinstance(action.get("sources"), list):
                    errors.append(f"{prefix}.action.sources must be array")
        elif item_type in {"function_call", "custom_tool_call"}:
            if not isinstance(item.get("call_id"), str):
                errors.append(f"{prefix}.call_id must be string")
            if not isinstance(item.get("name"), str):
                errors.append(f"{prefix}.name must be string")
            field = "input" if item_type == "custom_tool_call" else "arguments"
            if not isinstance(item.get(field), str):
                errors.append(f"{prefix}.{field} must be string")
        elif item_type in {"function_call_output", "custom_tool_call_output"}:
            if not isinstance(item.get("call_id"), str):
                errors.append(f"{prefix}.call_id must be string")
            if not isinstance(item.get("output"), str):
                errors.append(f"{prefix}.output must be string")
        elif item_type == "reasoning":
            if not isinstance(item.get("summary"), list):
                errors.append(f"{prefix}.summary must be array")
        elif item_type == "item_reference":
            if not isinstance(item.get("id"), str):
                errors.append(f"{prefix}.id must be string")
        else:
            errors.append(f"{prefix}.type unsupported after canonicalization: {item_type!r}")
    return errors


def new_stats() -> dict[str, int]:
    return {
        "input_nested_arrays_flattened": 0,
        "input_items_recovered": 0,
        "tool_outputs_stringified": 0,
        "tool_arguments_stringified": 0,
        "reasoning_summaries_injected": 0,
        "reasoning_summaries_coerced": 0,
        "null_arrays_repaired": 0,
        "nonlist_arrays_repaired": 0,
        "invalid_sources_dropped": 0,
        "web_search_actions_rebuilt": 0,
        "message_roles_repaired": 0,
        "item_statuses_repaired": 0,
        "unknown_content_textualized": 0,
        "unknown_items_textualized": 0,
        "nonobject_items_textualized": 0,
        "invalid_tools_dropped": 0,
    }


def normalize_request(body: dict[str, Any], target_model: str) -> tuple[dict[str, Any], dict[str, Any]]:
    body = copy.deepcopy(body)
    original_model = body.get("model")
    body["model"] = target_model

    removed: list[str] = []
    for key in ("reasoning", "reasoning_effort"):
        if key in body and reasoning_disabled(body.get(key)):
            body.pop(key, None)
            removed.append(key)

    stats = new_stats()
    before = type_summary(body.get("input"))

    request_input = body.get("input")
    if isinstance(request_input, list):
        flattened = flatten_top_level_input(request_input, stats)
        body["input"] = [canonical_item(item, stats) for item in flattened]
    elif not isinstance(request_input, str):
        body["input"] = nonempty_string(request_input)
        stats["nonobject_items_textualized"] += 1

    body["tools"] = canonical_tools(body.get("tools"), stats)
    after = type_summary(body.get("input"))
    validation_errors = validate_canonical_input(body.get("input"))
    if validation_errors:
        raise ValueError("Canonical input validation failed: " + "; ".join(validation_errors))

    metadata = {
        "original_model": original_model,
        "forced_model": target_model,
        "removed_disabled_reasoning_fields": removed,
        "stream": bool(body.get("stream")),
        "tool_count": len(body.get("tools", [])),
        "input_before": before,
        "input_after": after,
        **stats,
    }
    return body, metadata


def reasoning_summary_text(item: dict[str, Any]) -> str:
    summary = item.get("summary")
    if not isinstance(summary, list):
        return ""
    parts: list[str] = []
    for value in summary:
        if isinstance(value, str):
            text = value
        elif isinstance(value, dict):
            text = nonempty_string(value.get("text"))
        else:
            text = nonempty_string(value)
        if text.strip():
            parts.append(text.strip())
    return "\n".join(parts)


def web_search_history_text(item: dict[str, Any]) -> str:
    action = item.get("action")
    if not isinstance(action, dict):
        return "[Web search history]"
    action_type = action.get("type")
    if action_type == "search":
        queries = action.get("queries")
        if not isinstance(queries, list):
            queries = []
        query = nonempty_string(action.get("query"))
        sources = action.get("sources")
        if not isinstance(sources, list):
            sources = []
        urls = [nonempty_string(source.get("url")) for source in sources if isinstance(source, dict)]
        lines = ["[Web search history]"]
        if query:
            lines.append(f"Query: {query}")
        elif queries:
            lines.append("Queries: " + " | ".join(nonempty_string(x) for x in queries))
        if urls:
            lines.append("Sources:")
            lines.extend(f"- {url}" for url in urls if url)
        return "\n".join(lines)
    return "[Web search history]\n" + json_string(action)


def compile_portable_history(body: dict[str, Any]) -> tuple[dict[str, Any], dict[str, int]]:
    portable = copy.deepcopy(body)
    stats = {
        "web_search_items_textualized": 0,
        "reasoning_items_textualized": 0,
        "reasoning_items_dropped": 0,
    }
    value = portable.get("input")
    if not isinstance(value, list):
        return portable, stats

    result: list[dict[str, Any]] = []
    for item in value:
        if not isinstance(item, dict):
            result.append(item)
            continue
        item_type = item.get("type")
        if item_type == "web_search_call":
            result.append(
                {
                    "type": "message",
                    "role": "assistant",
                    "status": "completed",
                    "content": [
                        {
                            "type": "output_text",
                            "text": web_search_history_text(item),
                            "annotations": [],
                        }
                    ],
                }
            )
            stats["web_search_items_textualized"] += 1
            continue
        if item_type == "reasoning":
            summary = reasoning_summary_text(item)
            if summary:
                result.append(
                    {
                        "type": "message",
                        "role": "assistant",
                        "status": "completed",
                        "content": [
                            {
                                "type": "output_text",
                                "text": "[Reasoning summary]\n" + summary,
                                "annotations": [],
                            }
                        ],
                    }
                )
                stats["reasoning_items_textualized"] += 1
            else:
                stats["reasoning_items_dropped"] += 1
            continue
        result.append(item)

    portable["input"] = result
    errors = validate_canonical_input(portable["input"])
    if errors:
        raise ValueError("Portable history validation failed: " + "; ".join(errors))
    return portable, stats


def placeholder_search_action() -> dict[str, Any]:
    return {"type": "search", "query": "", "queries": [], "sources": []}


def normalize_response_value(value: Any, stats: dict[str, int]) -> Any:
    if isinstance(value, list):
        return [normalize_response_value(item, stats) for item in value]
    if not isinstance(value, dict):
        return value

    normalized = {key: normalize_response_value(item, stats) for key, item in value.items()}

    if normalized.get("type") == "openrouter:web_search":
        normalized["type"] = "web_search_call"
        stats["type_translated"] += 1

    if normalized.get("type") == "web_search_call":
        if "action" not in normalized:
            normalized["action"] = placeholder_search_action()
            stats["action_injected"] += 1
        else:
            action_stats = new_stats()
            normalized["action"] = canonical_web_search_action(normalized.get("action"), action_stats)
            for key in ("null_arrays_repaired", "nonlist_arrays_repaired", "invalid_sources_dropped", "web_search_actions_rebuilt"):
                stats[key] += action_stats[key]

    if normalized.get("type") == "reasoning":
        summary = normalized.get("summary")
        if summary is None:
            normalized["summary"] = []
            stats["reasoning_summaries_injected"] += 1
        elif not isinstance(summary, list):
            normalized["summary"] = [summary]
            stats["reasoning_summaries_coerced"] += 1

    return normalized


def response_stats() -> dict[str, int]:
    return {
        "type_translated": 0,
        "action_injected": 0,
        "reasoning_summaries_injected": 0,
        "reasoning_summaries_coerced": 0,
        "null_arrays_repaired": 0,
        "nonlist_arrays_repaired": 0,
        "invalid_sources_dropped": 0,
        "web_search_actions_rebuilt": 0,
    }


def normalize_response_text(text: str) -> tuple[str, dict[str, int]]:
    stats = response_stats()
    stripped = text.strip()
    if not stripped or stripped == "[DONE]":
        return text, stats
    try:
        parsed = json.loads(stripped)
    except json.JSONDecodeError:
        normalized = text.replace('"type":"openrouter:web_search"', '"type":"web_search_call"')
        normalized = normalized.replace('"type": "openrouter:web_search"', '"type": "web_search_call"')
        if normalized != text:
            stats["type_translated"] += 1
        return normalized, stats

    normalized_value = normalize_response_value(parsed, stats)
    return json.dumps(normalized_value, ensure_ascii=False, separators=(",", ":")), stats


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
        diagnostics: DiagnosticStore,
    ) -> None:
        super().__init__(address, handler)
        self.upstream = upstream.rstrip("/")
        self.target_model = target_model
        self.timeout_seconds = timeout_seconds
        self.logger = logger
        self.diagnostics = diagnostics


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
                    "name": "grok-build-canonical-responses-adapter",
                    "version": VERSION,
                    "compiler": "canonical-history-v1",
                    "target_model": self.server.target_model,
                    "upstream": self.server.upstream,
                },
            )
        else:
            self.send_json(404, {"error": "not_found", "path": self.path})

    def upstream_request(
        self,
        body: dict[str, Any],
        headers: dict[str, str],
    ) -> Any:
        payload = json.dumps(body, ensure_ascii=False).encode("utf-8")
        request = urllib.request.Request(
            self.server.upstream + "/responses",
            data=payload,
            headers=headers,
            method="POST",
        )
        return urllib.request.urlopen(request, timeout=self.server.timeout_seconds)

    def do_POST(self) -> None:
        request_id = str(uuid.uuid4())
        if self.path not in {"/v1/responses", "/responses"}:
            self.send_json(404, {"error": "unsupported_path", "path": self.path})
            return

        try:
            length = int(self.headers.get("Content-Length", "0"))
            raw = self.rfile.read(length)
            incoming = json.loads(raw.decode("utf-8"))
            if not isinstance(incoming, dict):
                raise ValueError("Request body must be a JSON object.")

            body, metadata = normalize_request(incoming, self.server.target_model)
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
                "User-Agent": "PinchBench-GrokBuild-Canonical-Adapter/0.2.0",
                "HTTP-Referer": "https://github.com/xai-org/grok-build",
                "X-Title": "PinchBench Grok Build",
            }

            changed = any(
                metadata[key]
                for key in new_stats()
                if key in metadata
            )
            if changed:
                self.server.logger.write(
                    "request_canonicalized",
                    request_id=request_id,
                    metadata=metadata,
                )

            self.server.logger.write(
                "request_start",
                request_id=request_id,
                path=self.path,
                upstream_url=self.server.upstream + "/responses",
                metadata=metadata,
                body_bytes=len(json.dumps(body, ensure_ascii=False).encode("utf-8")),
            )

            retry_used = False
            portable_stats: dict[str, int] | None = None
            try:
                upstream = self.upstream_request(body, headers)
            except urllib.error.HTTPError as first_error:
                first_body = first_error.read()
                first_error_text = first_body.decode("utf-8", errors="replace")
                request_file = self.server.diagnostics.write_json(request_id, "canonical-request", body)
                error_file = self.server.diagnostics.write_json(
                    request_id,
                    "first-error",
                    {
                        "status": first_error.code,
                        "headers": dict(first_error.headers.items()),
                        "body": first_error_text,
                    },
                )
                self.server.logger.write(
                    "upstream_http_error",
                    request_id=request_id,
                    status=first_error.code,
                    body_preview=first_error_text[:12000],
                    request_file=request_file,
                    error_file=error_file,
                    input_after=metadata.get("input_after"),
                )

                can_retry = (
                    first_error.code == 400
                    and "invalid_prompt" in first_error_text
                    and isinstance(body.get("input"), list)
                    and any(
                        isinstance(item, dict) and item.get("type") in {"web_search_call", "reasoning"}
                        for item in body["input"]
                    )
                )
                if not can_retry:
                    self._forward_http_error(first_error.code, first_error.headers, first_body)
                    return

                portable_body, portable_stats = compile_portable_history(body)
                if portable_body == body:
                    self._forward_http_error(first_error.code, first_error.headers, first_body)
                    return

                retry_used = True
                portable_file = self.server.diagnostics.write_json(
                    request_id, "portable-retry-request", portable_body
                )
                self.server.logger.write(
                    "portable_history_fallback_retry",
                    request_id=request_id,
                    first_status=first_error.code,
                    portable_stats=portable_stats,
                    portable_request_file=portable_file,
                    portable_input_shape=type_summary(portable_body.get("input")),
                )
                try:
                    upstream = self.upstream_request(portable_body, headers)
                    body = portable_body
                except urllib.error.HTTPError as second_error:
                    second_body = second_error.read()
                    second_text = second_body.decode("utf-8", errors="replace")
                    second_file = self.server.diagnostics.write_json(
                        request_id,
                        "portable-retry-error",
                        {
                            "status": second_error.code,
                            "headers": dict(second_error.headers.items()),
                            "body": second_text,
                        },
                    )
                    self.server.logger.write(
                        "portable_history_fallback_failed",
                        request_id=request_id,
                        status=second_error.code,
                        body_preview=second_text[:12000],
                        error_file=second_file,
                    )
                    self._forward_http_error(second_error.code, second_error.headers, second_body)
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
                portable_retry_used=retry_used,
                portable_stats=portable_stats,
            )

            if is_sse:
                self.send_response(status)
                self.send_header("Content-Type", "text/event-stream")
                self.send_header("Cache-Control", "no-cache")
                self.send_header("Connection", "close")
                self.end_headers()

                event_count = 0
                done_suppressed_count = 0
                response_changes = response_stats()
                suppress_blank = False

                for raw_line in upstream:
                    line = raw_line.decode("utf-8", errors="replace")
                    if line.startswith("data:"):
                        prefix, payload_text = line.split(":", 1)
                        if payload_text.strip() == "[DONE]":
                            done_suppressed_count += 1
                            suppress_blank = True
                            continue
                        event_count += 1
                        normalized, event_stats = normalize_response_text(payload_text)
                        for key, value in event_stats.items():
                            response_changes[key] += value
                        line = prefix + ": " + normalized + "\n"
                        suppress_blank = False
                    elif suppress_blank and not line.strip():
                        suppress_blank = False
                        continue
                    self.wfile.write(line.encode("utf-8"))
                    self.wfile.flush()

                self.close_connection = True
                self.server.logger.write(
                    "request_completed",
                    request_id=request_id,
                    status=status,
                    stream=True,
                    event_count=event_count,
                    done_suppressed_count=done_suppressed_count,
                    response_changes=response_changes,
                    portable_retry_used=retry_used,
                )
                return

            response_body = upstream.read()
            normalized_text, changes = normalize_response_text(
                response_body.decode("utf-8", errors="replace")
            )
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
                response_changes=changes,
                portable_retry_used=retry_used,
            )

        except BrokenPipeError:
            self.server.logger.write("client_disconnected", request_id=request_id)
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
                    {"error": "adapter_exception", "message": str(exc), "request_id": request_id},
                )
            except Exception:
                pass

    def _forward_http_error(self, code: int, headers: Any, body: bytes) -> None:
        self.send_response(code)
        self.send_header("Content-Type", headers.get("Content-Type", "application/json"))
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Connection", "close")
        self.end_headers()
        self.wfile.write(body)
        self.wfile.flush()
        self.close_connection = True


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8767)
    parser.add_argument("--upstream", default="https://openrouter.ai/api/v1")
    parser.add_argument("--target-model", default=TARGET_MODEL_DEFAULT)
    parser.add_argument("--timeout-seconds", type=int, default=900)
    parser.add_argument("--log", default=r"C:\pinchbench-grok-build\logs\search-adapter.jsonl")
    parser.add_argument(
        "--diagnostics-dir",
        default=r"C:\pinchbench-grok-build\logs\adapter-diagnostics",
    )
    args = parser.parse_args()

    logger = JsonlLogger(Path(args.log))
    diagnostics = DiagnosticStore(Path(args.diagnostics_dir))
    server = AdapterServer(
        (args.host, args.port),
        Handler,
        upstream=args.upstream,
        target_model=args.target_model,
        timeout_seconds=args.timeout_seconds,
        logger=logger,
        diagnostics=diagnostics,
    )
    logger.write(
        "adapter_started",
        version=VERSION,
        compiler="canonical-history-v1",
        host=args.host,
        port=args.port,
        upstream=args.upstream,
        target_model=args.target_model,
        diagnostics_dir=str(Path(args.diagnostics_dir)),
        proxy={
            "HTTP_PROXY": os.environ.get("HTTP_PROXY"),
            "HTTPS_PROXY": os.environ.get("HTTPS_PROXY"),
            "ALL_PROXY": os.environ.get("ALL_PROXY"),
            "NO_PROXY": os.environ.get("NO_PROXY"),
        },
    )
    print(
        f"Grok Build canonical Responses adapter v{VERSION} listening at "
        f"http://{args.host}:{args.port}",
        flush=True,
    )
    print("Compiler: canonical-history-v1", flush=True)
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
