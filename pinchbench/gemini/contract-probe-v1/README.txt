Gemini CLI local API contract probe v1
======================================

This captures the exact API paths, payload structure, tool declarations, and
headless stream-json behavior used by the installed Gemini CLI.

No Google key is required. No OpenRouter request is made. A dummy local key is
used only to select API-key authentication.

Run order:
1. Window A: 01_start_contract_probe.ps1
2. Window B: 02_run_contract_probe.ps1
3. Window B: 03_summarize_contract_probe.ps1
4. Stop window A with Ctrl+C
5. Optional: 04_bundle_contract_probe.ps1
