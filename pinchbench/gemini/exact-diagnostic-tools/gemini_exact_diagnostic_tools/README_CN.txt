此包基于用户上传的当前真实脚本制作。

它不会修改：
- run_pinchbench_gemini_windows.py
- gemini_openrouter_adapter.py
- 03_run_gemini_network_fix_canary.ps1
- 05_run_gemini_full.ps1

只新增：
1. 03b_run_gemini_events_language_canary.ps1
   只运行 task_events，判断最终回复是否含日文假名。
2. Collect_Current_Gemini_V13_Deep_Canary.ps1
   只打包最新 v1.3 canary 的 task_deep_research 证据。

当前上传脚本中，英文环境变量已经存在于 Python Runner 和 Adapter v1.3 启动脚本。
原始 v1.3 canary 判定保持不变；deep research 没有生成 wasm_research.md 时仍应失败。
