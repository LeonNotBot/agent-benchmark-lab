Grok Build Full Runner Adapter Gate v0.1.3
================================================

The previous gate patch changed only:
    runner\common_grok_build_runner.ps1

The actual benchmark preflight is also implemented in:
    runner\run_pinchbench_grok_build_windows.py

That Python file still contained:
    DEFAULT_ADAPTER_VERSION = "0.1.2"
    RUNNER_REVISION = "...search-adapter-0.1.2"

This patch updates both active preflight layers:
- PowerShell common gate: 0.1.3
- Python DEFAULT_ADAPTER_VERSION: 0.1.3
- Python revision label: v1.0.1-search-adapter-0.1.3

It preserves:
- model deepseek/deepseek-v4-pro;
- Adapter URL;
- task progress, workspaces, transcripts and Judge data;
- all execution and grading behavior.

The installer backs up both active Runner files, compiles the Python Runner,
imports and verifies its constants, and runs the live PowerShell Adapter gate.

The three failed rows were already safely removed and backed up. Do not run the
three-task cleanup script again. Resume directly after installation.
