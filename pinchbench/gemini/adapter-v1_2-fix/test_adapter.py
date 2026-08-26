#!/usr/bin/env python3
from __future__ import annotations

import io
import json
import tempfile
import threading
import unittest
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import gemini_openrouter_adapter as adapter


def make_config(tmp: Path) -> adapter.AdapterConfig:
    return adapter.AdapterConfig(
        host="127.0.0.1",
        port=8766,
        model="deepseek/deepseek-v4-pro",
        upstream_url="https://openrouter.ai/api/v1/responses",
        timeout_seconds=30,
        heartbeat_seconds=0.05,
        log_dir=tmp,
        log_payloads=False,
        parallel_tool_calls=True,
        reasoning_mode="auto",
        max_output_tokens=None,
        app_title="test",
        app_url="http://127.0.0.1",
    )


class TranslationTests(unittest.TestCase):
    def test_tool_schema_translation(self) -> None:
        tools = [
            {
                "functionDeclarations": [
                    {
                        "name": "write_file",
                        "description": "write",
                        "parametersJsonSchema": {
                            "type": "object",
                            "properties": {
                                "path": {"type": "string"},
                                "content": {"type": "string"},
                            },
                            "required": ["path", "content"],
                            "$schema": "ignored",
                        },
                    }
                ]
            }
        ]
        translated, names = adapter.translate_tools(tools)
        self.assertEqual(names, ["write_file"])
        self.assertEqual(translated[0]["name"], "write_file")
        self.assertNotIn("$schema", translated[0]["parameters"])
        self.assertEqual(
            translated[0]["parameters"]["required"],
            ["path", "content"],
        )

    def test_history_function_roundtrip_translation(self) -> None:
        contents = [
            {
                "role": "user",
                "parts": [{"text": "Create a file"}],
            },
            {
                "role": "model",
                "parts": [
                    {
                        "functionCall": {
                            "id": "call-1",
                            "name": "write_file",
                            "args": {
                                "file_path": "a.txt",
                                "content": "ok",
                            },
                        }
                    }
                ],
            },
            {
                "role": "user",
                "parts": [
                    {
                        "functionResponse": {
                            "id": "call-1",
                            "name": "write_file",
                            "response": {"output": "success"},
                        }
                    }
                ],
            },
            {
                "role": "model",
                "parts": [{"text": "Done"}],
            },
            {
                "role": "user",
                "parts": [{"text": "Verify"}],
            },
        ]
        items, calls, responses = adapter.translate_contents(contents)
        self.assertEqual(calls, 1)
        self.assertEqual(responses, 1)
        self.assertEqual(items[1]["type"], "function_call")
        self.assertEqual(items[1]["call_id"], "call-1")
        self.assertEqual(items[2]["type"], "function_call_output")
        self.assertEqual(items[2]["call_id"], "call-1")
        self.assertEqual(items[-1]["role"], "user")

    def test_full_request_translation(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            config = make_config(Path(temp))
            body = {
                "systemInstruction": {
                    "role": "user",
                    "parts": [{"text": "You are an agent."}],
                },
                "contents": [
                    {
                        "role": "user",
                        "parts": [{"text": "Say OK"}],
                    }
                ],
                "tools": [],
                "generationConfig": {
                    "temperature": 1,
                    "topP": 0.95,
                    "topK": 64,
                    "thinkingConfig": {"includeThoughts": True},
                },
            }
            result = adapter.translate_request(
                body,
                "deepseek/deepseek-v4-pro",
                config,
            )
            self.assertEqual(
                result.payload["model"],
                "deepseek/deepseek-v4-pro",
            )
            self.assertEqual(
                result.payload["instructions"],
                "You are an agent.",
            )
            self.assertEqual(result.payload["temperature"], 1)
            self.assertEqual(result.payload["top_p"], 0.95)
            self.assertIn("topK", result.ignored_generation_fields)
            self.assertNotIn("reasoning", result.payload)


class StreamTests(unittest.TestCase):
    def test_text_stream(self) -> None:
        events = [
            b'data: {"type":"response.created","response":{"id":"resp-1","model":"deepseek/deepseek-v4-pro"}}\n',
            b'data: {"type":"response.output_text.delta","delta":"HEL"}\n',
            b'data: {"type":"response.output_text.delta","delta":"LO"}\n',
            b'data: {"type":"response.completed","response":{"id":"resp-1","model":"deepseek/deepseek-v4-pro","status":"completed","usage":{"input_tokens":10,"output_tokens":2,"total_tokens":12},"output":[]}}\n',
            b'data: [DONE]\n',
        ]
        deltas = []
        aggregate = adapter.parse_openrouter_sse(
            events,
            on_text_delta=deltas.append,
        )
        self.assertEqual("".join(deltas), "HELLO")
        self.assertEqual(aggregate.text, "HELLO")
        self.assertEqual(aggregate.usage["total_tokens"], 12)
        response = adapter.build_gemini_response(aggregate)
        self.assertEqual(
            response["usageMetadata"]["totalTokenCount"],
            12,
        )

    def test_function_call_stream(self) -> None:
        events = [
            b'data: {"type":"response.output_item.added","output_index":0,"item":{"type":"function_call","id":"fc-1","call_id":"call-1","name":"write_file","arguments":""}}\n',
            b'data: {"type":"response.function_call_arguments.delta","item_id":"fc-1","call_id":"call-1","delta":"{\\"file_path\\":"}\n',
            b'data: {"type":"response.function_call_arguments.delta","item_id":"fc-1","call_id":"call-1","delta":"\\"a.txt\\"}"}\n',
            b'data: {"type":"response.function_call_arguments.done","item_id":"fc-1","call_id":"call-1","name":"write_file","arguments":"{\\"file_path\\":\\"a.txt\\"}"}\n',
            b'data: {"type":"response.completed","response":{"id":"resp-2","model":"deepseek/deepseek-v4-pro","status":"completed","usage":{"input_tokens":20,"output_tokens":5,"total_tokens":25},"output":[]}}\n',
            b'data: [DONE]\n',
        ]
        aggregate = adapter.parse_openrouter_sse(events)
        self.assertEqual(len(aggregate.function_calls), 1)
        call = aggregate.function_calls[0]
        self.assertEqual(call["id"], "call-1")
        self.assertEqual(call["name"], "write_file")
        self.assertEqual(call["args"]["file_path"], "a.txt")
        response = adapter.build_gemini_response(aggregate)
        function_part = response["candidates"][0]["content"]["parts"][0]
        self.assertEqual(
            function_part["functionCall"]["id"],
            "call-1",
        )

    def test_completed_fallback(self) -> None:
        response = {
            "id": "resp-3",
            "model": "deepseek/deepseek-v4-pro",
            "status": "completed",
            "usage": {
                "input_tokens": 3,
                "output_tokens": 4,
                "total_tokens": 7,
            },
            "output": [
                {
                    "type": "message",
                    "role": "assistant",
                    "content": [
                        {
                            "type": "output_text",
                            "text": "fallback",
                            "annotations": [],
                        }
                    ],
                }
            ],
        }
        events = [
            (
                "data: "
                + json.dumps(
                    {
                        "type": "response.completed",
                        "response": response,
                    }
                )
                + "\n"
            ).encode("utf-8"),
            b"data: [DONE]\n",
        ]
        aggregate = adapter.parse_openrouter_sse(events)
        self.assertEqual(aggregate.text, "fallback")


class MockOpenRouterHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        return

    def do_POST(self):
        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length)
        payload = json.loads(raw.decode("utf-8"))
        self.server.last_payload = payload

        events = [
            {
                "type": "response.created",
                "response": {
                    "id": "resp-integration",
                    "model": "deepseek/deepseek-v4-pro",
                },
            },
            {
                "type": "response.output_text.delta",
                "delta": "INTEGRATION_OK",
            },
            {
                "type": "response.completed",
                "response": {
                    "id": "resp-integration",
                    "model": "deepseek/deepseek-v4-pro",
                    "provider": "mock-provider",
                    "status": "completed",
                    "usage": {
                        "input_tokens": 5,
                        "output_tokens": 2,
                        "total_tokens": 7,
                    },
                    "output": [],
                },
            },
        ]
        body = b"".join(
            (
                "data: "
                + json.dumps(event, separators=(",", ":"))
                + "\n\n"
            ).encode("utf-8")
            for event in events
        ) + b"data: [DONE]\n\n"

        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Connection", "close")
        self.end_headers()
        self.wfile.flush()
        if getattr(self.server, "delay_body_seconds", 0):
            adapter.time.sleep(self.server.delay_body_seconds)
        self.wfile.write(body)
        self.wfile.flush()
        self.close_connection = True


class HttpIntegrationTests(unittest.TestCase):
    def test_local_gemini_to_mock_openrouter(self) -> None:
        old_key = adapter.os.environ.get("OPENROUTER_API_KEY")
        old_http = adapter.os.environ.pop("HTTP_PROXY", None)
        old_https = adapter.os.environ.pop("HTTPS_PROXY", None)
        old_http_lower = adapter.os.environ.pop("http_proxy", None)
        old_https_lower = adapter.os.environ.pop("https_proxy", None)
        adapter.os.environ["OPENROUTER_API_KEY"] = "test-key"

        mock_server = ThreadingHTTPServer(
            ("127.0.0.1", 0),
            MockOpenRouterHandler,
        )
        mock_server.delay_body_seconds = 0.18
        mock_thread = threading.Thread(
            target=mock_server.serve_forever,
            daemon=True,
        )
        mock_thread.start()

        with tempfile.TemporaryDirectory() as temp:
            config = make_config(Path(temp))
            config.upstream_url = (
                f"http://127.0.0.1:{mock_server.server_port}/responses"
            )
            runtime = adapter.AdapterRuntime(config)
            local_server = ThreadingHTTPServer(
                ("127.0.0.1", 0),
                adapter.AdapterHandler,
            )
            local_server.runtime = runtime
            local_thread = threading.Thread(
                target=local_server.serve_forever,
                daemon=True,
            )
            local_thread.start()

            body = {
                "contents": [
                    {
                        "role": "user",
                        "parts": [{"text": "test"}],
                    }
                ],
                "systemInstruction": {
                    "role": "user",
                    "parts": [{"text": "system"}],
                },
                "tools": [],
                "generationConfig": {"temperature": 1},
            }
            request = urllib.request.Request(
                (
                    f"http://127.0.0.1:{local_server.server_port}"
                    "/v1beta/models/deepseek/deepseek-v4-pro:"
                    "streamGenerateContent?alt=sse"
                ),
                data=json.dumps(body).encode("utf-8"),
                headers={
                    "Content-Type": "application/json",
                    "x-goog-api-key": "local",
                },
                method="POST",
            )
            with urllib.request.urlopen(request, timeout=10) as response:
                result = response.read().decode("utf-8")

            self.assertIn("INTEGRATION_OK", result)
            self.assertIn('"totalTokenCount": 7', result)
            self.assertNotIn(": keep-alive", result)
            self.assertTrue(result.startswith("data: {"))
            self.assertTrue(result.endswith("\n\n"))
            data_events = [
                line[6:]
                for line in result.splitlines()
                if line.startswith("data: ")
            ]
            self.assertGreaterEqual(len(data_events), 2)
            parsed_events = [json.loads(item) for item in data_events]
            self.assertEqual(
                parsed_events[0]["candidates"][0]["content"]["parts"],
                [],
            )
            self.assertTrue(
                any(
                    any(
                        part.get("text") == "INTEGRATION_OK"
                        for part in event.get("candidates", [{}])[0]
                        .get("content", {})
                        .get("parts", [])
                        if isinstance(part, dict)
                    )
                    for event in parsed_events
                    if event.get("candidates")
                )
            )
            self.assertEqual(
                mock_server.last_payload["model"],
                "deepseek/deepseek-v4-pro",
            )
            self.assertEqual(
                mock_server.last_payload["instructions"],
                "system",
            )

            local_server.shutdown()
            local_server.server_close()
            local_thread.join(timeout=2)

        mock_server.shutdown()
        mock_server.server_close()
        mock_thread.join(timeout=2)

        if old_key is None:
            adapter.os.environ.pop("OPENROUTER_API_KEY", None)
        else:
            adapter.os.environ["OPENROUTER_API_KEY"] = old_key
        for name, value in (
            ("HTTP_PROXY", old_http),
            ("HTTPS_PROXY", old_https),
            ("http_proxy", old_http_lower),
            ("https_proxy", old_https_lower),
        ):
            if value is not None:
                adapter.os.environ[name] = value


class ReliabilityTests(unittest.TestCase):
    def test_disconnect_errors_include_windows_abort(self) -> None:
        self.assertIn(
            ConnectionAbortedError,
            adapter.CLIENT_DISCONNECT_ERRORS,
        )

    def test_heartbeat_is_complete_json_sse_payload(self) -> None:
        handler = object.__new__(adapter.AdapterHandler)
        with tempfile.TemporaryDirectory() as temp:
            config = make_config(Path(temp))

            class Runtime:
                pass

            runtime = Runtime()
            runtime.config = config

            class Server:
                pass

            server = Server()
            server.runtime = runtime
            handler.server = server

            payload = handler.heartbeat_payload("request-1")
            encoded = (
                "data: "
                + json.dumps(payload, ensure_ascii=False)
                + "\n\n"
            )
            self.assertTrue(encoded.startswith("data: {"))
            self.assertTrue(encoded.endswith("\n\n"))
            self.assertEqual(
                payload["candidates"][0]["content"]["parts"],
                [],
            )


if __name__ == "__main__":
    unittest.main(verbosity=2)
