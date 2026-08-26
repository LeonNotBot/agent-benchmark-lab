param(
    [string]$Python = "",
    [string]$ProxyUrl = "http://127.0.0.1:10090",
    [string]$JudgeModel = "openrouter/anthropic/claude-opus-5"
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

$Root = "C:\pinchbench-regrader"
. (Join-Path $Root "common_regrade.ps1")

Assert-RegradeKey
Set-RegradeProxy -ProxyUrl $ProxyUrl
$ResolvedPython = Resolve-RegradePython -Python $Python

Write-Host (
    "Starting 12-job smoke: 3 grading types x 4 agents."
)
Write-Host ("Judge: " + $JudgeModel)
Write-Host (
    "Open another PowerShell and run 03_monitor_regrade.ps1."
)

$Process = Invoke-RegradeProcess `
    -Python $ResolvedPython `
    -Arguments @(
        "-X", "utf8",
        (Join-Path $Root "regrade_pinchbench.py"),
        "--config",
        (Join-Path $Root "regrade_config.json"),
        "run",
        "--suite", "smoke",
        "--judge-model", $JudgeModel
    ) `
    -WorkingDirectory $Root `
    -LogPrefix "smoke"

if ($Process.ExitCode -ne 0) {
    throw "Regrade smoke did not complete successfully."
}

Write-Host "PASS: regrade smoke completed." `
    -ForegroundColor Green
