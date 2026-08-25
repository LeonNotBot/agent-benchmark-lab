# CCB + DeepSeek V4 Pro · PinchBench（Windows Native）

本目录保存 **CCB + OpenRouter + DeepSeek V4 Pro** 在 Windows 原生环境下运行 PinchBench 的最终 Runner、冒烟测试与复现说明。

> **重要：本仓库统一使用 Claude Opus 5 作为 PinchBench Judge。**
>
> **固定 Judge：`openrouter/anthropic/claude-opus-5`**
>
> 旧版 `README_CCB_v1_1` 中记录的 `openrouter/anthropic/claude-haiku-4.5` 已不再作为本仓库的正式评分口径。正式运行、上传代码和横向比较前，都必须确认实际 Judge 已改为 Claude Opus 5。

推荐综合仓库结构：

```text
agent-benchmark-lab/
└─ pinchbench/
   └─ ccb/
      ├─ README.md
      ├─ .gitignore
      └─ runner/
         ├─ run_pinchbench_ccb_windows.py
         └─ smoke_pinchbench_ccb_windows.ps1
```

也可以作为个人独立仓库：

```text
CCB-PinchBench/
├─ README.md
├─ .gitignore
└─ runner/
   ├─ run_pinchbench_ccb_windows.py
   └─ smoke_pinchbench_ccb_windows.ps1
```

## 1. 仓库范围

推荐提交：

```text
README.md
.gitignore
runner/run_pinchbench_ccb_windows.py
runner/smoke_pinchbench_ccb_windows.ps1
```

不推荐提交：

```text
.venv/
canary/
ccb-profile/
environment/
logs/
runs/
skill/
__pycache__/
新建文件夹/
*.pyc
*.zip
*.log
*.backup*
*.2026*
SHA256SUMS.txt
```

说明：`runs/`、`logs/`、`canary/` 是运行产物；`.venv/` 是本机虚拟环境；`skill/` 是固定 commit 的 PinchBench 上游 checkout；`ccb-profile/` 可能包含本机 CCB 配置；Runner 目录中的日期备份、backup 文件属于历史快照，不上传。原 `SHA256SUMS.txt` 对应旧包，修改 Judge 或 README 后哈希已经失效，除非重新生成，否则不应继续提交。

## 2. 被测 Agent 与评分 Agent

本 benchmark 有两条独立模型链路：

```text
被测 Agent:
CCB -> deepseek/deepseek-v4-pro

评分 Agent / Judge:
PinchBench -> openrouter/anthropic/claude-opus-5
```

固定配置：

| 项目 | 固定值 |
|---|---|
| 被测框架 | CCB |
| 被测模型 | `deepseek/deepseek-v4-pro` |
| 被测模型 Provider | OpenRouter |
| **评分 Agent / Judge** | **`openrouter/anthropic/claude-opus-5`** |
| Judge backend | API / OpenRouter |
| Judge concurrency | 1 |
| CCB version | `2.8.4` |
| PinchBench commit | `819384ae830492365b8363fc26bc2602e73f216d` |
| Worker | 1 |
| Task concurrency | 1 |
| 非联网 timeout | `task.timeout_seconds × 3` |
| 联网 timeout | `300 s` |

### Judge 迁移说明

旧版 CCB v1.1 使用：

```text
openrouter/anthropic/claude-haiku-4.5
```

本仓库正式统一为：

```text
openrouter/anthropic/claude-opus-5
```

因此，任何仍会生效的 `claude-haiku-4.5` 配置都必须在正式跑分前处理。不能仅依赖“默认 Judge model”这种模糊描述。

正式运行前至少确认：

```text
Judge backend: api
Judge model: openrouter/anthropic/claude-opus-5
Judge concurrency: 1
```

如果 Runner 支持 `--judge-model`，应显式传入：

```text
--judge-model "openrouter/anthropic/claude-opus-5"
```

如果 Runner 没有该参数，则必须在 Runner / grading 配置层固定 Claude Opus 5，并通过 `run_config.json` 或 grading 日志核验。

## 3. 检查旧 Judge 残留

检查最终 Runner 与 smoke：

```powershell
Select-String -Path "C:\pinchbench-ccb\runner\run_pinchbench_ccb_windows.py","C:\pinchbench-ccb\runner\smoke_pinchbench_ccb_windows.ps1" -Pattern "claude-haiku-4\.5|claude-opus-5|judge-model|judge_model|DEFAULT_JUDGE" -CaseSensitive:$false | Select-Object Path,LineNumber,Line
```

检查 PinchBench grading：

```powershell
Select-String -Path "C:\pinchbench-ccb\skill\scripts\lib_grading.py" -Pattern "claude-haiku-4\.5|claude-opus-5|judge-model|judge_model|DEFAULT_JUDGE" -CaseSensitive:$false | Select-Object Path,LineNumber,Line
```

最终目标必须是：

```text
openrouter/anthropic/claude-opus-5
```

## 4. PowerShell 环境

UTF-8：

```powershell
$env:PYTHONUTF8="1"; $env:PYTHONIOENCODING="utf-8"
```

安全设置 OpenRouter Key：

```powershell
$sec=Read-Host "Paste OpenRouter API Key" -AsSecureString; $env:OPENROUTER_API_KEY=[System.Net.NetworkCredential]::new("",$sec).Password; Remove-Variable sec; Write-Host "OPENROUTER_API_KEY set: $(-not [string]::IsNullOrWhiteSpace($env:OPENROUTER_API_KEY))"
```

旧版 CCB 适配中，被测 Agent 路径可能使用 `ANTHROPIC_AUTH_TOKEN`，并由 smoke / runner 从 `OPENROUTER_API_KEY` 做适配。不要把真实 Key 写入代码、README、配置、日志、ZIP 或 Git 历史。

## 5. Proxy / Mihomo / Clash

原测试机器曾使用：

```text
http://127.0.0.1:10090
```

该端口只是原机器上的 Mihomo/mixed-port，不是 CCB 或 PinchBench 的固定要求。

需要代理时替换为当前机器实际端口：

```powershell
$env:HTTP_PROXY="http://127.0.0.1:<PORT>"; $env:HTTPS_PROXY="http://127.0.0.1:<PORT>"; $env:ALL_PROXY="http://127.0.0.1:<PORT>"; $env:NO_PROXY="localhost,127.0.0.1,::1"
```

## 6. PinchBench 固定 commit

本次基准 commit：

```text
819384ae830492365b8363fc26bc2602e73f216d
```

确认：

```powershell
git -C "C:\pinchbench-ccb\skill" rev-parse HEAD
```

## 7. Smoke test

```powershell
& "C:\pinchbench-ccb\runner\smoke_pinchbench_ccb_windows.ps1" -Root "C:\pinchbench-ccb" -Proxy "http://127.0.0.1:<PORT>" -Model "deepseek/deepseek-v4-pro" -ExpectedCcbVersion "2.8.4"
```

Smoke 结束后必须检查最新 `run_config.json`：

```text
tested model = deepseek/deepseek-v4-pro
judge model  = openrouter/anthropic/claude-opus-5
```

如果仍显示：

```text
openrouter/anthropic/claude-haiku-4.5
```

该 run 不应作为本轮正式横向比较结果。

## 8. Formal 143-task run

先确认 Runner 是否支持显式 Judge 参数：

```powershell
C:\pinchbench-ccb\.venv\Scripts\python.exe "C:\pinchbench-ccb\runner\run_pinchbench_ccb_windows.py" --help
```

重点查 `--judge-model` 和 `--judge-timeout`。

如果支持 `--judge-model`，正式运行应显式指定：

```powershell
$Root="C:\pinchbench-ccb"; $Python="$Root\.venv\Scripts\python.exe"; $Runner="$Root\runner\run_pinchbench_ccb_windows.py"; & $Python $Runner --skill-dir "$Root\skill" --model "deepseek/deepseek-v4-pro" --suite all --judge-model "openrouter/anthropic/claude-opus-5" --results-dir "$Root\runs" --keep-workspaces --clear-judge-cache
```

如果不支持该参数，不要直接加入未知参数；应先确认 Runner / grading 配置最终实际使用 Claude Opus 5，再运行原正式命令：

```powershell
$Root="C:\pinchbench-ccb"; $Python="$Root\.venv\Scripts\python.exe"; $Runner="$Root\runner\run_pinchbench_ccb_windows.py"; & $Python $Runner --skill-dir "$Root\skill" --model "deepseek/deepseek-v4-pro" --suite all --results-dir "$Root\runs" --keep-workspaces --clear-judge-cache
```

正式比较不要使用：

```text
--limit
--skip-network
--no-grade
--allow-version-mismatch
--allow-key-mismatch
```

## 9. Judge 验收

每次正式 run 都要检查：

```text
被测模型 = deepseek/deepseek-v4-pro
Judge    = openrouter/anthropic/claude-opus-5
```

如果 Judge 仍为 `claude-haiku-4.5`，该结果不能与已经使用 Claude Opus 5 Judge 的其他 Agent 直接横向比较。

## 10. 推荐 `.gitignore`

```gitignore
.venv/
venv/
__pycache__/
*.pyc
*.pyo

canary/
ccb-profile/
environment/
logs/
runs/
results/
skill/

*.zip
*.log
*.backup*
*.2026*

.env
.env.*
*secret*
*credentials*
*api_key*

results.json
results.csv
results.xlsx
progress.jsonl
results.partial.json

transcripts/
workspaces/
```

## 11. 上传前检查

检查真实 API Key：

```powershell
Get-ChildItem . -Recurse -File | Select-String -Pattern "sk-or-v1-[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9_-]{20,}" -CaseSensitive:$false | Select-Object Path,LineNumber,Line
```

检查旧 Judge：

```powershell
Get-ChildItem . -Recurse -File | Select-String -Pattern "claude-haiku-4\.5" -CaseSensitive:$false | Select-Object Path,LineNumber,Line
```

检查新 Judge：

```powershell
Get-ChildItem . -Recurse -File | Select-String -Pattern "claude-opus-5" -CaseSensitive:$false | Select-Object Path,LineNumber,Line
```

正式固定：

```text
openrouter/anthropic/claude-opus-5
```

## 12. 复现原则

本项目真正需要固定的是：

```text
CCB version
DeepSeek model
PinchBench commit
Runner
timeout policy
workspace policy
Judge model
```

其中 Judge 是横向比较关键变量：

```text
openrouter/anthropic/claude-opus-5
```

旧版：

```text
openrouter/anthropic/claude-haiku-4.5
```

只作为历史记录，不与本轮正式结果混用。
