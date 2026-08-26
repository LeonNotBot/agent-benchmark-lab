# PinchBench Qwen Code Windows two-task smoke test
# Tasks: task_sanity + task_iterative_code_refine
$ErrorActionPreference = "Stop"

$Root = "C:\pinchbench-qwen-code"
$Python = "C:\pinchbench-opencode\.venv\Scripts\python.exe"
$Runner = "$Root\runner\run_pinchbench_qwen_code_windows.py"
$Skill = "$Root\skill"
$Qwen = "$Root\qwen-cli\node_modules\.bin\qwen.cmd"
$Runs = "$Root\runs"
$Logs = "$Root\logs"
$Model = "deepseek/deepseek-v4-pro"

$env:QWEN_HOME = "$Root\qwen-home"
$env:QWEN_RUNTIME_DIR = "$Root\qwen-runtime"
$env:QWEN_TELEMETRY_ENABLED = "0"
$env:QWEN_CODE_SAFE_MODE = "true"
$env:QWEN_CODE_SUPPRESS_YOLO_WARNING = "1"

New-Item -ItemType Directory -Path $Runs -Force | Out-Null
New-Item -ItemType Directory -Path $Logs -Force | Out-Null
New-Item -ItemType Directory -Path $env:QWEN_HOME -Force | Out-Null
New-Item -ItemType Directory -Path $env:QWEN_RUNTIME_DIR -Force | Out-Null

$Required = @($Python, $Runner, $Skill, $Qwen, "$env:QWEN_HOME\settings.json")
foreach ($Path in $Required) {
    if (-not (Test-Path -LiteralPath $Path)) {
        throw "找不到必要路径：$Path"
    }
}

if ([string]::IsNullOrWhiteSpace($env:OPENROUTER_API_KEY)) {
    throw "当前 PowerShell 没有 OPENROUTER_API_KEY。请先在本窗口设置。"
}

$Stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$ConsoleLog = "$Logs\qwen-code-smoke-$Stamp.txt"
$ExitCode = 1

Set-Location $Root
Start-Transcript -Path $ConsoleLog -Force
try {
    & $Python $Runner `
        --skill-dir $Skill `
        --qwen-code $Qwen `
        --expected-qwen-version "0.20.1" `
        --model $Model `
        --auth-type openai `
        --approval-mode yolo `
        --suite "task_sanity,task_iterative_code_refine" `
        --timeout-multiplier 3.0 `
        --network-timeout 300 `
        --judge-timeout 300 `
        --results-dir $Runs `
        --keep-workspaces `
        --clear-judge-cache `
        --verbose

    $ExitCode = $LASTEXITCODE
}
finally {
    Stop-Transcript
}

$LatestRun = Get-ChildItem -LiteralPath $Runs -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -like "qwen_code_*" } |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1

Write-Host ""
Write-Host "Runner exit code: $ExitCode"
Write-Host "Console log: $ConsoleLog"
if ($null -ne $LatestRun) {
    Write-Host "Latest run: $($LatestRun.FullName)"
}

exit $ExitCode
