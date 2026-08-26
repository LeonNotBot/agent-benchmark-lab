# Gemini CLI + DeepSeek V4 Pro · PinchBench (Windows Native)

本目录保存 **Gemini CLI + 本地 Gemini/OpenRouter Adapter + OpenRouter + DeepSeek V4 Pro** 在 Windows 原生环境下运行 PinchBench 的可复现实现。

这里不是 Gemini CLI 本身的 fork，也不是一次 benchmark 结果归档。它保存的是：

- Gemini CLI 与 OpenRouter/DeepSeek 之间的兼容 Adapter；
- Windows PinchBench Runner；
- 正式运行 wrapper；
- 网络、工具参数、语言与协议诊断工具；
- Adapter 从早期版本演进到最终 v1.3 的迁移资产；
- Judge / grading 修复辅助资产；
- 官方 Gemini CLI 的精确 upstream commit 记录。

正式测试时，Python/PinchBench 环境由仓库公共的 `pinchbench/runtime/` 提供；本目录只维护 Gemini Framework 自己的代码和兼容层。

---

## 1. Final Benchmark Identity

| Item | Final value |
|---|---|
| Platform | Windows Native |
| Gemini CLI | `0.52.0` |
| Tested model | `deepseek/deepseek-v4-pro` |
| Model route | OpenRouter |
| Adapter | `1.3.0` |
| Adapter endpoint | `http://127.0.0.1:8766` |
| Judge | `openrouter/anthropic/claude-opus-5` |
| PinchBench commit | `819384ae830492365b8363fc26bc2602e73f216d` |
| Suite | `all` |
| Selected tasks | `143` |
| Default skipped | `4` external integration tasks |
| Worker | `1` |
| Task concurrency | `1` |
| Judge concurrency | `1` |
| Prompt transport | UTF-8 stdin file |
| Output transport | Gemini `stream-json`, stderr separate |

最终 Agent 链路：

```text
PinchBench
    ↓
Gemini Windows Runner
    ↓
Gemini CLI 0.52.0
    ↓
Local Gemini/OpenRouter Adapter v1.3
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

---

## 2. Repository Layout

```text
agent-benchmark-lab/
└─ pinchbench/
   ├─ runtime/
   │  └─ shared Python + PinchBench environment definition
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
      ├─ support/
      └─ manifests/
```

这些目录分成三类：

```text
正式当前运行树
├─ runner/
└─ adapter-v1/

迁移 / 兼容 / 重建资产
├─ adapter-v1_1-fix/
├─ adapter-v1_2-fix/
├─ packages/
├─ patches/
└─ runner-package-v1/

探针 / 诊断 / 审计资产
├─ contract-probe-v1/
├─ exact-diagnostic-tools/
├─ judge-repair/
├─ probe/
├─ support/
└─ manifests/
```

---

## 3. `runner/` — Final Windows PinchBench Runner

`runner/` 是正式 benchmark 的主要入口目录。

当前最终环境中已出现的主要文件包括：

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

### `run_pinchbench_gemini_windows.py`

核心 Python Runner。

主要负责：

- 加载固定 PinchBench task manifest；
- 建立隔离 workspace；
- 将 prompt 通过 UTF-8 stdin 文件传给 Gemini CLI；
- 读取 Gemini `stream-json`；
- 单独保存 stderr；
- 记录 TTFT、Token、tool call 和终态；
- 执行 timeout；
- 调用 PinchBench grading；
- 对 Hybrid / LLM Judge 任务调用 Claude Opus 5；
- 输出 `results.json`、CSV、XLSX、`progress.jsonl` 等结果；
- 保存 transcript 和 workspace 审计信息。

最终 Runner 已与 Adapter `1.3.0` 对齐。

### `common_gemini_runner.ps1`

PowerShell 公共运行层。

负责多个 wrapper 共用的：

- Python / Runner 路径；
- Gemini CLI 路径；
- Adapter 健康检查；
- 环境变量；
- proxy；
- PinchBench 参数；
- Judge 参数；
- Windows 日志输出。

### `01_preflight_gemini.ps1`

正式运行前的无任务/低成本环境门禁。

检查：

- Gemini CLI version；
- PinchBench commit；
- task manifest；
- Adapter health/version；
- DeepSeek model identity；
- OpenRouter key；
- Judge readiness；
- fixtures/prerequisites；
- worker / concurrency；
- prompt/output transport；
- 是否存在不允许的自定义 `GEMINI.md`。

### `02_start_gemini_adapter_v1_3.ps1`

当前正式 Adapter 启动入口。

正式运行使用：

```text
Adapter v1.3.0
```

`02_start_gemini_adapter_v1_2.ps1` 保留用于迁移历史和回退审计，不是当前正式入口。

### `03_run_gemini_smoke.ps1`

正式全量前的 smoke test。

覆盖：

- 普通文本响应；
- 文件/代码工具；
- grading；
- Judge；
- workspace；
- transcript；
- 联网路径。

### `03_run_gemini_network_fix_canary.ps1`

Adapter v1.3 网络桥验证。

重点验证：

```text
OpenRouter web-search bridge
tool-call round trip
malformed tool argument count
Adapter upstream errors
```

### `03b_run_gemini_events_language_canary.ps1`

语言漂移诊断。

它用于判断 `task_events` 最终回复偶发日语是否属于：

- 单次模型语言漂移；
- 本地 locale；
- proxy 出口区域影响。

该脚本是诊断工具，不修改正式 task prompt。

### `04_monitor_pinchbench_gemini_windows.ps1`

只读 monitor。

显示：

- completed / total；
- success / failure；
- 当前平均分；
- timeout；
- grade error；
- Agent model；
- Judge model；
- Adapter health；
- 最近任务。

`Ctrl+C` 只停止 monitor，不改变正式 Runner。

### `04_rollback_gemini_adapter_v1_3_fix.ps1`

Adapter v1.3 迁移期 rollback 工具。

仅用于恢复/审计，不是正式执行链的一部分。

### `05_run_gemini_full.ps1`

正式 143 题全量入口。

最终正式运行固定：

```text
Adapter = 1.3.0
Judge = openrouter/anthropic/claude-opus-5
worker = 1
task concurrency = 1
```

### `06_bundle_gemini_run_diagnostic.ps1`

对已有 run 收集诊断材料。

主要用于问题复盘，不重新执行 Agent。

### `Collect_Current_Gemini_V13_Deep_Canary.ps1`

为 `task_deep_research` 收集最小证据：

- transcript；
- stderr；
- workspace 状态；
- task result；
- Adapter request lifecycle。

该工具帮助区分 Adapter 故障与 Agent 自身研究/收敛问题。

---

## 4. `adapter-v1/` — Current Adapter Source

这是当前实际运行的本地 Gemini/OpenRouter Adapter 源码目录。

核心实现：

```text
gemini_openrouter_adapter.py
```

虽然目录名仍为：

```text
adapter-v1
```

但当前实际实现已经演进到：

```text
Adapter v1.3.0
```

没有另外建立 `adapter-v1_3/`，因此不要用目录名判断 Adapter 版本。

### Adapter 的职责

Gemini CLI 不能像普通 OpenAI-compatible Agent 一样直接使用 OpenRouter 的 DeepSeek 模型，所以需要本地协议适配层。

Adapter 负责：

- 接收 Gemini CLI 请求；
- 转换到 OpenRouter Responses / model request；
- 将 DeepSeek 返回内容重新编码为 Gemini CLI 能消费的事件；
- 维护 tool call / tool result 回路；
- 转换联网搜索请求；
- 处理流式响应；
- 处理 Windows client disconnect；
- 保存诊断 lifecycle。

### Final v1.3 Fixes

v1.3 最关键的两个最终兼容修复：

```text
1. OpenRouter web-search bridge
2. long tool-argument transport
```

最终验证中已确认：

```text
OpenRouter web-search bridge requests > 0
Malformed tool argument events = 0
Adapter upstream error events = 0
```

因此当前正式基线不应再修改 Adapter 来“修复”真实任务 timeout。

---

## 5. `adapter-v1_1-fix/`

Adapter v1 → v1.1 的历史迁移资产。

它记录早期 Gemini CLI / Adapter 流式协议修复过程。

该目录主要用于：

- 重建历史状态；
- 审计某一行为从哪一个版本开始变化；
- 定位 regression。

不是当前正式 Adapter 启动目录。

---

## 6. `adapter-v1_2-fix/`

Adapter v1.2 迁移资产。

v1.2 主要解决了长时间等待和 Gemini stream parser 兼容问题，包括：

- 合法 Gemini JSON heartbeat；
- 等待 OpenRouter 时周期 heartbeat；
- 避免无法解析的 SSE comment keep-alive；
- 捕获 BrokenPipe / Windows connection abort；
- Gemini CLI 退出后取消上游请求；
- canary 进程级 hard timeout；
- canary progress/state 持久化。

v1.3 建立在这些经验之上。

该目录保留用于复现与审计，但最终运行使用 `adapter-v1/` 当前源码。

---

## 7. `contract-probe-v1/`

Gemini CLI ↔ Adapter 的协议契约探针。

用途：

- 确认 Gemini CLI 请求格式；
- 检查 streaming event contract；
- 验证 tool-call schema；
- 在修改 Adapter 前建立最小、可重复的 protocol baseline。

它的价值是把“Agent 行为问题”和“协议兼容问题”分开。

---

## 8. `probe/`

更通用的开发/网络/协议探针集合。

主要用于：

- local Adapter endpoint；
- upstream OpenRouter connectivity；
- event stream；
- request/response schema；
- Windows 网络行为。

不参与正式 143 题执行。

---

## 9. `exact-diagnostic-tools/`

Adapter v1.3 稳定后增加的精确诊断工具。

这类工具遵循原则：

```text
只收集证据
不修改正式 Runner
不修改 Adapter
不改变 task prompt
不改变 timeout
```

它们主要用于研究：

- `task_events` 语言漂移；
- `task_deep_research` timeout；
- web-search lifecycle；
- long tool argument；
- finalization timing。

---

## 10. `judge-repair/`

Judge / grading 兼容修复与重评辅助资产。

它与 Agent runtime 分开：

```text
Agent execution
≠
Judge execution
```

Judge repair 只用于修复已经确认的评分链路问题，不应为了提高低分重新运行 Gemini Agent。

正式 benchmark Judge：

```text
openrouter/anthropic/claude-opus-5
```

---

## 11. `packages/`

历史安装包 / 部署包 / patch package。

用途：

- 保存能够重新安装某个兼容层的原始 package；
- 保留精确 migration provenance；
- 避免只剩“已经被修改后的本机文件”，却失去补丁来源。

该目录属于复现资产，而不是 runtime output。

---

## 12. `patches/`

独立 patch / hotfix 源文件。

典型用途：

- Adapter revision 更新；
- wrapper expected-version 修复；
- Windows-specific compatibility fix；
- 一次性 migration。

对于已经合并进最终 `runner/` / `adapter-v1/` 的修复，正式运行直接使用最终文件；`patches/` 只是保存其演进来源。

---

## 13. `runner-package-v1/`

最初 Windows Gemini Runner 打包版本。

用于：

- 保存 Runner 初始完整包；
- 对比后续修改；
- 重建早期环境；
- provenance / audit。

当前正式 Runner 以：

```text
runner/
```

为准。

---

## 14. `support/`

后期补充但不属于正式运行入口的辅助脚本。

可包括：

```text
migration-tools/
diagnostics/
```

例如：

- wrapper adapter-version migration hotfix；
- 只读 timeout diagnostic；
- 特定问题证据采集脚本。

---

## 15. `manifests/`

保存外部依赖的精确身份，不复制未修改的第三方源码。

### `gemini-cli-upstream.txt`

本机检查确认 Gemini CLI source 是官方干净 checkout：

```text
repository=https://github.com/google-gemini/gemini-cli.git
commit=d14583b926769bd98f807cdc6b1ca50e91ae26ec
version=0.52.0
working_tree_at_capture=clean
```

因此本仓库不重复 vendoring：

```text
C:\pinchbench-gemini\src\gemini-cli
```

因为：

- remote 是官方 `google-gemini/gemini-cli`；
- working tree clean；
- 没有 benchmark-specific source modification。

复现时只需要 checkout 上述精确 commit。

---

## 16. Shared `pinchbench/runtime`

Gemini Framework 不再单独维护 PinchBench Python 环境。

公共环境定义：

```text
agent-benchmark-lab/pinchbench/runtime/
```

Windows 实际 runtime：

```text
C:\pinchbench-runtime\
├─ .venv\
└─ skill\
```

固定 PinchBench commit：

```text
819384ae830492365b8363fc26bc2602e73f216d
```

Gemini 自己的目录负责 Framework / Adapter；公共 runtime 负责：

- Python dependencies；
- PinchBench source；
- grading dependencies。

---

## 17. Local Runtime Directories Not Stored Here

以下目录属于机器状态或 benchmark evidence，不是本仓库源码：

```text
C:\pinchbench-gemini\cli
C:\pinchbench-gemini\gemini-home
C:\pinchbench-gemini\runs
C:\pinchbench-gemini\canary-runs
C:\pinchbench-gemini\logs
C:\pinchbench-gemini\backups
C:\pinchbench-gemini\regraded-results
C:\pinchbench-gemini\selective-regrades
```

其中：

- `cli/`：安装后的 Gemini CLI / node_modules；
- `gemini-home/`：本机 Gemini 配置与认证状态；
- `runs/`：正式 benchmark evidence；
- `canary-runs/`：验证任务结果；
- `logs/`：runtime logs；
- `backups/`：迁移备份；
- `regraded-results/` / `selective-regrades/`：评分修复输出。

这些不定义 Agent source code。

---

## 18. Formal Three-Window Runtime

正式测试使用三窗口结构。

### Window A — Adapter

```text
02_start_gemini_adapter_v1_3.ps1
```

职责：

```text
Gemini protocol
↔
OpenRouter / DeepSeek
```

### Window B — Runner

```text
01_preflight_gemini.ps1
03_run_gemini_smoke.ps1
05_run_gemini_full.ps1
```

职责：

```text
PinchBench task execution
+
grading
+
Judge
```

### Window C — Monitor

```text
04_monitor_pinchbench_gemini_windows.ps1
```

职责：

```text
read-only progress monitoring
```

---

## 19. Why Adapter v1.3 Is the Final Protocol Baseline

早期主要问题曾包括：

```text
request 首事件前阻塞
heartbeat / stream parsing
Windows connection abort
web-search bridge
long tool arguments
wrapper expected-version drift
```

v1.3 最终验证后：

```text
search bridge = working
long tool arguments = working
malformed tool arguments = 0
Adapter upstream protocol errors = 0
```

因此后续 `task_deep_research` 的 300 秒 timeout 被归因到 Agent 自身研究和终态收敛，而不是 Adapter protocol failure。

证据显示该任务：

```text
约 217 秒用于搜索 / 抓取
最终综合请求开始很晚
仅剩约 88 秒
最终 context 约 120 KB
Runner 在 300 秒固定 deadline 到达后取消请求
```

所以正式 benchmark 不提高 Gemini 单独 timeout，也不继续改 Adapter。

---

## 20. Reproducibility Boundary

这个目录负责固定：

```text
Gemini Runner
Gemini/OpenRouter Adapter
Adapter compatibility history
diagnostic/probe tooling
Judge repair tooling
Gemini CLI upstream identity
benchmark-specific Windows behavior
```

它不负责保存：

```text
API keys
Gemini login state
node_modules
Python virtualenv
PinchBench runtime copy
benchmark run outputs
logs
workspaces
transcripts
local backup folders
```

最终可复现身份可以概括为：

```text
Gemini CLI 0.52.0
+
official Gemini CLI upstream commit
d14583b926769bd98f807cdc6b1ca50e91ae26ec
+
Windows Gemini Runner
+
Local Adapter v1.3.0
+
DeepSeek V4 Pro via OpenRouter
+
Claude Opus 5 Judge
+
PinchBench
819384ae830492365b8363fc26bc2602e73f216d
+
single-worker serial execution
```
