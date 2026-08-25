param(
    [string]$Root = "C:\pinchbench-opencode-kimi",
    [string]$RunDir = "C:\pinchbench-opencode-kimi\runs\opencode_kimi_k3_20260810_180834",
    [string]$ProxyUrl = "http://127.0.0.1:10090",
    [string]$JudgeModel = "openrouter/anthropic/claude-opus-5",
    [ValidateSet("full","problems")]
    [string]$Scope = "full"
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

$Python = Join-Path $Root ".venv\Scripts\python.exe"
$Script = Join-Path $Root "runner\regrade_kimi_frozen_outputs.py"

if (-not (Test-Path -LiteralPath $Python)) { throw "Python not found: $Python" }
if (-not (Test-Path -LiteralPath $Script)) { throw "Regrader not found: $Script" }
if ([string]::IsNullOrWhiteSpace($env:OPENROUTER_API_KEY)) { throw "OPENROUTER_API_KEY is missing in this PowerShell window" }

$env:PYTHONUTF8 = "1"
$env:PYTHONIOENCODING = "utf-8"
$env:HTTP_PROXY = $ProxyUrl
$env:HTTPS_PROXY = $ProxyUrl
$env:ALL_PROXY = $ProxyUrl
$env:http_proxy = $ProxyUrl
$env:https_proxy = $ProxyUrl
$env:all_proxy = $ProxyUrl
$env:NO_PROXY = "localhost,127.0.0.1,::1"
$env:no_proxy = $env:NO_PROXY

Write-Host "Starting frozen-output regrade..."
Write-Host ("Source run: " + $RunDir)
Write-Host ("Judge: " + $JudgeModel)
Write-Host ("Scope: " + $Scope)
Write-Host "Original Agent outputs and original results are read-only."

& $Python -X utf8 $Script --root $Root --run-dir $RunDir --judge-model $JudgeModel --judge-timeout 300 --scope $Scope --verbose
if ($LASTEXITCODE -ne 0) { throw "Regrade failed with exit code $LASTEXITCODE" }
