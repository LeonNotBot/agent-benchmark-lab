# Gemini CLI + DeepSeek V4 Pro · PinchBench (Windows Native)

本目录保存 **Gemini CLI + local Gemini/OpenRouter Adapter + OpenRouter + DeepSeek V4 Pro** 在 Windows 原生环境下运行 PinchBench 的最终可复现代码、兼容层、诊断工具与迁移证据。

当前代码来自已经完成正式 PinchBench 全量测试的 Windows 环境。GitHub 的目标不是保存本机运行数据，而是保存足以重新部署、审计和诊断该 Agent stack 的源代码与脚本。

---

## 1. Repository Layout

推荐的仓库结构：

```text
agent-benchmark-lab/
└─ pinchbench/
   ├─ runtime/
   │  ├─ requirements-lock.txt
   │  ├─ README.md
   │  ├─ manifests/
   │  └─ scripts/
   │
   └─ gemini/
      ├─ README.md
      ├─ runner/
      ├─ adapter-v1/
      ├─ adapter-v1_1-fix/
      ├─ adapter-v1_2-fix/
      ├─ contract-probe-v1/
      ├─ exact-diagnostic-tools/
      ├─ judge-repair/
      ├─ packages/
      ├─ patches/
      ├─ probe/
      ├─ runner-package-v1/
      └─ manifests/
         └─ gemini-cli-upstream.txt
```

这里采用“**最终运行树 + 迁移/诊断源码一起保留**”的策略。

其中：

- `runner/`：当前正式 Gemini PinchBench Runner 与正式 wrapper；
- `adapter-v1/`：当前实际运行的 Adapter 源码目录，已经演进到 Adapter v1.3；
- `adapter-v1_1-fix/`、`adapter-v1_2-fix/`：历史兼容迁移层，保留用于重建和审计；
- `contract-probe-v1/`、`probe/`：Adapter / Gemini CLI 契约探针；
- `exact-diagnostic-tools/`：v1.3 后期精确诊断工具；
- `judge-repair/`：评分/Judge 修复辅助代码；
- `packages/`、`patches/`、`runner-package-v1/`：部署、修补和源码辅助材料；
- `manifests/gemini-cli-upstream.txt`：固定官方 Gemini CLI upstream URL、精确 commit 与版本，不在本仓库重复 vendoring 未修改的上游源码。

---

## 2. Active Final Stack

最终正式测试链路：

```text
PinchBench
    ↓
Windows Gemini Runner
    ↓
Gemini CLI 0.52.0
    ↓
Local Adapter v1.3
    ↓
OpenRouter
    ↓
deepseek/deepseek-v4-pro
```

需要 LLM Judge 的任务：

```text
PinchBench grader
    ↓
OpenRouter API
    ↓
openrouter/anthropic/claude-opus-5
```

固定基线：

```text
Gemini CLI:
0.52.0

Model:
deepseek/deepseek-v4-pro

Adapter:
v1.3.0

PinchBench commit:
819384ae830492365b8363fc26bc2602e73f216d

Tasks:
143

Worker/concurrency:
1 / 1

Judge:
openrouter/anthropic/claude-opus-5
```

Prompt transport：

```text
UTF-8 stdin file
```

Output transport：

```text
Gemini stream-json
stderr separate
```

---

## 3. Final Runner Files

当前 `runner/` 至少应保留以下已经实际出现于最终环境的文件：

```text
01_preflight_gemini.ps1
02_start_gemini_adapter_v1_2.ps1
02_start_gemini_adapter_v1_3.ps1
03_run_gemini_network_fix_canary.ps1
03_run_gemini_smoke.ps1
03b_run_gemini_events_language_canary.ps1
04_monitor_pinchbench_gemini_windows.ps1
04_rollback_gemini_adapter_v1_3_fix.ps1
05_run_gemini_full.ps1
06_bundle_gemini_run_diagnostic.ps1
Collect_Current_Gemini_V13_Deep_Canary.ps1
common_gemini_runner.ps1
run_pinchbench_gemini_windows.py
README_CN
VALIDATION_GEMINI_RUNNER_V1
VERSION
```

如果本机存在以下文件，也应一起提交：

```text
03a_run_gemini_long_write_probe.ps1
```

它属于 Adapter v1.3 长工具参数验证链。

不要提交：

```text
runner/__pycache__/
runner/backup-before-*/
```

---

## 4. Adapter v1.3

最终 Adapter 源码仍位于本机：

```text
C:\pinchbench-gemini\adapter-v1
```

已确认当前关键实现包括：

```text
gemini_openrouter_adapter.py
```

Adapter v1.3 修复并验证了两个关键兼容点：

```text
OpenRouter web-search bridge
long tool-argument transport
```

最终验证中：

```text
OpenRouter web-search bridge requests > 0
Malformed tool argument events = 0
Adapter upstream error events = 0
```

因此 v1.3 是当前 canonical Adapter；不要为了正式失败任务继续修改协议层。

---

## 5. Wrapper Version Hotfix

Adapter 升级到 v1.3 后，Python Runner 已经要求：

```text
Adapter 1.3.0
```

但早期安装包没有同步修改三个 PowerShell wrapper：

```text
01_preflight_gemini.ps1
03_run_gemini_smoke.ps1
05_run_gemini_full.ps1
```

后续 hotfix 已把这三个入口统一到：

```text
Adapter 1.3.0
```

因此 GitHub 中提交的 **当前 runner 文件本身必须已经是修复后的最终版本**。

验证：

```powershell
Select-String -Path "C:\agent-benchmark-lab\pinchbench\gemini\runner\01_preflight_gemini.ps1","C:\agent-benchmark-lab\pinchbench\gemini\runner\03_run_gemini_smoke.ps1","C:\agent-benchmark-lab\pinchbench\gemini\runner\05_run_gemini_full.ps1","C:\agent-benchmark-lab\pinchbench\gemini\runner\run_pinchbench_gemini_windows.py" -Pattern "1\.2\.0|1\.3\.0"
```

正式入口不应仍以 `1.2.0` 作为 Adapter expected version。

---

## 6. Exact Diagnostic / Canary Tools

v1.3 后期新增了精确诊断工具，不修改正式 Runner 或 Adapter，只用于判定具体失败原因。

已知工具包括：

```text
03b_run_gemini_events_language_canary.ps1
Collect_Current_Gemini_V13_Deep_Canary.ps1
```

以及最终长参数验证：

```text
03a_run_gemini_long_write_probe.ps1
```

这些工具用于区分：

```text
Adapter protocol failure
vs.
network/provider delay
vs.
Agent research-loop / late finalization
vs.
language drift
```

它们属于可复现诊断资产，建议保留在 GitHub。

---

## 7. Historical Fix Directories

以下目录虽然不是正式运行时逐层执行的必需链，但建议保留，因为它们记录了 Adapter 从 v1 → v1.1 → v1.2 → v1.3 的真实 Windows 兼容迁移过程：

```text
adapter-v1_1-fix/
adapter-v1_2-fix/
contract-probe-v1/
patches/
probe/
runner-package-v1/
```

其中 v1.2 曾修复：

```text
heartbeat_stream
valid Gemini JSON SSE heartbeat
BrokenPipe / Windows connection abort handling
process-level hard timeout for canaries
```

最终 v1.3 在此基础上增加了：

```text
OpenRouter web-search bridge
long tool-argument compatibility
```

因此这些历史目录可以保留用于审计，但正式运行始终以当前：

```text
adapter-v1/
runner/
```

为准。

---

## 8. Shared PinchBench Runtime

当前仓库统一使用：

```text
agent-benchmark-lab/pinchbench/runtime/
```

Windows runtime：

```text
C:\pinchbench-runtime\
├─ .venv\
└─ skill\
```

Canonical Python：

```text
C:\pinchbench-runtime\.venv\Scripts\python.exe
```

Canonical PinchBench：

```text
C:\pinchbench-runtime\skill
```

PinchBench commit：

```text
819384ae830492365b8363fc26bc2602e73f216d
```

注意：历史 Gemini Runner / wrapper 可能仍包含早期测试机器路径，例如：

```text
C:\pinchbench-codex\skill
```

这些路径属于历史实现证据。**在没有逐文件验证之前，不要批量猜测替换源码。**

若未来把 Runner 完全迁移到共享 runtime，应先逐文件 audit，再做明确 patch，并重新执行 preflight / smoke。

---

## 9. Gemini CLI Upstream Pin

本机检查结果确认：

```text
Repository:
https://github.com/google-gemini/gemini-cli.git

Commit:
d14583b926769bd98f807cdc6b1ca50e91ae26ec

Working tree:
clean
```

因此：

```text
C:\pinchbench-gemini\src\gemini-cli
```

是未修改的官方 upstream checkout，不需要整仓复制到 `agent-benchmark-lab`。

GitHub 只保存：

```text
pinchbench/gemini/manifests/gemini-cli-upstream.txt
```

建议内容：

```text
repository=https://github.com/google-gemini/gemini-cli.git
commit=d14583b926769bd98f807cdc6b1ca50e91ae26ec
version=0.52.0
working_tree_at_capture=clean
```

重建时应从官方仓库 checkout 该精确 commit，而不是依赖浮动 `main`。

---

## 10. Local Project Directory

正式 Windows 工作目录：

```text
C:\pinchbench-gemini\
```

代码目录：

```text
C:\pinchbench-gemini\runner
C:\pinchbench-gemini\adapter-v1
```

本机还可以存在：

```text
cli/
gemini-home/
runs/
logs/
canary-runs/
backups/
regraded-results/
selective-regrades/
```

但这些 **不属于源码 GitHub tree**。

---

## 11. Directories That Must Not Be Uploaded

明确禁止上传：

```text
gemini-home/
cli/
runs/
canary-runs/
logs/
backups/
regraded-results/
selective-regrades/
__pycache__/
```

原因：

- `gemini-home/` 可能包含认证、机器配置或本机状态；
- `cli/` 是安装后的 Gemini CLI / node_modules，不是本项目源码；
- `runs/`、`canary-runs/`、`regraded-results/`、`selective-regrades/` 是 benchmark evidence；
- `logs/` 是运行日志；
- `backups/` 和 `backup-before-*` 是迁移备份；
- `__pycache__` / `.pyc` 是 Python 缓存。

API Key、`.env`、认证 token 永远不得提交。

---

## 12. Adapter Start

Window A：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\pinchbench-gemini\runner\02_start_gemini_adapter_v1_3.ps1"
```

Health：

```powershell
Invoke-RestMethod "http://127.0.0.1:8766/healthz" | ConvertTo-Json -Depth 10
```

应确认：

```text
ok = true
version = 1.3.0
```

---

## 13. Preflight

Window B：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\pinchbench-gemini\runner\01_preflight_gemini.ps1" -JudgeModel "openrouter/anthropic/claude-opus-5"
```

应确认：

```text
Gemini CLI = 0.52.0
Adapter = 1.3.0
Model = deepseek/deepseek-v4-pro
Selected tasks = 143
Default skipped = 4
Worker/concurrency = 1 / 1
Judge = openrouter/anthropic/claude-opus-5
Grader import = ok
No custom GEMINI.md
```

---

## 14. Smoke / Canary

正式 smoke：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\pinchbench-gemini\runner\03_run_gemini_smoke.ps1" -JudgeModel "openrouter/anthropic/claude-opus-5"
```

Network bridge canary：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\pinchbench-gemini\runner\03_run_gemini_network_fix_canary.ps1" -JudgeModel "openrouter/anthropic/claude-opus-5"
```

Language canary：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\pinchbench-gemini\runner\03b_run_gemini_events_language_canary.ps1" -JudgeModel "openrouter/anthropic/claude-opus-5"
```

如果 `03a_run_gemini_long_write_probe.ps1` 存在：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\pinchbench-gemini\runner\03a_run_gemini_long_write_probe.ps1"
```

---

## 15. Formal Full Run

Window B：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\pinchbench-gemini\runner\05_run_gemini_full.ps1" -JudgeModel "openrouter/anthropic/claude-opus-5"
```

正式 full run：

```text
143 tasks
worker=1
task concurrency=1
Judge concurrency=1
```

不要为了已观察到的研究超时临时提高 300 秒 network timeout。

---

## 16. Monitor

Window C：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\pinchbench-gemini\runner\04_monitor_pinchbench_gemini_windows.ps1"
```

`Ctrl+C` 只停止 monitor，不应停止 Adapter 或 Runner。

---

## 17. Known Final Interpretation

Adapter v1.3 已验证：

```text
search bridge = working
long tool arguments = working
malformed tool arguments = 0
adapter upstream protocol errors = 0
```

`task_deep_research` 后续证据表明，其 300 秒失败主要来自：

```text
约 217 秒用于搜索/工具调用
最终综合开始太晚
剩余约 88 秒处理约 120 KB 上下文并生成报告
最终撞 300 秒 deadline
```

这属于当前 Gemini CLI + DeepSeek V4 Pro + PinchBench 固定预算下的真实 Agent convergence / time-management 问题，不应再通过修改 Adapter 或单独提高 timeout 来“修复”。

---

## 18. Recommended `.gitignore`

```gitignore
# Credentials / local config
.env
.env.*
*secret*
*credentials*
*api_key*
*token*

# Gemini local installation and home
cli/
gemini-home/

# Runtime evidence
runs/
canary-runs/
logs/
regraded-results/
selective-regrades/
backups/

# Generated caches
__pycache__/
*.pyc
*.pyo

# Backup snapshots
backup-before-*/
*.bak
*.tmp

# Do not blanket-ignore ZIP files here.
# Historical installer/patch packages under packages/ may be intentionally versioned.
# Run/result/evidence ZIP bundles should stay outside this source tree.

# Benchmark outputs
results.json
results.csv
results.xlsx
progress.jsonl
results.partial.json
transcripts/
workspaces/
```

---

## 19. Pre-Commit Security Audit

Check secrets:

```powershell
$Hits=Get-ChildItem -LiteralPath "C:\agent-benchmark-lab\pinchbench\gemini" -Recurse -File | Select-String -Pattern 'sk-or-v1-[A-Za-z0-9_-]{20,}|Bearer\s+[A-Za-z0-9._-]{20,}' -ErrorAction SilentlyContinue; if($Hits){$Hits | Format-Table Path,LineNumber,Line -AutoSize; throw "STOP: possible secret detected"}else{Write-Host "PASS: no obvious API secret detected"}
```

Check forbidden dirs/files:

```powershell
$Bad=Get-ChildItem -LiteralPath "C:\agent-benchmark-lab\pinchbench\gemini" -Recurse -Force | Where-Object {$_.FullName -match '\\(__pycache__|runs|canary-runs|logs|backups|regraded-results|selective-regrades|gemini-home|cli)(\\|$)' -or $_.Name -match '^backup-before-|\.pyc$'}; if($Bad){$Bad | Select-Object FullName; throw "STOP: generated/private Gemini files found"}else{Write-Host "PASS: Gemini GitHub tree contains source/support files only"}
```

---

## 20. Reproducibility Principle

GitHub 保存：

```text
current runner
current Adapter
migration fixes
contract probes
diagnostic tools
patch source
package/install source
Gemini CLI upstream URL + exact commit
version identity
README
```

GitHub 不保存：

```text
API keys
Gemini authentication state
installed Gemini CLI/node_modules
runs
logs
canary outputs
regraded outputs
workspace
transcripts
backups
Python cache
run/result/evidence ZIP bundles
```

`packages/` 中如果存在用于重建 Adapter/Runner 的安装包或 patch ZIP，可以保留；提交前只需要确保单文件未超过 GitHub 的文件大小限制，并确认压缩包内不含 Key、run evidence 或认证状态。

当前 canonical runtime identity：

```text
Gemini CLI 0.52.0
+
Adapter v1.3.0
+
DeepSeek V4 Pro via OpenRouter
+
Claude Opus 5 Judge
+
PinchBench commit 819384ae830492365b8363fc26bc2602e73f216d
+
single worker / serial execution
```
