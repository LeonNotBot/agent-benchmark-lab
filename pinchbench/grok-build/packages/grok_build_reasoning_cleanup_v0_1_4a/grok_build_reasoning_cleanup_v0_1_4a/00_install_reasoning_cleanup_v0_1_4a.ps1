param(
    [string]$Root="C:\pinchbench-grok-build",
    [string]$Python="C:\pinchbench-opencode\.venv\Scripts\python.exe"
)
$ErrorActionPreference="Stop"
[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false)
$global:OutputEncoding=New-Object System.Text.UTF8Encoding($false)

$Source=Split-Path -Parent $MyInvocation.MyCommand.Path
$Destination=Join-Path $Root "search-adapter"
if(-not(Test-Path -LiteralPath $Python)){throw "Python not found: $Python"}
if(-not(Test-Path -LiteralPath $Destination)){throw "Search Adapter directory not found: $Destination"}

$Health=Invoke-RestMethod -Uri "http://127.0.0.1:8767/healthz" -TimeoutSec 5
if(-not$Health.ok-or[string]$Health.version-ne"0.1.4"-or[string]$Health.target_model-ne"deepseek/deepseek-v4-pro"){
    throw "Expected healthy live Adapter v0.1.4 targeting DeepSeek. Actual: $($Health|ConvertTo-Json -Compress)"
}

foreach($Name in @(
    "prepare_reasoning_summary_failures_for_resume_v0_1_4a.py",
    "09_prepare_reasoning_summary_failures_for_resume_v0_1_4a.ps1"
)){
    Copy-Item -LiteralPath (Join-Path $Source $Name) -Destination (Join-Path $Destination $Name) -Force
}

& $Python -X utf8 -m py_compile (Join-Path $Destination "prepare_reasoning_summary_failures_for_resume_v0_1_4a.py")
if($LASTEXITCODE-ne0){throw "Cleanup helper compile check failed."}

Write-Host "PASS: reasoning-summary cleanup v0.1.4a installed." -ForegroundColor Green
Write-Host "This package does not modify Adapter code, Runner code, or benchmark progress."
Write-Host "Use 09_prepare_reasoning_summary_failures_for_resume_v0_1_4a.ps1; do not use the older cleanup script."
