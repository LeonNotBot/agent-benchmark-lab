# Grok Build + DeepSeek V4 Pro · PinchBench (Windows Native)

本目录保存 **Grok Build CLI + Local Canonical Responses Adapter + OpenRouter + DeepSeek V4 Pro** 在 Windows 原生环境下运行 PinchBench 的可复现实现。

这里不是 Grok Build CLI 本身的二进制分发，也不是一次 benchmark 结果归档。它保存的是：

- Windows PinchBench Runner；
- 最终 Canonical History Adapter v0.2.0；
- Adapter 协议 canary / isolated-task 验证工具；
- Runner preflight / smoke / full / resume / monitor；
- 从早期搜索兼容层演进到最终 canonical compiler 的迁移包；
- 安装包、校验和与补丁 provenance；
- Grok Build CLI 精确版本 / binary SHA-256 / source-reference identity；
- 与共享 `pinchbench/runtime` 的复现边界。

正式测试时，Python/PinchBench 环境由仓库公共的 `pinchbench/runtime/` 提供；本目录只维护 Grok Build Framework 自己的 Runner、Adapter 与兼容资产。

---

## 1. Final Benchmark Identity

| Item | Final value |
|---|---|
| Platform | Windows Native |
| Grok Build CLI | `grok 0.2.118 (1e1687c1cf)` |
| Grok binary SHA-256 | `8b365d13ba0956bd8015069a7230370dd11496cd18d03b5eb148a329a8d96f7c` |
| Tested model alias | `deepseek-v4-pro-openrouter` |
| Actual model | `deepseek/deepseek-v4-pro` |
| Adapter | `0.2.0` |
| Adapter compiler | `canonical-history-v1` |
| Adapter endpoint | `http://127.0.0.1:8767` |
| Runner revision | `2026-08-03-grok-build-windows-v1.1.0-canonical-history-adapter-0.2.0` |
| Judge | `openrouter/anthropic/claude-opus-5` |
| PinchBench commit | `819384ae830492365b8363fc26bc2602e73f216d` |
| PinchBench manifest SHA-256 | `38d7cd1bddfa5e9fefc7b6945c91955f36dc5c88c32c994bf8676344b1069a7b` |
| Suite | `all` |
| Selected tasks | `143` |
| Worker | `1` |
| Task concurrency | `1` |
| Prompt transport | UTF-8 `--prompt-file` |
| Output transport | `streaming-messages-json`; raw JSONL/stderr separate |
| Custom context | none |

最终 Agent 链路：

```text
PinchBench
    ↓
Windows Grok Build Runner
    ↓
Grok Build CLI 0.2.118
    ↓
Local Canonical Responses Adapter v0.2.0
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

推荐的项目结构：

```text
agent-benchmark-lab/
└─ pinchbench/
   ├─ runtime/
   │  └─ shared Python + PinchBench environment definition
   │
   └─ grok-build/
      ├─ README.md
      ├─ .gitignore
      ├─ runner/
      ├─ search-adapter/
      ├─ packages/
      ├─ archive/
      │  └─ runner-hotfix-backup/
      └─ manifests/
         ├─ grok-build-binary.txt
         └─ source-reference-upstream.txt   # only when source-reference is a clean upstream checkout
```

项目资产按职责分为：

```text
正式当前运行树
├─ runner/
└─ search-adapter/

迁移 / 安装 / provenance
├─ packages/
└─ archive/

外部软件身份
└─ manifests/
```

---

## 3. `runner/` — Final Windows PinchBench Runner

`runner/` 是正式 benchmark 的主要执行目录。

当前最终环境中的主要文件：

```text
01_preflight_grok_build.ps1
02_run_grok_build_smoke.ps1
03_monitor_pinchbench_grok_build_windows.ps1
04_run_grok_build_full.ps1
05_resume_grok_build_run.ps1
06_bundle_grok_build_run_diagnostic.ps1
common_grok_build_runner.ps1
run_pinchbench_grok_build_windows.py
selftest_grok_build_runner.py
PACKAGE_SHA256SUMS
SHA256SUMS
README_CN
VERSION
```

### `run_pinchbench_grok_build_windows.py`

核心 Python Runner。

主要负责：

- 固定 PinchBench manifest / task selection；
- staging 隔离 workspace；
- 调用 Grok Build CLI；
- prompt 通过 UTF-8 `--prompt-file` 传递，避免 Windows argv 编码问题；
- 解析 `streaming-messages-json`；
- 保存原始 JSONL 与 stderr；
- 记录 session、tool call、TTFT、Token、model usage；
- 执行 timeout；
- 调用 PinchBench automated / hybrid / LLM Judge；
- 写入 `run_config.json`、results JSON / CSV / XLSX；
- 保存 `progress.jsonl`、partial results、transcripts、workspaces；
- 与 Adapter v0.2.0 做 health/version/compiler/model gate。

最终 Runner revision：

```text
2026-08-03-grok-build-windows-v1.1.0-canonical-history-adapter-0.2.0
```

### `common_grok_build_runner.ps1`

PowerShell 公共运行层。

负责多个 wrapper 共用的：

- Grok binary path；
- `GROK_HOME`；
- shared Python / PinchBench paths；
- Adapter health/version；
- proxy；
- Judge model；
- CLI/model identity；
- logs；
- environment preflight。

### `01_preflight_grok_build.ps1`

正式运行前门禁。

检查：

- Grok CLI version；
- binary；
- DeepSeek model alias / actual model；
- Adapter `0.2.0`；
- compiler `canonical-history-v1`；
- PinchBench commit / manifest；
- 143 tasks；
- fixtures / prerequisites；
- Judge readiness；
- worker / task concurrency；
- prompt/output transport。

### `02_run_grok_build_smoke.ps1`

正式全量前 smoke test。

用于验证：

```text
CLI
Adapter
DeepSeek route
workspace
local tools
grading
Judge
transcript
streaming JSON
```

### `03_monitor_pinchbench_grok_build_windows.ps1`

只读 monitor。

可以显式指定：

```text
-RunDir
```

显示正式 run 的完成数、成功/失败、timeout、score、近期任务等。

`Ctrl+C` 只停止 monitor，不改变正式 Runner 或 Adapter。

### `04_run_grok_build_full.ps1`

新的正式 143 题全量入口。

它建立新的：

```text
C:\pinchbench-grok-build\runs\grok_build_YYYYMMDD_HHMMSS
```

### `05_resume_grok_build_run.ps1`

对已存在的正式 run 做受控 resume。

它不会用于“挑最好结果”；用途是：

- 中断恢复；
- 已验证协议故障修复后的受控继续执行；
- 保持原 RunDir / provenance。

### `06_bundle_grok_build_run_diagnostic.ps1`

打包已有 run 的诊断材料。

用于故障复盘，不改变 Agent 执行结果。

### `selftest_grok_build_runner.py`

Runner 自检。

验证 parser、model usage aggregation、atomic-write 等基础行为，不代替正式 PinchBench smoke。

### `VERSION` / `SHA256SUMS` / `PACKAGE_SHA256SUMS`

保存 Runner package/version provenance 与文件完整性信息。

---

## 4. `search-adapter/` — Canonical Responses Adapter v0.2.0

这是当前正式协议兼容层。

正式服务：

```text
http://127.0.0.1:8767
```

Health identity：

```json
{
  "ok": true,
  "version": "0.2.0",
  "compiler": "canonical-history-v1",
  "target_model": "deepseek/deepseek-v4-pro"
}
```

### Why the Adapter Exists

Grok Build CLI 本地文件、Shell、JSON、多轮能力本身可以工作；兼容问题集中在 OpenRouter Responses / search / history dialect。

早期问题曾包括：

```text
openrouter:web_search event type
missing action
SSE [DONE]
reasoning/search history schema
nested input arrays
null/scalar array fields
provider-specific history
Responses 400 invalid_prompt
```

最终没有继续逐字段叠加 patch，而是建立完整的：

```text
Canonical History Compiler
```

---

## 5. Canonical History Compiler

Compiler identity：

```text
canonical-history-v1
```

它对历史记录按类型规范化：

```text
message
function_call
function_call_output
reasoning
web_search_call
```

并处理：

- `null` / scalar array field normalization；
- search history 的 `id/status/action/query/queries/sources`；
- 未知 provider history → standard message；
- 本地结构验证；
- tool argument / output normalization；
- malformed nested input recovery。

如果上游仍因 provider-specific history 返回一次：

```text
400 invalid_prompt
```

Adapter 会：

1. 先保存完整 request/error diagnostics；
2. 将 search/reasoning provider history 编译成 portable standard messages；
3. 只 retry 一次。

这不是 Agent 行为 patch，也不改变 task prompt；它是协议兼容层。

---

## 6. Key `search-adapter/` Scripts

最终目录中应重点保留：

```text
01_start_search_adapter.ps1
07_run_canonical_history_protocol_canary.ps1
08_run_research_task_isolated_v0_2_0.ps1
09_prepare_canonical_resume_v0_2_0a.ps1
```

以及 Adapter Python source、health/configuration scripts 与目录中其他协议测试资产。

### `01_start_search_adapter.ps1`

启动当前 v0.2.0 Adapter。

### `07_run_canonical_history_protocol_canary.ps1`

离线 deterministic protocol gate。

已覆盖：

```text
14 search-history items
sources=null normalization
structured write arguments/output
unknown provider history
forced rejection of provider web_search history
portable-history fallback
diagnostics-before-retry
```

它不调用外部模型，因此适合做安装后的确定性 gate。

### `08_run_research_task_isolated_v0_2_0.ps1`

真实 isolated research task 验证。

用于验证 canonical adapter 在真实 Agent + OpenRouter 环境中能够处理研究类多轮 history。

### `09_prepare_canonical_resume_v0_2_0a.ps1`

历史正式 run 的特定 resume-cleanup 工具。

它只服务于已验证的旧协议故障迁移；不是日常新 run 的前置步骤。

不要把它当成通用“失败后删结果重跑”脚本。

---

## 7. `packages/` — Installer / Migration Provenance

`packages/` 保存 Adapter / Runner 演进期间的安装包、补丁包和精确迁移 provenance。

可以包含早期：

```text
search adapter v0.1.x
runner package
runner adapter gate
long-write canary fixes
```

以及最终：

```text
grok_build_canonical_history_adapter_v0_2_0
grok_build_canonical_resume_cleanup_v0_2_0a
```

其中最终 Canonical History Adapter package identity：

```text
ZIP SHA-256:
e725088ce9d32fb67ae4a3e9899db13d658678da10ad1ce95bb33716a4700249

Adapter file SHA-256:
6fb11fdda725cd3a1fce1175fcf305789cb7b975341d31b2daefc4d192106513
```

Canonical Resume Cleanup v0.2.0a package：

```text
SHA-256:
b8cfe25cd04f8ccac423e62f838f04737fad34b1e67dd0cd6e8d0fb92ca03cac
```

早期 v0.1.x package 不属于当前正式执行链，但可以保留作为 migration provenance。

---

## 8. `archive/runner-hotfix-backup/`

本机 `runner/hotfix-backup` 是历史修复前文件。

为了“宁可多保留 provenance，也不污染 canonical runner”，仓库中建议移动为：

```text
archive/runner-hotfix-backup/
```

它的用途：

- 比较补丁前后差异；
- 审计 migration；
- regression investigation。

正式运行永远不从 `archive/` 读取文件。

---

## 9. Grok Build Binary Identity

本仓库不提交：

```text
C:\pinchbench-grok-build\bin\grok.exe
```

因为它是安装后的 Grok Build CLI binary，不是本 benchmark 项目自产源码。

应通过：

```text
manifests/grok-build-binary.txt
```

记录：

```text
version=grok 0.2.118 (1e1687c1cf)
sha256=8b365d13ba0956bd8015069a7230370dd11496cd18d03b5eb148a329a8d96f7c
```

复现时重新安装 CLI，并验证 version + SHA。

---

## 10. `source-reference/`

`source-reference/` 需要按内容处理。

如果它是某个第三方官方仓库的 **clean Git checkout**：

- 不重复 vendoring；
- 在 `manifests/source-reference-upstream.txt` 保存 remote / exact commit / clean status。

如果它：

- 不是 Git checkout；或
- 包含本项目自己的修改；

则应保留到仓库中的：

```text
source-reference/
```

这样避免丢失本地修改。

---

## 11. Shared `pinchbench/runtime`

Grok Build Framework 不单独维护 Python 虚拟环境。

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

固定 PinchBench：

```text
819384ae830492365b8363fc26bc2602e73f216d
```

Grok Build 本目录负责 Framework / Adapter；共享 runtime 负责：

- Python dependencies；
- PinchBench source；
- grading dependencies。

---

## 12. Local Runtime Directories Not Stored Here

本机这些目录不是项目源码：

```text
C:\pinchbench-grok-build\benchmark-home
C:\pinchbench-grok-build\grok-home
C:\pinchbench-grok-build\bin
C:\pinchbench-grok-build\canary
C:\pinchbench-grok-build\canary-runs
C:\pinchbench-grok-build\logs
C:\pinchbench-grok-build\runs
```

说明：

- `benchmark-home/`：正式 benchmark GROK_HOME；
- `grok-home/`：交互/配置 GROK_HOME；
- `bin/`：安装后的 CLI binary；
- `canary/`：临时 canary workspace/output；
- `canary-runs/`：真实 canary run evidence；
- `logs/`：运行日志；
- `runs/`：正式 benchmark evidence。

这些可以单独归档，但不定义源码 Git tree。

---

## 13. Formal Three-Window Runtime

### Window A — Adapter

正式入口：

```text
search-adapter/01_start_search_adapter.ps1
```

职责：

```text
Grok Build Responses dialect
↔
Canonical History Compiler
↔
OpenRouter / DeepSeek
```

### Window B — Runner

正式入口：

```text
runner/01_preflight_grok_build.ps1
runner/02_run_grok_build_smoke.ps1
runner/04_run_grok_build_full.ps1
runner/05_resume_grok_build_run.ps1
```

职责：

```text
PinchBench execution
+
grading
+
Judge
```

### Window C — Monitor

正式入口：

```text
runner/03_monitor_pinchbench_grok_build_windows.ps1
```

职责：

```text
read-only progress monitoring
```

---

## 14. Final Protocol Gate

安装或恢复环境后，Adapter health 必须是：

```text
version = 0.2.0
compiler = canonical-history-v1
target_model = deepseek/deepseek-v4-pro
```

deterministic gate：

```text
07_run_canonical_history_protocol_canary.ps1
```

成功标准包括：

```text
strict native mock accepted canonical history
portable-history retry recovered from forced rejection
provider-specific search history removed in fallback
standard message/tool history retained
full diagnostics written before retry
```

---

## 15. Reproducibility Boundary

本目录负责固定：

```text
Grok Windows Runner
Canonical Responses Adapter
canonical-history compiler
protocol canaries
migration/install packages
resume migration tooling
CLI binary identity
source-reference identity
benchmark-specific Windows behavior
```

它不负责保存：

```text
OPENROUTER_API_KEY
GROK_HOME runtime state
installed Grok binary
Python virtualenv
PinchBench runtime copy
formal run outputs
canary outputs
logs
workspaces
transcripts
judge raw responses
Python cache
```

最终可复现身份：

```text
Grok Build 0.2.118
+
binary SHA-256
8b365d13ba0956bd8015069a7230370dd11496cd18d03b5eb148a329a8d96f7c
+
Windows Grok Build Runner
2026-08-03-grok-build-windows-v1.1.0-canonical-history-adapter-0.2.0
+
Canonical Responses Adapter v0.2.0
+
canonical-history-v1
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
