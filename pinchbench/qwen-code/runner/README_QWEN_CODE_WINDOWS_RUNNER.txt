PinchBench Qwen Code Windows runner bundle

Place all three scripts in:
  C:\pinchbench-qwen-code\runner

Files:
  run_pinchbench_qwen_code_windows.py
  run_qwen_code_smoke.ps1
  monitor_pinchbench_qwen_code_windows.ps1

Python environment reused from validated OpenCode run:
  C:\pinchbench-opencode\.venv\Scripts\python.exe

Pinned Qwen Code command:
  C:\pinchbench-qwen-code\qwen-cli\node_modules\.bin\qwen.cmd

Two-task smoke:
  powershell -ExecutionPolicy Bypass -File C:\pinchbench-qwen-code\runner\run_qwen_code_smoke.ps1

Monitor (second PowerShell window):
  powershell -ExecutionPolicy Bypass -File C:\pinchbench-qwen-code\runner\monitor_pinchbench_qwen_code_windows.ps1
