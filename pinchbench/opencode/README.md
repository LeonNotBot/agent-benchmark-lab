# OpenCode + Kimi K3 · PinchBench（Windows Native）

本目录保存 **OpenCode + Kimi K3** 在 Windows 原生环境下运行 PinchBench 的可复现 Runner、评分修复脚本、timeout 补测脚本与使用说明。

本代码可以放在两种仓库结构中：

```text
agent-benchmark-lab/
└─ pinchbench/
   └─ opencode/
      ├─ README.md
      ├─ .gitignore
      └─ runner/
```

也可以作为独立仓库：

```text
OpenCode-PinchBench/
├─ README.md
├─ .gitignore
└─ runner/
```

## 1. 仓库范围

本仓库只保存本次 OpenCode PinchBench 评测中需要长期版本管理的代码与说明。

推荐提交：

```text
README.md
.gitignore
runner/
```

不推荐提交：

```text
.venv/
runs/
skill/
smoke/
diagnostics/
upload_final/
__pycache__/
*.pyc
*.zip
transcripts/
workspaces/
results.json
results.csv
results.xlsx
progress.jsonl
results.partial.json
```

原因：

- `runs/`：正式测试与补测的原始运行结果、transcript、workspace 等审计产物；
- `.venv/`：本机 Python 虚拟环境；
- `skill/`：PinchBench 上游 checkout，应通过固定 commit 重建；
- `smoke/`、`diagnostics/`：测试/诊断产物；
- ZIP、XLSX、JSON 等：结果或审计包，不属于 Runner 源码。

与 LocalClaw 目录不同，本项目不需要把 OpenCode 本体复制到 `framework/`。OpenCode 通过 npm 安装并固定版本；PinchBench `skill` 通过上游仓库固定 commit 重建。因此本项目核心自定义实现集中在 `runner/`。

---

## 2. 固定评测配置

| 项目 | 固定值 |
|---|---|
| 平台 | Windows 11，Native Windows |
| Python | 3.12.10 |
| OpenCode | 1.18.4 |
| 被测模型 | `openrouter/moonshotai/kimi-k3` |
| Judge | `openrouter/anthropic/claude-opus-5` |
| Agent / Variant | OpenCode default / default |
| Worker | 1 |
| Task concurrency | 1 |
| PinchBench commit | `819384ae830492365b8363fc26bc2602e73f216d` |
| Stage-1 非联网 timeout | `task.timeout_seconds × 3` |
| Stage-1 联网 timeout | `300 s` |
| Stage-2 非联网 timeout | `task.timeout_seconds × 6` |
| Stage-2 联网 timeout | `600 s` |

固定模型：

```text
openrouter/moonshotai/kimi-k3
```

固定 Judge：

```text
openrouter/anthropic/claude-opus-5
```

---

## 3. Runner 目录

当前 `runner/` 中包含主 Runner、冒烟测试、实时监控、Frozen-output regrade、timeout 补测、结果发布与诊断脚本。

典型结构：

```text
runner/
├─ run_pinchbench_opencode_kimi_windows.py
├─ smoke_test_opencode_kimi_windows.py
├─ monitor_pinchbench_opencode_kimi.ps1
├─ 04_monitor_pinchbench_opencode_kimi_windows.ps1
├─ 04_run_regrade_kimi_frozen.ps1
├─ 04_run_regrade_kimi_frozen_v2.ps1
├─ 05_rerun_kimi_timeouts.ps1
├─ 06_publish_corrected_kimi_results.ps1
├─ 07_rerun_kimi_two_timeout_probes.ps1
├─ collect_opencode_kimi_diagnostics.ps1
├─ regrade_kimi_frozen_outputs.py
└─ regrade_kimi_frozen_outputs_v2.py
```

### 主 Runner

`run_pinchbench_opencode_kimi_windows.py`

主要负责：

- Windows 原生环境逐任务运行 OpenCode；
- 指定 OpenRouter / Kimi K3；
- 控制联网与非联网 timeout；
- 调用 PinchBench grader / LLM Judge；
- 输出 `run_config.json`、`progress.jsonl`、`results.json`、CSV/XLSX；
- 保存 transcript；
- 统计 Agent / grading / end-to-end 时间；
- 累计 OpenCode `step_finish` usage；
- 保存 Token、cost、TTFT 等审计字段。

查看参数：

```powershell
python .\runner\run_pinchbench_opencode_kimi_windows.py --help
```

### Frozen-output regrade

以下脚本用于已确认的评分链路兼容问题：

```text
04_run_regrade_kimi_frozen.ps1
04_run_regrade_kimi_frozen_v2.ps1
regrade_kimi_frozen_outputs.py
regrade_kimi_frozen_outputs_v2.py
```

Frozen-output regrade **只重新评分冻结的原 Agent 产物，不重新调用 Kimi**。

### Timeout rerun

`05_rerun_kimi_timeouts.ps1`

Stage-2 资格严格由 Stage-1 terminal status 决定：

```text
Stage-1 status = timeout
```

非 timeout 的低分任务不进入 Stage-2。

---

## 4. 本地工作目录

推荐把源码仓库与大体积 benchmark 工作目录分离。

例如：

```text
C:\agent-benchmark-lab\pinchbench\opencode\runner\
C:\pinchbench-opencode-kimi\.venv\
C:\pinchbench-opencode-kimi\skill\
C:\pinchbench-opencode-kimi\runs\
C:\pinchbench-opencode-kimi\smoke\
C:\pinchbench-opencode-kimi\environment\
```

独立仓库方式也可以：

```text
C:\OpenCode-PinchBench\runner\
C:\pinchbench-opencode-kimi\.venv\
C:\pinchbench-opencode-kimi\skill\
C:\pinchbench-opencode-kimi\runs\
```

`runs/` 不需要进入 Git。

---

## 5. 安装 OpenCode

固定版本：

```powershell
npm install -g opencode-ai@1.18.4
```

确认：

```powershell
opencode --version
```

预期：

```text
1.18.4
```

登录 OpenRouter：

```powershell
opencode auth login
```

确认登录：

```powershell
opencode auth list
```

刷新模型：

```powershell
opencode models --refresh
```

确认 Kimi K3：

```powershell
opencode models | Select-String "moonshotai/kimi-k3"
```

---

## 6. 固定 PinchBench commit

示例工作目录：

```powershell
$WORK="C:\pinchbench-opencode-kimi"
```

克隆 PinchBench skill：

```powershell
git clone https://github.com/pinchbench/skill.git "$WORK\skill"
```

切到本次使用的固定 commit：

```powershell
git -C "$WORK\skill" checkout 819384ae830492365b8363fc26bc2602e73f216d
```

确认：

```powershell
git -C "$WORK\skill" rev-parse HEAD
```

预期：

```text
819384ae830492365b8363fc26bc2602e73f216d
```

---

## 7. Python 环境

创建虚拟环境：

```powershell
$WORK="C:\pinchbench-opencode-kimi"; py -3.12 -m venv "$WORK\.venv"
```

安装依赖：

```powershell
$PY="C:\pinchbench-opencode-kimi\.venv\Scripts\python.exe"; & $PY -m pip install --upgrade pip; & $PY -m pip install pyyaml openpyxl; & $PY -m pip install -e "C:\pinchbench-opencode-kimi\skill"
```

如果没有 `py -3.12`，可使用本机已安装的 Python 3.12 创建 venv。

---

## 8. OpenRouter API Key

PinchBench API Judge 读取：

```text
OPENROUTER_API_KEY
```

推荐在每个新 PowerShell 窗口中安全输入：

```powershell
$sec=Read-Host "Paste OpenRouter API Key" -AsSecureString; $env:OPENROUTER_API_KEY=[System.Net.NetworkCredential]::new("",$sec).Password; Remove-Variable sec; Write-Host "OPENROUTER_API_KEY set: $(-not [string]::IsNullOrWhiteSpace($env:OPENROUTER_API_KEY))"
```

不要执行：

```powershell
echo $env:OPENROUTER_API_KEY
```

不要把真实 Key 写进代码、README、`.env` 或 Git 历史。

---

## 9. Proxy / Mihomo / Clash 说明

部分历史 PowerShell 补测脚本保留了本次真实实验环境中使用过的本地代理默认值，例如：

```text
http://127.0.0.1:10090
```

**这个端口只是原测试机器上的 Mihomo/mixed-port 配置，不是 PinchBench 或 OpenCode 的固定要求。**

如果本机代理端口不同，请使用自己的代理地址；如果不需要代理，则使用本机可直连 OpenRouter 的环境。

检查 Mihomo/Clash 等进程：

```powershell
Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -match "clash|mihomo|sing-box|v2ray|xray|nekoray|hiddify|shadowsocks|trojan" } | Select-Object ProcessName,Id,Path
```

检查某个代理进程监听端口：

```powershell
Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Select-Object LocalAddress,LocalPort,OwningProcess | Sort-Object LocalPort
```

如果需要在当前 PowerShell 会话设置代理：

```powershell
$env:HTTP_PROXY="http://127.0.0.1:<PORT>"; $env:HTTPS_PROXY="http://127.0.0.1:<PORT>"; $env:ALL_PROXY="http://127.0.0.1:<PORT>"
```

同时推荐使用 UTF-8：

```powershell
$env:PYTHONUTF8="1"; $env:PYTHONIOENCODING="utf-8"
```

说明：

- `10090` 不应被理解为通用默认端口；
- 不同 Clash/Mihomo 配置可能使用 `7890`、`7892`、`10090` 或其他端口；
- `external-controller` 管理端口不能当 HTTP proxy 使用；
- 若历史脚本中存在 `-Proxy` 参数，可在运行时传入当前机器自己的代理地址；
- 为保持实验脚本与实际测试时一致，本仓库保留历史脚本原值，并在此 README 中明确其机器相关性。

---

## 10. Preflight

假设：

```text
源码：
C:\agent-benchmark-lab\pinchbench\opencode

工作目录：
C:\pinchbench-opencode-kimi
```

运行：

```powershell
$PY="C:\pinchbench-opencode-kimi\.venv\Scripts\python.exe"; & $PY "C:\agent-benchmark-lab\pinchbench\opencode\runner\run_pinchbench_opencode_kimi_windows.py" --skill-dir "C:\pinchbench-opencode-kimi\skill" --suite all --model "openrouter/moonshotai/kimi-k3" --results-dir "C:\pinchbench-opencode-kimi\runs" --preflight
```

Preflight 用于检查：

- OpenCode command / version；
- model；
- worker/concurrency；
- OpenRouter key；
- PinchBench grader；
- fixtures / prerequisites；
- task manifest。

---

## 11. Canary

正式全量前建议先跑 1 题：

```powershell
$PY="C:\pinchbench-opencode-kimi\.venv\Scripts\python.exe"; & $PY "C:\agent-benchmark-lab\pinchbench\opencode\runner\run_pinchbench_opencode_kimi_windows.py" --skill-dir "C:\pinchbench-opencode-kimi\skill" --suite automated-only --limit 1 --model "openrouter/moonshotai/kimi-k3" --results-dir "C:\pinchbench-opencode-kimi\runs" --keep-workspaces --verbose
```

---

## 12. Stage-1 正式全量

固定 Stage-1 timeout：

```text
非联网：task.timeout_seconds × 3
联网：300 s
```

运行：

```powershell
$PY="C:\pinchbench-opencode-kimi\.venv\Scripts\python.exe"; & $PY "C:\agent-benchmark-lab\pinchbench\opencode\runner\run_pinchbench_opencode_kimi_windows.py" --skill-dir "C:\pinchbench-opencode-kimi\skill" --suite all --model "openrouter/moonshotai/kimi-k3" --timeout-multiplier 3 --network-timeout 300 --judge-model "openrouter/anthropic/claude-opus-5" --results-dir "C:\pinchbench-opencode-kimi\runs" --keep-workspaces
```

该固定 manifest 下正式任务数：

```text
143
```

---

## 13. Stage-2 Extended-Time

Stage-2 只对 Stage-1 timeout 任务补跑。

| 类型 | Stage-1 | Stage-2 |
|---|---:|---:|
| 联网 | 300 s | 600 s |
| 非联网 | `timeout_seconds × 3` | `timeout_seconds × 6` |

合并原则：

1. 只有 Stage-1 `timeout` 有资格补跑；
2. 成功但低分的任务不因分数低而补跑；
3. Stage-2 行替换对应 Stage-1 行；
4. 不使用“旧分和新分择优”；
5. 原始 Stage-1 与 Stage-2 evidence 保存在本地审计包，不进入源码 Git。

单题示例：

```powershell
$PY="C:\pinchbench-opencode-kimi\.venv\Scripts\python.exe"; & $PY "C:\agent-benchmark-lab\pinchbench\opencode\runner\run_pinchbench_opencode_kimi_windows.py" --skill-dir "C:\pinchbench-opencode-kimi\skill" --suite task_csv_gdp_regions --timeout-multiplier 6 --network-timeout 600 --judge-model "openrouter/anthropic/claude-opus-5" --results-dir "C:\pinchbench-opencode-kimi\runs" --keep-workspaces --verbose
```

---

## 14. 本轮 benchmark 结果

### Stage-1

```text
任务数：143
success：129
timeout：14
frozen-output regrade：8 道已确认评分链路异常
修正后平均分：0.8870
```

### Stage-2

```text
Stage-1 timeout 补测覆盖：14 / 14
联网 deadline：600 s
非联网 deadline：task.timeout_seconds × 6
```

最终合并：

```text
任务数：143
success：141
timeout：2
最终平均分：0.9390
```

遗漏后单独补跑的：

```text
task_csv_gdp_regions
score=0.950
elapsed=256.6s
success
```

结果文件与 RAW runs 不放进源码仓库。

---

## 15. Token / 时间口径

Runner 记录：

```text
agent_elapsed
grading_elapsed
end_to_end_elapsed
input_tokens
output_tokens
reasoning_tokens
cache_read_tokens
cache_write_tokens
total_tokens
token_source
token_coverage_complete
token_verified_against_openrouter
cost_usd
```

派生 Token：

```text
total_tokens = input + output + reasoning + cache_read + cache_write
```

主要从：

```text
opencode run --format json
```

的 `step_finish` 事件逐 step 累加。

当前：

```text
token_verified_against_openrouter = false
```

表示尚未与 OpenRouter billing / generation 做逐请求独立对账。

横向比较 Agent 速度时优先使用：

```text
agent_elapsed
```

避免把 Judge 时间计入被测 Agent 延迟。

---

## 16. 推荐 `.gitignore`

```gitignore
.venv/
venv/
__pycache__/
*.pyc
*.pyo

runs/
results/
smoke/
diagnostics/
upload_final/

*.zip
*.log

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

## 17. 上传前安全检查

检查是否存在疑似真实 Key：

```powershell
Get-ChildItem . -Recurse -File | Select-String -Pattern "sk-or-v1-[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9_-]{20,}" -CaseSensitive:$false | Select-Object Path,LineNumber,Line
```

检查机器相关配置：

```powershell
Get-ChildItem . -Recurse -File | Select-String -Pattern "C:\\Users\\|127\.0\.0\.1:[0-9]+" | Select-Object Path,LineNumber,Line
```

历史代理值可以保留以复现实验，但应结合本 README 的 Proxy 章节理解，不应把对应端口视为通用要求。

---

## 18. 复现原则

本项目的复现依赖于四类固定信息：

```text
OpenCode version
PinchBench commit
Model / Judge
Runner + timeout policy
```

而不依赖于：

```text
某一次 runs 目录
某一个本机 venv
某一个固定代理端口
某个个人 Windows 用户目录
```

因此 Git 只保存实现与配置说明，大体积运行证据单独归档。

---

## 19. Upstream

PinchBench skill/tasks 属于其上游项目；本仓库保存 OpenCode Windows Runner 与本次 benchmark 所需的补测/评分修复代码。

使用前请同时遵循 PinchBench、OpenCode、OpenRouter 及相关依赖各自的许可与使用条款。
