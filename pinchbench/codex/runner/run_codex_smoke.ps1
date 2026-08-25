param(
    [string]$Root = "C:\pinchbench-codex",
    [string]$Python = "C:\pinchbench-opencode\.venv\Scripts\python.exe",
    [string]$ProxyUrl = "http://127.0.0.1:10090"
)

# PinchBench Codex Windows mixed two-task smoke test
# Tasks:
#   task_sanity : non-network
#   task_stock  : network
#
# Comparability note:
# - Reuses the same Python venv used by the Qwen Code smoke runner.
# - Changes only the smoke-test task pair; the formal runner is unchanged.
# - Task order is fixed: non-network first, network second.
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

$Runner = "$Root\runner\run_pinchbench_codex_windows.py"
$Skill = "$Root\skill"
$Codex = "$Root\codex-cli\node_modules\.bin\codex.cmd"
$CodexHome = "$Root\codex-home"
$Config = "$CodexHome\config.toml"
$Runs = "$Root\runs"
$Logs = "$Root\logs"
$Model = "deepseek/deepseek-v4-pro"
$Suite = "task_sanity,task_stock"

$env:CODEX_HOME = $CodexHome
$env:PYTHONUTF8 = "1"
$env:PYTHONIOENCODING = "utf-8"
$env:NO_COLOR = "1"
$env:FORCE_COLOR = "0"

if (-not [string]::IsNullOrWhiteSpace($ProxyUrl)) {
    $env:HTTP_PROXY = $ProxyUrl
    $env:HTTPS_PROXY = $ProxyUrl
    $env:ALL_PROXY = $ProxyUrl
    $env:NO_PROXY = "localhost,127.0.0.1,::1"
}

New-Item -ItemType Directory -Path $Runs -Force | Out-Null
New-Item -ItemType Directory -Path $Logs -Force | Out-Null

$Required = @($Python, $Runner, $Skill, $Codex, $Config)
foreach ($Path in $Required) {
    if (-not (Test-Path -LiteralPath $Path)) {
        throw "找不到必要路径：$Path"
    }
}

if (
    [string]::IsNullOrWhiteSpace($env:OPENROUTER_API_KEY) -or
    $env:OPENROUTER_API_KEY -eq "你的 OpenRouter Key" -or
    $env:OPENROUTER_API_KEY -eq "你的 OpenRouter API Key"
) {
    throw "当前 PowerShell 没有设置真实的 OPENROUTER_API_KEY。请先在本窗口设置真实 Key。"
}

Write-Host "Python environment : $Python"
Write-Host "Smoke suite        : $Suite"
Write-Host "  non-network      : task_sanity"
Write-Host "  network          : task_stock"
Write-Host "Model              : $Model"
Write-Host "Worker/concurrency : 1 / 1"
Write-Host ""

$Stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$ConsoleLog = "$Logs\codex-smoke-mixed-$Stamp.txt"
$ExitCode = 1

Set-Location $Root
Start-Transcript -Path $ConsoleLog -Force
try {
    & $Python $Runner `
        --skill-dir $Skill `
        --codex $Codex `
        --expected-codex-version "0.145.0" `
        --model $Model `
        --approval-policy never `
        --sandbox-mode workspace-write `
        --windows-sandbox unelevated `
        --suite $Suite `
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
    Where-Object { $_.Name -like "codex_*" } |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1

Write-Host ""
Write-Host "Runner exit code: $ExitCode"
Write-Host "Console log: $ConsoleLog"
if ($null -ne $LatestRun) {
    Write-Host "Latest run: $($LatestRun.FullName)"
}

exit $ExitCode
