PinchBench Gemini CLI + DeepSeek V4 Pro Windows Runner v1
============================================================

状态
----
Gemini CLI 0.52.0 + Adapter 1.2.0 已通过：
- 自定义模型协议
- 文本响应
- UTF-8 文件写入/读取
- Windows Shell
- 16,000+ 字符、250+ 行长写入
- 工具调用往返
- Session 首轮与 --resume

因此本包进入 PinchBench Runner 集成阶段。

固定比较口径
------------
被测模型：
    deepseek/deepseek-v4-pro

PinchBench commit：
    819384ae830492365b8363fc26bc2602e73f216d

Manifest SHA-256：
    38d7cd1bddfa5e9fefc7b6945c91955f36dc5c88c32c994bf8676344b1069a7b

任务：
    143 项，默认排除 4 项外部 integration

执行：
    worker=1
    task_concurrency=1
    普通任务 timeout_seconds × 3
    联网任务 300 秒
    UTF-8 stdin 传 Prompt
    Gemini stream-json
    每个普通任务新 session
    多轮任务使用 --resume

评分：
    原 PinchBench scripts/lib_grading.py
    原 task rubric
    原 automated checks
    原 hybrid 权重与总分合成
    judge_backend=api
    同步并发 1

默认新 Judge：
    openrouter/anthropic/claude-opus-5

关键 Key 关系
--------------
Window A：
    需要 OPENROUTER_API_KEY。
    Adapter 用它调用被测模型 DeepSeek V4 Pro。

Window B：
    也需要 OPENROUTER_API_KEY。
    Runner 用它直接调用 PinchBench Judge。

两边可以使用同一把 OpenRouter Key，不需要两把。

Runner 启动 Gemini CLI 子进程时会主动删除真实的
OPENROUTER_API_KEY，只向 Gemini CLI 提供本地 GEMINI_API_KEY
占位符和 localhost Adapter URL。因此 Judge Key 不会泄露给被测 Agent。

安装
----
解压后执行：

powershell.exe `
  -NoProfile `
  -ExecutionPolicy Bypass `
  -File ".\00_install_gemini_runner.ps1"

安装到：
    C:\pinchbench-gemini\runner

不会修改：
- adapter-v1
- gemini-home
- skill
- 既有 runs

Window A：启动 Adapter
----------------------
先在窗口 A 设置真实 Key，然后：

powershell.exe `
  -NoProfile `
  -ExecutionPolicy Bypass `
  -File "C:\pinchbench-gemini\runner\02_start_gemini_adapter_v1_2.ps1"

保持窗口 A 打开。

Window B：预检
--------------
窗口 B 也设置同一把真实 Key，然后：

powershell.exe `
  -NoProfile `
  -ExecutionPolicy Bypass `
  -File "C:\pinchbench-gemini\runner\01_preflight_gemini.ps1"

预检检查：
- Gemini CLI 精确版本 0.52.0
- Adapter 精确版本 1.2.0
- heartbeat_stream
- deepseek/deepseek-v4-pro
- PinchBench commit 与 manifest
- 143 项任务和 fixtures
- 官方 grader 可导入
- Judge Key
- 无 GEMINI.md 注入
- localhost Adapter 隔离

Window B：3 项冒烟
------------------
冒烟任务：
- task_sanity
- task_iterative_code_refine
- task_stock

覆盖：
- 本地文件与自动评分
- Agent 工具调用与 Hybrid/Judge
- 联网任务
- JSON/CSV/XLSX/progress/transcript/workspace

执行：

powershell.exe `
  -NoProfile `
  -ExecutionPolicy Bypass `
  -File "C:\pinchbench-gemini\runner\03_run_gemini_smoke.ps1"

Window C：监控
-------------
powershell.exe `
  -NoProfile `
  -ExecutionPolicy Bypass `
  -File "C:\pinchbench-gemini\runner\04_monitor_pinchbench_gemini_windows.ps1"

Ctrl+C 只停止监控，不停止 Runner 或 Adapter。

正式 143 项全量
---------------
确认冒烟：
- 3/3 完成
- 评分链路无异常
- model 一致
- workspace/transcript 存在
- results.xlsx 正常

再执行：

powershell.exe `
  -NoProfile `
  -ExecutionPolicy Bypass `
  -File "C:\pinchbench-gemini\runner\05_run_gemini_full.ps1"

正式脚本不会：
- clear Judge cache
- limit
- skip-network
- no-grade
- 修改 Prompt
- 添加 GEMINI.md
- 增加整题重试

如何更换 Judge 模型
-------------------
推荐且默认：

    openrouter/anthropic/claude-opus-5

不需要编辑 Python。给预检、冒烟和全量脚本传同一个参数：

powershell.exe `
  -NoProfile `
  -ExecutionPolicy Bypass `
  -File "C:\pinchbench-gemini\runner\01_preflight_gemini.ps1" `
  -JudgeModel "openrouter/anthropic/claude-opus-5"

powershell.exe `
  -NoProfile `
  -ExecutionPolicy Bypass `
  -File "C:\pinchbench-gemini\runner\03_run_gemini_smoke.ps1" `
  -JudgeModel "openrouter/anthropic/claude-opus-5"

powershell.exe `
  -NoProfile `
  -ExecutionPolicy Bypass `
  -File "C:\pinchbench-gemini\runner\05_run_gemini_full.ps1" `
  -JudgeModel "openrouter/anthropic/claude-opus-5"

旧历史 Judge 为：

    openrouter/anthropic/claude-haiku-4.5

只有需要复现旧正式口径时才传旧模型。新的 Gemini、Grok 以及四套
历史结果重评分，应统一使用相同的 Opus 5 字符串。

也可直接运行 Python：

    --judge-model "openrouter/anthropic/claude-opus-5"

Judge 模型会写入 run_config.json。Judge cache 按模型名分目录，避免
Haiku 与 Opus 的缓存混用。

结果目录
--------
每次创建：

C:\pinchbench-gemini\runs\gemini_YYYYMMDD_HHMMSS\
    run_config.json
    progress.jsonl
    results.partial.json
    results.json
    results.csv
    results.xlsx
    workspaces\
    transcripts\

诊断打包
--------
默认包含结果、全部 transcript、Adapter 日志与 Runner，不复制体积较大的
workspaces：

powershell.exe `
  -NoProfile `
  -ExecutionPolicy Bypass `
  -File "C:\pinchbench-gemini\runner\06_bundle_gemini_run_diagnostic.ps1"

需要连 workspace 一起打包时：

powershell.exe `
  -NoProfile `
  -ExecutionPolicy Bypass `
  -File "C:\pinchbench-gemini\runner\06_bundle_gemini_run_diagnostic.ps1" `
  -IncludeWorkspaces

桌面生成：
    gemini-pinchbench-diagnostic-日期时间.zip
