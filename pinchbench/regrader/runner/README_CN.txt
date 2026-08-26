PinchBench 四 Agent 冻结产物重评分包 v1
==========================================

输入
----
四套已验证 READY 的正式运行：

Codex
    C:\pinchbench-codex\runs\codex_20260727_174711

Qwen Code
    C:\pinchbench-qwen-code\runs\qwen_code_20260724_175038

OpenCode
    C:\pinchbench-opencode\runs\opencode_20260724_094110

CCB
    C:\pinchbench-ccb\runs\ccb_20260722_151353

固定 PinchBench：
    commit 819384ae830492365b8363fc26bc2602e73f216d
    manifest SHA256
    1aa459555d14c9ad48971e9a20bc10a7f63cbdae127f59677dd2796eac5c13ec

旧 Judge：
    openrouter/anthropic/claude-haiku-4.5

新 Judge：
    openrouter/anthropic/claude-opus-5

只变化的评分参数
----------------
只把 grade_task 的 judge_model 从旧 Judge 换成新 Judge。

保持不变：
- 同一 tasks/manifest.yaml
- 同一 task Markdown
- 同一 rubric
- 同一 automated checks
- 同一 hybrid 权重
- 同一 scripts/lib_grading.py
- judge_backend="api"
- worker=1
- 串行评分
- 原始执行状态、输出、workspace、transcript
- 分数归一化与 0-1 截断方式

防止旧分锚定：
重评分前会从 execution_result 删除：
- score
- breakdown
- grade_notes
- grade_error
以及所有 regrade_* 字段。

原始目录保护
------------
原始 run 始终只读。

每个任务会：
1. 对源 workspace 做完整 SHA-256 树哈希；
2. 使用 copy2 复制到重评分 scratch；
3. 验证复制前后哈希、文件数、字节数一致；
4. 只对 scratch 调用官方 grader；
5. 完成后删除 scratch。

一个 Key 即可
-------------
重评分只需要一个：
    OPENROUTER_API_KEY

四套 Agent 不会重新执行，所以不需要 Agent Key。
同一把 OpenRouter Key 用于全部 Opus 5 Judge 调用。

安装
----
powershell.exe `
  -NoProfile `
  -ExecutionPolicy Bypass `
  -File ".\00_install_regrader.ps1"

安装到：
    C:\pinchbench-regrader

输出到：
    C:\pinchbench-regrades

预检
----
不会调用模型、不会产生费用：

powershell.exe `
  -NoProfile `
  -ExecutionPolicy Bypass `
  -File "C:\pinchbench-regrader\01_preflight_regrade.ps1"

预检必须验证：
- 一个 OpenRouter Key 已设置；
- 四套结果均为 143 项；
- 四套 task set 一致；
- 四套 workspace 完整；
- commit 匹配；
- manifest SHA-256 匹配；
- 官方 lib_grading.py 可导入；
- grade_task 接口含 judge_model 等参数；
- 正式任务为 143 项。

冒烟
----
冒烟共 12 个 job：
    3 种评分类型 x 4 Agent

任务：
    task_sanity                 automated
    task_iterative_code_refine  hybrid
    task_summary                llm_judge

执行：

powershell.exe `
  -NoProfile `
  -ExecutionPolicy Bypass `
  -File "C:\pinchbench-regrader\02_run_regrade_smoke.ps1"

监控
----
另开 PowerShell：

powershell.exe `
  -NoProfile `
  -ExecutionPolicy Bypass `
  -File "C:\pinchbench-regrader\03_monitor_regrade.ps1"

Ctrl+C 只停止监控，不停止重评分。

正式全量
--------
冒烟通过后：

powershell.exe `
  -NoProfile `
  -ExecutionPolicy Bypass `
  -File "C:\pinchbench-regrader\04_run_regrade_full.ps1"

正式总量：
    4 x 143 = 572 job

其中：
    automated 100 job
    hybrid + llm_judge 472 job

只有 472 个 job 会调用 Opus 5。

优雅停止
--------
另开 PowerShell：

powershell.exe `
  -NoProfile `
  -ExecutionPolicy Bypass `
  -File "C:\pinchbench-regrader\06_stop_regrade.ps1"

当前任务会完成并落盘，然后不再领取下一题。
不会丢失已经完成的分数。

恢复
----
继续最新正式任务：

powershell.exe `
  -NoProfile `
  -ExecutionPolicy Bypass `
  -File "C:\pinchbench-regrader\05_resume_regrade.ps1"

失败任务也重新进入队列：

powershell.exe `
  -NoProfile `
  -ExecutionPolicy Bypass `
  -File "C:\pinchbench-regrader\05_resume_regrade.ps1" `
  -RetryFailed

默认不自动反复重试失败任务，避免重复计费和改变旧脚本口径。

如何换 Judge
------------
默认、推荐且正式使用：

    openrouter/anthropic/claude-opus-5

三个关键脚本都接受同一个参数：

    -JudgeModel "openrouter/anthropic/claude-opus-5"

例如：

powershell.exe `
  -NoProfile `
  -ExecutionPolicy Bypass `
  -File "C:\pinchbench-regrader\04_run_regrade_full.ps1" `
  -JudgeModel "openrouter/anthropic/claude-opus-5"

正式全量启动后，Judge 模型冻结在该次 run_config.json 中。
恢复时不会读取新的命令行模型，也不会中途换模型。

状态与断点
----------
每次运行目录：

C:\pinchbench-regrades\regrade_YYYYMMDD_HHMMSS\
    run_config.json
    state.sqlite
    heartbeat.json
    progress.jsonl
    results.partial.json
    summary.json
    task_results\
    worker_logs\
    scratch\
    exports\

每题由独立 Python 子进程评分，具备：
- Judge timeout 300 秒；
- 整题硬超时 480 秒；
- 每 5 秒主进程心跳；
- 子进程树超时终止；
- SQLite 事务状态；
- 每题 JSON 结果；
- stdout/stderr；
- 中断后 running 自动恢复为 pending。

导出
----
正常全量结束会自动导出。

手工重新导出：

powershell.exe `
  -NoProfile `
  -ExecutionPolicy Bypass `
  -File "C:\pinchbench-regrader\07_finalize_regrade.ps1"

输出包括：
- 四份 regraded_results.json
- 四份 regraded_results.csv
- 四份 regraded_results.xlsx
- four_agent_comparison.json
- four_agent_summary.csv
- four_agent_task_matrix.csv
- four_agent_regrade_comparison.xlsx

这些是最终四份独立报告和横向对比报告的结构化数据源。
正式 DOCX/PDF 报告在全量数据 QA 后生成，避免在评分尚未完成时固化错误数字。

打包结果
--------
powershell.exe `
  -NoProfile `
  -ExecutionPolicy Bypass `
  -File "C:\pinchbench-regrader\08_bundle_regrade_results.ps1"

桌面生成：
    pinchbench-opus5-regrade-results-日期时间.zip

上传该 ZIP 后生成：
- 4 份独立 DOCX
- 4 份独立 PDF
- 4 份独立 XLSX 的最终美化版
- 1 份四 Agent 对比 DOCX
- 1 份四 Agent 对比 PDF
- 1 份四 Agent 对比 XLSX
