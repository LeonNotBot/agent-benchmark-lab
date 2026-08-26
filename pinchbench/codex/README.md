# Codex + DeepSeek V4 Pro · PinchBench (Windows Native)

本目录保存 **Codex CLI + OpenRouter + DeepSeek V4 Pro** 在 Windows 原生环境下运行 PinchBench 的最终可复现实现。

当前仓库采用“**共享 PinchBench Runtime + Framework 专用 Runner**”结构。Python 虚拟环境与 PinchBench checkout 不复制到 Codex 目录，也不提交 `.venv`；Codex 目录只保存最终仍生效的 Runner、兼容层、验证脚本与复现说明。

---

## 1. Canonical Repository Layout

仓库中的最终结构：

```text
agent-benchmark-lab/
└─ pinchbench/
   ├─ runtime/
   │  ├─ requirements-lock.txt
   │  ├─ README.md
   │  ├─ manifests/
   │  └─ scripts/
   │
   └─ codex/
      ├─ README.md
      └─ runner/
         ├─ run_pinchbench_codex_windows.py
         ├─ run_codex_smoke.ps1
         ├─ run_codex_encoding_validation.ps1
         ├─ monitor_pinchbench_codex_windows.ps1
         │
         ├─ metadata-fix-v1/
         │  └─ install_codex_deepseek_metadata.ps1
         │
         ├─ stable-fix-v3/
         │  ├─ 01_probe_proxy_openrouter.ps1
         │  ├─ probe_openrouter_responses.py
         │  └─ 02_install_long_write_guard.ps1
         │
         ├─ encoding-fix-v3_2/
         │  └─ install_codex_encoding_fix_v3_2.ps1
         │
         ├─ transport-recovery-v1/
         │  ├─ install_post_completion_transport_recovery_v1.ps1
         │  └─ selftest_post_completion_transport_recovery.ps1
         │
         └─ ascii-runner-v1/
            ├─ verify_codex_core_ascii_v1.ps1
            ├─ run_codex_full_stable_ascii_v1.ps1
            └─ monitor_codex_ascii_v1.ps1
```

以上不是历史 patch 全量归档，而是当前 **最终仍生效的 Codex Windows 运行树**。

---

## 2. Components That Must Remain Together

当前最终链不是“最高版本覆盖所有旧目录”。以下组件职责不同，必须同时保留。

### 2.1 Core Python Runner

```text
runner/run_pinchbench_codex_windows.py
```

负责：

- PinchBench task staging；
- Codex CLI 非交互执行；
- JSONL / stderr / normalized transcript 采集；
- timeout；
- grader / Judge 调用；
- results JSON / CSV / XLSX；
- Token、tool call、permission、command failure 等审计信息；
- Windows transport recovery 的最终判定逻辑。

这是核心执行引擎；ASCII Runner 不替代它，只负责最终安全启动与门禁。

### 2.2 DeepSeek Metadata Fix v1

```text
runner/metadata-fix-v1/install_codex_deepseek_metadata.ps1
```

用于固定 DeepSeek V4 Pro 的模型 metadata，避免 Codex fallback metadata：

```text
context_window = 1048576
auto_compact_token_limit = 943718
```

该层与 encoding / Guard / transport recovery 无重叠，必须保留。

### 2.3 Stable Fix v3 — Proxy Probe + Initial Long-Write Guard

Canonical `stable-fix-v3/` 只保留：

```text
01_probe_proxy_openrouter.ps1
probe_openrouter_responses.py
02_install_long_write_guard.ps1
```

其中：

- `01_probe_proxy_openrouter.ps1`：OpenRouter Responses SSE / proxy 基线探针；
- `probe_openrouter_responses.py`：标准库探针实现；
- `02_install_long_write_guard.ps1`：安装 Windows 长命令 / 长文本写入 Guard。

历史 `stable-fix-v3` 中旧的 `03_*` / `04_*` wrapper **不再属于最终入口**，因为已经由 ASCII Runner v1 替代。

### 2.4 Encoding Fix v3.2

```text
runner/encoding-fix-v3_2/install_codex_encoding_fix_v3_2.ps1
```

作用：

- 将 Windows 长文件 Guard 升级为 Guard V2；
- 强制关键文本路径使用 UTF-8；
- 对新建 / 修改文本执行严格编码规范化；
- 保持 `apply_patch_tool_type = null`。

最终 Guard 标记应为：

```text
PINCHBENCH_WINDOWS_LONG_WRITE_GUARD_V2
```

因此 `long-write-fix-v2/` 不再作为 canonical GitHub 组件上传。

### 2.5 Post-Completion Transport Recovery v1

```text
runner/transport-recovery-v1/
├─ install_post_completion_transport_recovery_v1.ps1
└─ selftest_post_completion_transport_recovery.ps1
```

该层只处理一个非常窄的 Windows / provider transport 场景：

```text
Agent 产物已完成
+ grader 已完成
+ response.completed 丢失
```

它：

- 不重新调用模型；
- 不改变 workspace；
- 不改变 grader；
- 不改变 score；
- 保留原始 transport error；
- 只增加 transport recovery / warning 审计信息。

该层不能被 ASCII Runner 或 encoding fix 替代，因此必须保留。

### 2.6 ASCII Runner v1

最终正式入口：

```text
runner/ascii-runner-v1/
├─ verify_codex_core_ascii_v1.ps1
├─ run_codex_full_stable_ascii_v1.ps1
└─ monitor_codex_ascii_v1.ps1
```

职责：

- 使用纯 ASCII PowerShell wrapper，规避 Windows PowerShell 编码/参数传输问题；
- 正式运行前执行核心 Runner / config / patch gate；
- 启动最终 full run；
- 提供最终 monitor。

**正式 full run 与正式 monitor 统一使用 ASCII Runner v1。**

顶层：

```text
monitor_pinchbench_codex_windows.ps1
run_codex_encoding_validation.ps1
```

仍可作为辅助诊断/验证工具，但不替代最终 ASCII full-run / monitor 入口。

---

## 3. Files That Are Intentionally Not Canonical

以下内容可以存在于历史测试机器，但不要放进当前 `agent-benchmark-lab/pinchbench/codex/runner/` canonical tree：

```text
__pycache__/
*.pyc

long-write-fix-v2/

run_pinchbench_codex_windows.pre_encoding_fix
run_pinchbench_codex_windows.py.before-encoding*
run_pinchbench_codex_windows.py.before-transport*
*.before-*

README_CODEX_WINDOWS_RUNNER_V1*
SHA256SUMS_CODEX_WINDOWS_RUNNER_V1*

runs/
logs/
workspaces/
transcripts/
```

原因：

- `long-write-fix-v2` 已由最终 Guard V2 / encoding v3.2 链取代；
- `before-*` / `pre_encoding_fix` 是迁移备份，不是运行依赖；
- `__pycache__` / `.pyc` 是机器生成缓存；
- 历史 package README / SHA 清单属于迁移证据，不是 canonical source tree；
- run evidence 不应混入源码仓库。

如果确实需要长期保存历史 patch，应通过 Git 历史、tag 或独立 archive，而不是混入当前正式 `runner/`。

---

## 4. Shared PinchBench Runtime

当前 Codex 不再维护自己的 Python `.venv`。

### GitHub environment definition

```text
agent-benchmark-lab/pinchbench/runtime/
```

### Runtime on Windows

```text
C:\pinchbench-runtime\
├─ .venv\
└─ skill\
```

Canonical Python：

```text
C:\pinchbench-runtime\.venv\Scripts\python.exe
```

Canonical PinchBench checkout：

```text
C:\pinchbench-runtime\skill
```

PinchBench commit：

```text
819384ae830492365b8363fc26bc2602e73f216d
```

验证：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\agent-benchmark-lab\pinchbench\runtime\scripts\verify_runtime.ps1"
```

以及：

```powershell
git -C "C:\pinchbench-runtime\skill" rev-parse HEAD
```

必须为：

```text
819384ae830492365b8363fc26bc2602e73f216d
```

---

## 5. Fixed Benchmark Identity

| Item | Value |
|---|---|
| Platform | Windows Native |
| Codex CLI | `0.145.0` |
| Tested model | `deepseek/deepseek-v4-pro` |
| Provider | OpenRouter |
| Wire API | Responses |
| Approval policy | `never` |
| Sandbox mode | `workspace-write` |
| Windows sandbox | `unelevated` |
| Worker | `1` |
| Task concurrency | `1` |
| Network timeout | `300 s` |
| Non-network timeout | task timeout × `3.0` |
| PinchBench commit | `819384ae830492365b8363fc26bc2602e73f216d` |
| Formal wrapper | `ascii-runner-v1` |

正式比较原则：

- 相同 PinchBench commit；
- 相同 task order / fixtures；
- 默认排除相同 4 个 external integration tasks；
- worker=1；
- task concurrency=1；
- 不注入额外 system prompt；
- 不增加 AGENTS.md、MCP、skills、hooks 或 memories；
- 不使用 `danger-full-access`；
- 不因失败任务临时提高 timeout；
- 不为观察到的失败增加 Agent 特供提示。

---

## 6. Default Excluded Integration Tasks

```text
task_gh_issue_triage
task_gws_email_triage
task_gws_cross_service
task_gws_task_management
```

---

## 7. Local Codex Working Directory

Codex 自己的 Windows 根目录仍建议为：

```text
C:\pinchbench-codex\
├─ codex-cli\
├─ codex-home\
├─ runner\
├─ runs\
└─ logs\
```

Python 和 PinchBench source 不再要求复制到这里。

旧机器中若仍存在：

```text
C:\pinchbench-codex\.venv
C:\pinchbench-codex\skill
```

可以暂时保留用于历史审计，但新的 canonical SOP 不依赖它们。

---

## 8. Codex Configuration Requirements

`CODEX_HOME`：

```text
C:\pinchbench-codex\codex-home
```

关键行为配置：

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

不要把真实 `OPENROUTER_API_KEY` 写入：

- `config.toml`；
- Runner；
- README；
- Git commit；
- logs。

---

## 9. Final Compatibility-Layer Installation Order

从干净 Codex root 恢复时，最终保留层按以下顺序安装。

### 9.1 Metadata

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\pinchbench-codex\runner\metadata-fix-v1\install_codex_deepseek_metadata.ps1"
```

### 9.2 Initial Long-Write Guard

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\pinchbench-codex\runner\stable-fix-v3\02_install_long_write_guard.ps1"
```

### 9.3 Encoding Fix v3.2 / Guard V2

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\pinchbench-codex\runner\encoding-fix-v3_2\install_codex_encoding_fix_v3_2.ps1"
```

### 9.4 Post-Completion Transport Recovery

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\pinchbench-codex\runner\transport-recovery-v1\install_post_completion_transport_recovery_v1.ps1"
```

然后：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\pinchbench-codex\runner\transport-recovery-v1\selftest_post_completion_transport_recovery.ps1"
```

### 9.5 ASCII Core Gate

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\pinchbench-codex\runner\ascii-runner-v1\verify_codex_core_ascii_v1.ps1"
```

预期：

```text
PASS: core Python runner and configuration are valid.
```

---

## 10. Proxy Baseline

原正式 Windows 测试机使用：

```text
http://127.0.0.1:10090
```

这只是该机器的本地 Mihomo / mixed-port，不是 PinchBench 协议要求。

正式环境需要代理时：

```powershell
$env:HTTP_PROXY="http://127.0.0.1:10090"; $env:HTTPS_PROXY="http://127.0.0.1:10090"; $env:ALL_PROXY="http://127.0.0.1:10090"; $env:NO_PROXY="localhost,127.0.0.1,::1"
```

OpenRouter Responses SSE 基线探针：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\pinchbench-codex\runner\stable-fix-v3\01_probe_proxy_openrouter.ps1" -TestDirect -ShortAttempts 3 -LongAttempts 1
```

历史正式基线要求代理路径短流与长流都能收到：

```text
response.completed
```

---

## 11. OpenRouter Key

Key 只放当前 PowerShell session：

```powershell
$sec=Read-Host "Paste OpenRouter API Key" -AsSecureString; $env:OPENROUTER_API_KEY=[System.Net.NetworkCredential]::new("",$sec).Password; Remove-Variable sec; Write-Host "OPENROUTER_API_KEY set: $(-not [string]::IsNullOrWhiteSpace($env:OPENROUTER_API_KEY))"
```

不要输出真实 Key。

---

## 12. Core No-Fee Preflight

```powershell
$Root="C:\pinchbench-codex"; $Python="C:\pinchbench-runtime\.venv\Scripts\python.exe"; $Runner="$Root\runner\run_pinchbench_codex_windows.py"; $Codex="$Root\codex-cli\node_modules\.bin\codex.cmd"; $env:CODEX_HOME="$Root\codex-home"; $env:PYTHONUTF8="1"; $env:PYTHONIOENCODING="utf-8"; $env:NO_COLOR="1"; $env:FORCE_COLOR="0"; & $Python -X utf8 $Runner --skill-dir "C:\pinchbench-runtime\skill" --codex $Codex --expected-codex-version "0.145.0" --model "deepseek/deepseek-v4-pro" --approval-policy never --sandbox-mode workspace-write --windows-sandbox unelevated --suite all --timeout-multiplier 3.0 --network-timeout 300 --judge-timeout 300 --results-dir "$Root\runs" --preflight
```

重点确认：

```text
Selected tasks = 143
Default skipped = 4
Worker/concurrency = 1 / 1
Codex = 0.145.0
Model = deepseek/deepseek-v4-pro
Provider = OpenRouter
Wire API = responses
Sandbox = workspace-write / unelevated
Approval = never
Grader import = ok
```

Judge 的实际 model identity 应由当前 runner / PinchBench grader / `run_config.json` 审计确认，不要用未验证的 alias 替换。

---

## 13. Smoke Test

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\pinchbench-codex\runner\run_codex_smoke.ps1"
```

正式 full run 前 smoke 必须通过。

---

## 14. Formal Full Run

最终正式入口不是旧的 PowerShell wrapper，而是：

```text
ascii-runner-v1/run_codex_full_stable_ascii_v1.ps1
```

正式命令：

```powershell
$AsciiDir="C:\pinchbench-codex\runner\ascii-runner-v1"; powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$AsciiDir\run_codex_full_stable_ascii_v1.ps1" -Root "C:\pinchbench-codex" -Python "C:\pinchbench-runtime\.venv\Scripts\python.exe" -ProxyUrl "http://127.0.0.1:10090"
```

该 wrapper 应先完成：

- core runner / config gate；
- metadata 检查；
- Guard V2；
- encoding fix；
- transport recovery；
- `apply_patch=null`；
- proxy / Responses SSE 基线；
- 正式运行参数检查。

不要为了已有失败任务临时改变：

```text
timeout
task prompt
grader
Judge policy
worker/concurrency
sandbox
approval policy
```

---

## 15. Formal Monitor

另开 PowerShell：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\pinchbench-codex\runner\ascii-runner-v1\monitor_codex_ascii_v1.ps1"
```

`Ctrl+C` 只退出 monitor，不应终止正式 Runner。

---

## 16. Result Structure

正式 run：

```text
C:\pinchbench-codex\runs\codex_YYYYMMDD_HHMMSS\
├─ run_config.json
├─ progress.jsonl
├─ results.partial.json
├─ results.json
├─ results.csv
├─ results.xlsx
├─ workspaces\
└─ transcripts\
```

这些属于 benchmark evidence，不提交到源码 Git 仓库。

---

## 17. Core Audit Fields

通用：

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

Codex 额外：

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
transport_warning
```

---

## 18. Recommended `.gitignore`

Repository root 或 `pinchbench/codex/` 应确保忽略：

```gitignore
.venv/
venv/
__pycache__/
*.pyc
*.pyo

runs/
logs/
results/
workspaces/
transcripts/

codex-cli/
codex-home/
skill/
environment/
preflight/
preflight-tools/

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
```

---

## 19. Pre-Commit Safety Audit

确认没有缓存、历史备份或被替代组件：

```powershell
$Bad=Get-ChildItem -LiteralPath "C:\agent-benchmark-lab\pinchbench\codex\runner" -Recurse -Force | Where-Object {$_.FullName -match '__pycache__|before-encoding|before-transport|pre_encoding_fix|long-write-fix-v2'}; if($Bad){$Bad | Select-Object FullName; throw "STOP: obsolete/cache files found in GitHub tree"}else{Write-Host "PASS: no obsolete/cache Codex files"}
```

检查 API Key：

```powershell
$Hits=Get-ChildItem -LiteralPath "C:\agent-benchmark-lab\pinchbench\codex" -Recurse -File | Select-String -Pattern 'sk-or-v1-[A-Za-z0-9_-]{20,}|Bearer\s+[A-Za-z0-9._-]{20,}' -ErrorAction SilentlyContinue; if($Hits){$Hits | Format-Table Path,LineNumber,Line -AutoSize; throw "STOP: possible secret detected"}else{Write-Host "PASS: no obvious API secret detected"}
```

---

## 20. Version Identity

```text
Codex CLI:
0.145.0

Model:
deepseek/deepseek-v4-pro

Core runner revision:
2026-07-27-codex-windows-v1-jsonl-comparable

PinchBench:
819384ae830492365b8363fc26bc2602e73f216d

Final compatibility stack:
metadata-fix-v1
stable-fix-v3 (probe + initial Guard only)
encoding-fix-v3_2 / Guard V2
transport-recovery-v1
ascii-runner-v1
```

---

## 21. Reproducibility Principle

Git 保存的是：

```text
最终仍生效的 source / wrapper / patch
环境 lock / manifest
版本身份
可审计的复现说明
```

Git 不保存的是：

```text
本机虚拟环境
API Key
个人 CODEX_HOME
node_modules
run evidence
workspace
transcript
logs
Python cache
被最终版本替代的历史 patch
临时 before-* 备份
```

最终正式执行链：

```text
agent-benchmark-lab/pinchbench/runtime
        ↓
C:\pinchbench-runtime\.venv + skill
        ↓
Codex core runner
        ↓
metadata-fix-v1
        ↓
stable-fix-v3 Guard / proxy probe
        ↓
encoding-fix-v3_2 / Guard V2
        ↓
transport-recovery-v1
        ↓
ascii-runner-v1
        ↓
OpenRouter Responses API
        ↓
deepseek/deepseek-v4-pro
        ↓
PinchBench grader / Judge
```

这就是当前 Codex Windows PinchBench 的 canonical reproducible tree。
