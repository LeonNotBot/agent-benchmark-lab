Gemini Adapter v1.3 修复包

修复内容：
1. Gemini 原生 googleSearch/urlContext 映射到 OpenRouter server tools。
2. OpenRouter web search 固定 Exa、每次最多 1 次搜索、5 个结果，减少单次搜索阻塞。
3. max_output_tokens 固定为 32768，避免长 write_file 参数被输出上限截断。
4. 流式 function_call 参数合并时保留完整 JSON，不让较短 terminal 参数覆盖完整 delta。
5. 上游仍返回损坏工具参数时改为明确 502，让 Gemini CLI 重试，不再执行缺少 file_path 的伪工具调用。
6. 捕获客户端停止后的 WinError 10053/10054，不再打印整段 traceback。

验证顺序：
A. 所有旧窗口保持关闭。
B. 运行 00_install_gemini_adapter_v1_3_fix.ps1。
C. Window A 使用 02_start_gemini_adapter_v1_3.ps1。
D. Window B 先运行现有 01_preflight_gemini.ps1，并显式传 JudgeModel。
E. Window B 运行 03_run_gemini_network_fix_canary.ps1。
F. 三题 canary 通过且没有 malformed_tool_arguments 后，才重新从头跑 143 题。

注意：
- 旧中断运行不能作为正式结果，也不能和 v1.3 新结果拼接。
- 正式超时仍保持联网任务 300 秒，Judge 300 秒。
- OpenRouter web search 会产生额外搜索费用。
- 本包完成了 Python 编译和合成流事件测试；真实 OpenRouter/Gemini 联网验证必须在你的 Windows 环境运行。
