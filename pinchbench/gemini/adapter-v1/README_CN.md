# Gemini CLI → OpenRouter Adapter v1

## 目标

把 Google Gemini CLI 0.52.0 的 Gemini `streamGenerateContent` 请求转换为 OpenRouter Responses API 请求，并把 OpenRouter 的文本、工具调用、Usage 和错误转换回 Gemini SSE。

正式模型固定为：

```text
deepseek/deepseek-v4-pro
```

本包不会保存或输出 OpenRouter Key。Gemini CLI 使用的 `AIza...` 字符串只是发往本机适配器的无敏感性占位符。

## 已验证内容

包内单元测试和本地 HTTP 集成测试覆盖：

- Gemini `contents`、`systemInstruction`、`generationConfig` 转换；
- `parametersJsonSchema` 到 OpenRouter function tool；
- `functionCall` 与 `functionResponse` 的历史配对；
- OpenRouter Responses 文本流；
- OpenRouter Responses function call 流；
- Usage 和 finish reason 转换；
- Gemini SSE 本地端到端请求。

## 使用顺序

### 1. 解压

建议目录：

```powershell
$Zip = "$HOME\Downloads\gemini_openrouter_adapter_v1.zip"
$AdapterDir = "C:\pinchbench-gemini\adapter-v1"

Remove-Item -LiteralPath $AdapterDir -Recurse -Force -ErrorAction SilentlyContinue
Expand-Archive -LiteralPath $Zip -DestinationPath $AdapterDir -Force
```

### 2. 在已有 OpenRouter Key 的窗口验证

```powershell
powershell.exe `
    -NoProfile `
    -ExecutionPolicy Bypass `
    -File "C:\pinchbench-gemini\adapter-v1\01_verify_adapter.ps1"
```

应显示：

```text
PASS: adapter package verification completed.
```

### 3. 窗口 A 启动适配器

窗口 A 必须已经加载 `OPENROUTER_API_KEY`，并保留此前验证通过的代理变量。

```powershell
powershell.exe `
    -NoProfile `
    -ExecutionPolicy Bypass `
    -File "C:\pinchbench-gemini\adapter-v1\02_start_adapter.ps1"
```

应显示包含以下字段的 JSON：

```text
"status":"ready"
"url":"http://127.0.0.1:8766"
"forced_model":"deepseek/deepseek-v4-pro"
"api_key_present":true
```

保持窗口 A 打开。

### 4. 窗口 B 执行五组 canary

```powershell
powershell.exe `
    -NoProfile `
    -ExecutionPolicy Bypass `
    -File "C:\pinchbench-gemini\adapter-v1\03_run_canaries.ps1"
```

测试内容：

1. 文本流和完整 `result`；
2. `write_file`、`read_file` 与 UTF-8；
3. Windows `run_shell_command`；
4. 16,000 字符、250 行长文件；
5. session 与 `--resume`。

临时跳过长文件时可加：

```powershell
-SkipLong
```

正式进入 runner 修改之前，必须再跑一次不带 `-SkipLong` 的完整 canary。

### 5. 生成摘要

```powershell
powershell.exe `
    -NoProfile `
    -ExecutionPolicy Bypass `
    -File "C:\pinchbench-gemini\adapter-v1\04_summarize_canaries.ps1"
```

关键字段：

```json
{
  "all_executed_passed": true,
  "adapter_failure_count": 0,
  "ready_for_runner_work": true
}
```

### 6. 打包诊断结果

```powershell
powershell.exe `
    -NoProfile `
    -ExecutionPolicy Bypass `
    -File "C:\pinchbench-gemini\adapter-v1\05_bundle_diagnostics.ps1"
```

桌面会生成：

```text
gemini-adapter-canary-diagnostic-日期时间.zip
```

## 固定防错规则

- PowerShell 5.1 调用 Gemini CLI 统一使用 `Start-Process` 分离 stdout、stderr 和退出码，避免普通 stderr 被误判为 `NativeCommandError`。
- PowerShell 脚本采用 ASCII；需要的中文和符号在运行时由 Unicode 码点构造。
- 哈希清单先在 staging 外生成，再移动进去，绝不计算自身哈希。
- 不假定下载目录中的精确文件名。
- 失败后保留 canary run 目录，诊断脚本直接复用，不要求重新执行高成本任务。
- 适配器默认不记录 prompt、系统指令、工具参数或工具结果正文。
- 正式 PinchBench 运行不允许任务级选择性重试，不允许覆盖原始状态和分数。

## 日志

```text
C:\pinchbench-gemini\logs\adapter-v1\adapter_requests.jsonl
C:\pinchbench-gemini\logs\adapter-v1\adapter_upstream_events.jsonl
C:\pinchbench-gemini\canary-runs\gemini_adapter_*\
```

默认日志只包含模型、工具名称、Usage、事件类型、状态、耗时和脱敏错误。设置 `ADAPTER_LOG_PAYLOADS=1` 才会记录转换后的完整 payload；正式测试必须保持为 `0`。

## 当前限制

- `countTokens` 使用保守的字符估算；正式生成的 Usage 取自 OpenRouter。
- `topK` 没有直接映射到 Responses API，日志会记录为 ignored generation field。
- `thinkingConfig.includeThoughts` 默认不改变 OpenRouter reasoning 参数，保留 DeepSeek/OpenRouter 默认行为。
- 图像、音频和文件二进制 part 在 v1 中会转换为文字说明；PinchBench 的图像任务仍主要依赖 Gemini CLI 暴露的工具。
- 只有五组 canary 全部通过后，才开始修改 PinchBench runner。
