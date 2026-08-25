param(
    [string]$Root = "C:\pinchbench-opencode-kimi",
    [string]$ProxyUrl = "http://127.0.0.1:10090"
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

$Python = Join-Path $Root ".venv\Scripts\python.exe"
$Runner = Join-Path $Root "runner\run_pinchbench_opencode_kimi_windows.py"
if (-not (Test-Path -LiteralPath $Python)) { throw "Python not found: $Python" }
if (-not (Test-Path -LiteralPath $Runner)) { throw "Runner not found: $Runner" }
if ([string]::IsNullOrWhiteSpace($env:OPENROUTER_API_KEY)) { throw "OPENROUTER_API_KEY is missing in this PowerShell window" }

$env:PYTHONUTF8 = "1"
$env:PYTHONIOENCODING = "utf-8"
$env:NODE_USE_ENV_PROXY = "1"
$env:HTTP_PROXY = $ProxyUrl
$env:HTTPS_PROXY = $ProxyUrl
$env:ALL_PROXY = $ProxyUrl
$env:http_proxy = $ProxyUrl
$env:https_proxy = $ProxyUrl
$env:all_proxy = $ProxyUrl
$env:NO_PROXY = "localhost,127.0.0.1,::1"
$env:no_proxy = $env:NO_PROXY

$Tasks = "task_competitive_research,task_log_syslog_auth_failures"

Write-Host "Two-task timeout probe" -ForegroundColor Cyan
Write-Host "  Network probe    : task_competitive_research (original 300s timeout)"
Write-Host "  Non-network probe: task_log_syslog_auth_failures (original task timeout x3 = 540s)"
Write-Host "  Grading          : disabled; this probe measures Agent completion/reliability only"
Write-Host "  Model            : openrouter/moonshotai/kimi-k3"

& $Python -X utf8 $Runner --skill-dir (Join-Path $Root "skill") --suite $Tasks --model "openrouter/moonshotai/kimi-k3" --results-dir (Join-Path $Root "runs") --timeout-multiplier 3 --network-timeout 300 --keep-workspaces --no-grade --verbose
if ($LASTEXITCODE -ne 0) { throw "Probe runner exited with code $LASTEXITCODE" }
