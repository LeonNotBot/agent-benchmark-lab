PinchBench 四 Agent 重评分原始数据只读检查器
================================================

用途
----
检查 Codex、Qwen Code、OpenCode、CCB 的冻结运行目录是否具备重新评分所需的：
- results.json
- run_config.json
- workspaces / workspace
- transcripts / transcript
- 143 个任务 ID
- 固定 PinchBench commit
- 跨运行任务集合一致性

只读保证
--------
检查器不会写入、修改、重命名或删除任何原始 run 文件。
所有输出只写入：
    C:\pinchbench-regrade-readiness

快速检查
--------
powershell.exe `
  -NoProfile `
  -ExecutionPolicy Bypass `
  -File ".\run_readiness_check.ps1"

完整哈希
--------
快速检查确认目录正确后再运行：

powershell.exe `
  -NoProfile `
  -ExecutionPolicy Bypass `
  -File ".\run_readiness_check.ps1" `
  -Mode full-hash

完整哈希会读取大量 workspace/transcript 文件，耗时明显更长。
它默认排除 .venv、node_modules、.git 等依赖或缓存目录。

自动发现
--------
Codex 与 Qwen Code 已写入已知正式路径。
OpenCode 与 CCB 默认扫描各自 runs 目录，选择：
1. results.json 可解析；
2. 任务数为 143；
3. workspaces 和 transcripts 存在；
4. 必需结果文件最完整；
5. 候选分最高
的运行目录。

检查器不会静默隐藏其他候选。所有候选会写入 candidate_runs.csv。
确认后可编辑 regrade_runs.json，把正确目录填入 preferred_path。

状态解释
--------
READY
    143 项、workspace 覆盖 >=95%、transcript 覆盖 >=90%、commit 匹配。

READY_WITH_WARNINGS
    基本可重评分，但 transcript、commit 字段或少量证据有警告。

INCOMPLETE
    任务数不对、results 不可解析，或 workspace 覆盖不足 85%。

NOT_FOUND
    没有找到候选运行目录。

主要输出
--------
readiness_report.html
    人工查看的总报告。

readiness_summary.json / run_readiness.csv
    四套运行的机器可读汇总。

candidate_runs.csv
    所有自动发现的候选目录及选择结果。

task_coverage.csv
    每个 Agent、每个 task 的 workspace/transcript 覆盖情况。

cross_run_consistency.json
    四套任务 ID 集合是否完全一致。

warnings.txt
    每套运行的警告与错误。

hash_manifests\*.csv
    仅 full-hash 模式生成。

退出码
------
0  全部 READY
2  检查完成，但有警告或任务集合不完全一致
3  至少一套 INCOMPLETE / NOT_FOUND
1  检查器自身错误


打包检查结果
------------
powershell.exe `
  -NoProfile `
  -ExecutionPolicy Bypass `
  -File ".\package_readiness_results.ps1"

桌面会生成：
    pinchbench-regrade-readiness-日期时间.zip
