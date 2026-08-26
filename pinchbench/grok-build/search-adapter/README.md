# Grok Build Search Adapter v0.1.0

This is a narrow compatibility layer for the observed Grok Build/OpenRouter
web-search incompatibility.

It fixes:

- Grok Build web-search subcalls selecting `grok-4.5`;
- OpenRouter streaming `openrouter:web_search`;
- explicitly disabled reasoning fields on reasoning-mandatory endpoints.

It does not modify PinchBench Runner files.

Order:

1. Run `00_install.ps1`.
2. Window A: run `01_start_search_adapter.ps1`.
3. Window B: run `02_configure_grok_build_for_adapter.ps1`.
4. Window B: run `03_run_web_search_adapter_canary.ps1`.
5. If the canary fails, run `04_collect_adapter_evidence.ps1` and upload the ZIP.
