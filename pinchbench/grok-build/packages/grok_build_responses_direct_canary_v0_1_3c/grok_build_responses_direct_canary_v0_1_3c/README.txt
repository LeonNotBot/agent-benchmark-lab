Grok Build Responses Direct Protocol Canary v0.1.3c
========================================================

Why the previous long-write canary ended with a false failure
-------------------------------------------------------------
The real Agent run succeeded, but that particular run produced an already-valid,
flat Responses request. Therefore Adapter v0.1.3 correctly had nothing to
normalize and emitted no request_wire_format_normalized log event.

This deterministic canary does not depend on the Agent choosing a particular
wire shape. It starts:
- a temporary instance of the exact installed Adapter v0.1.3 core;
- a local mock upstream server.

It then deliberately submits the malformed shape observed in the three failed
research tasks:
- a nested array inside the top-level Responses input list;
- structured function_call arguments;
- structured function_call_output output.

It verifies at the mock upstream that:
1. the input list is flat;
2. arguments and output are JSON strings;
3. message content arrays are unchanged;
4. the forced model remains deepseek/deepseek-v4-pro;
5. request_wire_format_normalized contains the expected counts.

No external model request is made. No run directory, prompt, result or grader is
modified.
