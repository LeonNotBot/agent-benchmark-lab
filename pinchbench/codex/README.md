# Codex + DeepSeek V4 Pro · PinchBench（Windows Native）

本目录保存 **Codex CLI + OpenRouter + DeepSeek V4 Pro** 在 Windows 原生环境下运行 PinchBench 的可复现 Runner、冒烟测试、编码验证与监控脚本。

推荐的综合仓库位置：

```text
agent-benchmark-lab/
└─ pinchbench/
   └─ codex/
      ├─ README.md
      ├─ .gitignore
      └─ runner/
```

也可以作为独立仓库：

```text
Codex-PinchBench/
├─ README.md
├─ .gitignore
└─ runner/
```

---

## 1. 仓库范围

本仓库只保存需要长期版本管理的 **最终 Runner 与复现说明**。

推荐提交：

```text
README.md
.gitignore
runner/
├─ run_pinchbench_codex_windows.py
├─ run_codex_smoke.ps1
├─ run_codex_encoding_validation.ps1
└─ monitor_pinchbench_codex_windows.ps1
```

不推荐提交：

```text
.venv/
runs/
logs/
skill/
codex-cli/
codex-home/
environment/
preflight/
preflight-tools/
__pycache__/
*.pyc
*.zip
*.before-*
```

本机 `runner/` 中可能还保留以下历史修复快照或中间版本：

```text
ascii-runner-v1/
encoding-fix-v3_2/
long-write-fix-v2/
metadata-fix-v1/
stable-fix-v3/
transport-recovery-v1/
run_pinchbench_codex_windows.pre_encoding_fix
run_pinchbench_codex_windows.py.before-*
```

这些属于开发/修复过程中的历史快照，不作为本次推荐的最终源码上传内容。最终可复现版本以：

```text
runner/run_pinchbench_codex_windows.py
```

为准。

如果未来需要保留历史 patch，可以单独建立 `archive/` 或通过 Git commit/tag 保存，而不是与最终 Runner 混在运行目录中。

---

## 2. 固定评测配置

本版以已经验证过的 Windows PinchBench runner 可比性口径为基础，只替换 Codex Agent 适配层。

| 项目 | 固定值 |
|---|---|
| 平台 | Windows Native |
| Codex CLI | `0.145.0` |
| 被测模型 | `deepseek/deepseek-v4-pro` |
| **评分 Agent / Judge** | **`openrouter/anthropic/claude-opus-5`** |
| Model provider | `openrouter` |
| Wire API | `responses` |
| Approval policy | `never` |
| Sandbox mode | `workspace-write` |
| Windows sandbox | `unelevated` |
| Worker | 1 |
| Task concurrency | 1 |
| 非联网 timeout | `task.timeout_seconds × 3.0` |
| 联网 timeout | `300 s` |
| PinchBench commit | `819384ae830492365b8363fc26bc2602e73f216d` |

正式评测保持：

- 同一个 PinchBench commit、manifest、任务顺序与 fixtures；
- 默认排除约定的 4 个外部 integration tasks；
- 同一个 grader / Judge 口径；
- worker=1，任务串行执行；
- workspace staging 保持一致；
- Prompt 通过 UTF-8 stdin 文件传递；
- 保留 workspace、原始 JSONL、stderr、normalized transcript 和结果文件；
- 不为 Codex 增加自定义 system prompt、AGENTS.md、MCP、skills、hooks 或 memories；
- 不使用 `danger-full-access` 或绕过 sandbox 的模式。

---

## 3. 评分 Agent / Judge 固定口径（重要）

> **本次 Codex PinchBench 的评分 Agent 必须固定为 `Claude Opus 5`。**
>
> **Judge model：`openrouter/anthropic/claude-opus-5`**
>
> 不应使用其他 Claude 版本、DeepSeek、自身被测模型或 OpenRouter 默认自动选择的模型替代 Judge。

这里需要明确区分两类模型：

```text
被测 Agent:
Codex CLI + deepseek/deepseek-v4-pro

评分 Agent / Judge:
openrouter/anthropic/claude-opus-5
```

因此：

- `deepseek/deepseek-v4-pro` 是 **被测模型**；
- `openrouter/anthropic/claude-opus-5` 是 **评分模型**；
- 两者不能混用；
- 不同 Agent 横向比较时必须保持同一个 Judge；
- Judge backend、Judge model、Judge timeout 和同步单并发评分口径均应保持一致；
- 如果 Runner 支持显式 `--judge-model` 参数，应显式传入 `openrouter/anthropic/claude-opus-5`；
- 如果当前 Codex Runner 没有暴露 `--judge-model` 参数，则必须确认 PinchBench grading 配置/默认值最终解析到 `openrouter/anthropic/claude-opus-5`，并在 `run_config.json` 或评分日志中核验；
- **不能仅依赖“默认 Judge model”这类模糊描述作为最终复现依据。**

正式跑分前建议核验最终评分配置，确保结果中能够确认：

```text
Judge backend: api
Judge model: openrouter/anthropic/claude-opus-5
Judge concurrency: 1
```

如果实际 Runner 或 `lib_grading.py` 的默认 Judge 不是该模型，应先修改评分配置再正式跑分；否则该结果不应与采用 Claude Opus 5 Judge 的其他 Agent 直接横向比较。

---

## 4. 默认排除的 integration tasks

正式套件默认排除：

```text
task_gh_issue_triage
task_gws_email_triage
task_gws_cross_service
task_gws_task_management
```

---

## 5. Runner 文件说明

### `run_pinchbench_codex_windows.py`

Windows 原生 Codex PinchBench 主 Runner。

主要负责：

- 逐题调用 Codex CLI；
- 使用 `codex exec --json`；
- 固定模型和 Codex 运行配置；
- 检查 Codex version；
- 检查独立 `CODEX_HOME`；
- 控制 timeout；
- staging 隔离 workspace；
- 调用 PinchBench grader / Judge；
- 保存运行结果；
- 保存 Codex 原始 JSONL、stderr 和 normalized transcript；
- 记录 Token、工具调用、command failure、permission denial 等审计字段。

### `run_codex_smoke.ps1`

正式全量前的两题冒烟测试。

典型冒烟任务：

```text
task_sanity
task_iterative_code_refine
```

用于验证：

- Codex CLI；
- OpenRouter；
- workspace；
- grading；
- transcript；
- Windows sandbox；
- 整体执行链路。

### `run_codex_encoding_validation.ps1`

用于验证 Windows/UTF-8 编码链路，避免 prompt、console、JSONL 或结果文件因编码产生不可比问题。

### `monitor_pinchbench_codex_windows.ps1`

只读取 `progress.jsonl` 做实时监控，不修改 Agent、不终止任务、不改写结果。

---

## 6. Codex 配置要求

本地运行目录建议：

```text
C:\pinchbench-codex\
├─ codex-cli\
├─ codex-home\
│  └─ config.toml
├─ runner\
├─ skill\
├─ runs\
├─ logs\
└─ .venv\
```

`codex-home/config.toml` 不建议直接上传，因为 `CODEX_HOME` 可能包含机器相关或认证相关内容。

关键配置应保持为：

```toml
model = "deepseek/deepseek-v4-pro"
model_provider = "openrouter"
approval_policy = "never"
sandbox_mode = "workspace-write"
web_search = "live"

[sandbox_workspace_write]
network_access = true

[model_providers.openrouter]
base_url = "https://openrouter.ai/api/v1"
env_key = "OPENROUTER_API_KEY"
wire_api = "responses"

[memories]
generate_memories = false
use_memories = false

[features]
hooks = false
memories = false
remote_plugin = false

[windows]
sandbox = "unelevated"
```

Runner 应拒绝或视为不可比的配置包括：

- `CODEX_HOME` 下存在会改变行为的 `AGENTS.md` / `.rules`；
- provider 不是 OpenRouter；
- wire API 不是 `responses`；
- sandbox 不是 `workspace-write`；
- approval policy 不是 `never`；
- 启用了 MCP、memories、hooks 或 remote plugin；
- Codex CLI 版本不是 `0.145.0`。

不要把 `OPENROUTER_API_KEY` 写入 `config.toml`、Runner、日志或 Git 仓库。

---

## 7. PowerShell 环境

基础环境：

```powershell
$Root="C:\pinchbench-codex"; $env:CODEX_HOME="$Root\codex-home"; $env:PYTHONUTF8="1"; $env:PYTHONIOENCODING="utf-8"
```

API Key 建议只放在当前 PowerShell 会话：

```powershell
$sec=Read-Host "Paste OpenRouter API Key" -AsSecureString; $env:OPENROUTER_API_KEY=[System.Net.NetworkCredential]::new("",$sec).Password; Remove-Variable sec; Write-Host "OPENROUTER_API_KEY set: $(-not [string]::IsNullOrWhiteSpace($env:OPENROUTER_API_KEY))"
```

不要打印真实 Key。

---

## 8. Proxy / Mihomo / Clash 说明

原实验机器通过本地代理联网时使用过：

```text
http://127.0.0.1:10090
```

**10090 只是原测试机器上的 Mihomo/mixed-port，不是 Codex 或 PinchBench 的固定要求。**

如果当前机器需要代理，请替换为本机实际监听端口：

```powershell
$env:HTTP_PROXY="http://127.0.0.1:<PORT>"; $env:HTTPS_PROXY="http://127.0.0.1:<PORT>"; $env:ALL_PROXY="http://127.0.0.1:<PORT>"; $env:NO_PROXY="localhost,127.0.0.1,::1"
```

检查 Mihomo / Clash 等代理程序：

```powershell
Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -match "clash|mihomo|sing-box|v2ray|xray|nekoray|hiddify|shadowsocks|trojan" } | Select-Object ProcessName,Id,Path
```

检查监听端口：

```powershell
Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Select-Object LocalAddress,LocalPort,OwningProcess | Sort-Object LocalPort
```

不要把某台机器上的本地代理端口理解为 benchmark 的固定依赖。

---

## 9. PinchBench checkout

工作目录示例：

```powershell
$Root="C:\pinchbench-codex"
```

PinchBench baseline commit：

```text
819384ae830492365b8363fc26bc2602e73f216d
```

切换并确认：

```powershell
git -C "$Root\skill" checkout 819384ae830492365b8363fc26bc2602e73f216d; git -C "$Root\skill" rev-parse HEAD
```

---

## 10. Preflight

假设主 Runner 位于：

```text
C:\pinchbench-codex\runner\run_pinchbench_codex_windows.py
```

运行：

```powershell
$Root="C:\pinchbench-codex"; $Python="$Root\.venv\Scripts\python.exe"; $Runner="$Root\runner\run_pinchbench_codex_windows.py"; & $Python $Runner --skill-dir "$Root\skill" --codex "$Root\codex-cli\node_modules\.bin\codex.cmd" --expected-codex-version "0.145.0" --model "deepseek/deepseek-v4-pro" --suite all --preflight
```

预检主要检查：

- Codex version / config；
- fixtures；
- prerequisite；
- grader；
- Judge 所需 API Key；
- model / provider / sandbox / approval policy；
- 任务 manifest。

典型退出码：

```text
0  通过
2  Codex 环境或配置不符合
3  fixture 缺失
4  prerequisite 缺失
5  PinchBench grader 导入失败
6  Judge 需要 OPENROUTER_API_KEY，但环境变量缺失
```

---

## 11. 冒烟测试

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\pinchbench-codex\runner\run_codex_smoke.ps1"
```

冒烟测试通过后再正式跑全量。

---

## 12. 实时监控

另开 PowerShell：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\pinchbench-codex\runner\monitor_pinchbench_codex_windows.ps1"
```

监控脚本只读取进度，不影响 Agent。

---

## 13. 正式全量

> **正式运行前必须先确认 Judge = `openrouter/anthropic/claude-opus-5`。**
>
> 当前旧版说明中的正式命令只显式传入了 `--judge-timeout 300`，没有在文档命令中明确指定 Judge model。因此请不要把“未显式指定 Judge”理解为可以使用任意默认模型。最终评分口径必须核验为 Claude Opus 5。

```powershell
$Root="C:\pinchbench-codex"; $Python="$Root\.venv\Scripts\python.exe"; $Runner="$Root\runner\run_pinchbench_codex_windows.py"; $Codex="$Root\codex-cli\node_modules\.bin\codex.cmd"; & $Python $Runner --skill-dir "$Root\skill" --codex $Codex --expected-codex-version "0.145.0" --model "deepseek/deepseek-v4-pro" --approval-policy never --sandbox-mode workspace-write --windows-sandbox unelevated --suite all --timeout-multiplier 3.0 --network-timeout 300 --judge-timeout 300 --results-dir "$Root\runs" --keep-workspaces --verbose
```

正式全量不要随意加入：

```text
--clear-judge-cache
--limit
--skip-network
--no-grade
--no-workspace-instruction
--no-ignore-rules
```

除非所有横向比较 Agent 使用完全相同的选项。

---

## 14. 结果结构

每次正式运行在本地生成：

```text
runs\codex_YYYYMMDD_HHMMSS\
├─ run_config.json
├─ progress.jsonl
├─ results.partial.json
├─ results.json
├─ results.csv
├─ results.xlsx
├─ workspaces\
└─ transcripts\
   └─ <task_id>\
      ├─ turn_01_*.prompt.txt
      ├─ turn_01_*.jsonl
      ├─ turn_01_*.stderr.txt
      ├─ turn_01_*.final.txt
      ├─ normalized.jsonl
      └─ turn_results.json
```

这些是 benchmark 原始证据，不建议提交到源码 Git 仓库。

---

## 15. 核心结果字段

跨 Agent 比较时主要关注：

```text
task_id
grading_type
success
status
score
elapsed
ttft
input_tokens
output_tokens
reasoning_tokens
cache_read_tokens
cache_write_tokens
total_tokens
tool_errors
tool_call_count
workspace
transcript
grade_error
```

Codex 额外审计字段：

```text
item_error_count
fatal_error_count
command_failures
permission_denials
model_verification
model_metadata_warnings
approval_policies
sandbox_modes
windows_sandboxes
```

---

## 16. Codex 成功判定

整题执行成功需要同时满足：

- Codex 退出码为 0；
- JSONL 出现 `turn.started`；
- JSONL 出现 `turn.completed`；
- 存在最终 assistant message；
- config 模型与 `--model` 一致；
- 没有 `turn.failed` 或顶层 fatal error；
- 没有 timeout。

以下中间事件只记录，不自动把整题判失败：

- 某条 `command_execution` 为 `failed`；
- 某条 `command_execution` 为 `declined`；
- `item.completed` 中出现 error 警告；
- Codex 改用其他工具并最终正常完成。

这可以同时保留 Agent 的 Windows 工具重试信息，又避免把单个中间 command failure 错判成整题失败。

---

## 17. 已知 Windows 环境特征

前期 acceptance 已验证：

- Codex 进程、OpenRouter Responses API、JSONL 和 workspace 写入链路可工作；
- Windows sandbox 中部分 PowerShell / Schannel HTTPS 工具可能出现 TLS 问题；
- Agent 可能通过其他可用工具完成真实 HTTPS 请求；
- Runner 不应为了该问题向被测 Agent 注入特殊解决提示，否则会污染横向比较。

---

## 18. 推荐 `.gitignore`

```gitignore
.venv/
venv/
__pycache__/
*.pyc
*.pyo

runs/
logs/
results/
environment/
preflight/
preflight-tools/

codex-cli/
codex-home/
skill/

*.zip
*.log
*.before-*
*.pre_encoding_fix

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

---

## 19. 上传前安全检查

检查疑似 API Key：

```powershell
Get-ChildItem . -Recurse -File | Select-String -Pattern "sk-or-v1-[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9_-]{20,}" -CaseSensitive:$false | Select-Object Path,LineNumber,Line
```

检查本机路径和代理端口：

```powershell
Get-ChildItem . -Recurse -File | Select-String -Pattern "C:\\Users\\|127\.0\.0\.1:[0-9]+" | Select-Object Path,LineNumber,Line
```

历史实验中出现的 `127.0.0.1:10090` 可以作为真实测试环境记录保留，但必须结合本 README 的 Proxy 章节理解，它不是通用端口。

---

## 20. 版本信息

```text
Runner revision:
2026-07-27-codex-windows-v1-jsonl-comparable

Codex CLI:
0.145.0

Model:
deepseek/deepseek-v4-pro

PinchBench baseline commit:
819384ae830492365b8363fc26bc2602e73f216d
```

---

## 21. 复现原则

本项目真正需要固定的是：

```text
Codex CLI version
PinchBench commit
Model / provider
CODEX_HOME 行为配置
Runner revision
timeout / Judge / workspace policy
```

不需要进入源码 Git 的是：

```text
某一次 runs/
本机 .venv/
本机 codex-cli node_modules
个人 CODEX_HOME
本机日志
个人 API Key
某个固定代理端口
历史中间修复快照
```

因此 Git 仓库保存最终实现与复现说明，大体积原始 benchmark evidence 单独归档。
