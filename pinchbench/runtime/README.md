# PinchBench Shared Runtime

Reproducible Windows Python runtime used by the PinchBench agent benchmark runners in this repository.

The virtual environment itself is intentionally not committed. The validated dependency lock and environment manifests are stored here so the runtime can be rebuilt on another Windows machine.

## Validated benchmark revision

PinchBench commit: `819384ae830492365b8363fc26bc2602e73f216d`

## Runtime location

The setup script creates the shared environment at `C:\pinchbench-runtime`.

## Install

`powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup_runtime.ps1`

## Verify

`powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify_runtime.ps1`

## Security

Do not commit API keys, credentials, `.venv`, benchmark runs, transcripts, workspaces, judge responses, caches, or logs.
