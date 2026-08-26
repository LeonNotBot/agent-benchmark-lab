PinchBench Qwen Code Windows Runner - fixed package

Fix in this package:
- PowerShell scripts are encoded as UTF-8 with BOM and CRLF.
- This is required for reliable parsing by Windows PowerShell 5.1 when scripts contain Chinese text.
- The Python runner content is unchanged and remains UTF-8.

Expected locations:
C:\pinchbench-qwen-code\runner\run_pinchbench_qwen_code_windows.py
C:\pinchbench-qwen-code\runner\run_qwen_code_smoke.ps1
C:\pinchbench-qwen-code\runner\monitor_pinchbench_qwen_code_windows.ps1
