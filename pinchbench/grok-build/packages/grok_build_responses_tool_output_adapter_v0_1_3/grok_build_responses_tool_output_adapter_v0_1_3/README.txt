Grok Build Responses Tool-Output Adapter v0.1.3
==================================================

Validated systemic failure
----------------------------
The following tasks completed their long report file and then failed on the
next Responses request:

- task_deep_research
- task_oss_alternative_research
- task_pricing_research

OpenRouter returned:

- invalid_prompt
- Invalid Responses API request
- expected string, received array

The task transcript shows the error occurs after the Grok Build local `write`
tool result is added to the next model request.

Wire-format fix
---------------
v0.1.3:

1. Flattens nested arrays only when they occur as elements of the top-level
   Responses `input` list.
2. JSON-serializes structured function/custom-tool output values when the API
   field requires a string.
3. JSON-serializes structured function/custom-tool arguments when required.
4. Leaves message `content` arrays untouched.
5. Logs only request shape and normalization counts, never prompts or tool
   contents.

Fairness
--------
This is a generic protocol compatibility repair. It does not change prompts,
detect task IDs, provide task hints, choose tools, alter generated files, or
change grading.

Safe order
----------
1. Ensure the full run is stopped.
2. Stop Adapter v0.1.2.
3. Install v0.1.3.
4. Restart Adapter.
5. Run the existing web-search canary.
6. Run the long-write wire canary.
7. Prepare the three validated failures for resume.
8. Resume the original full run.
