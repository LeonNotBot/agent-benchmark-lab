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

Write-Host "Starting formal frozen-output regrade..."
Write-Host ("Judge: " + $JudgeModel)
Write-Host "Jobs: 572 total; 472 require the LLM Judge."
Write-Host (
    "Original runs are read-only. Every workspace is copied to scratch."
)
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
        "--suite", "full",
        "--judge-model", $JudgeModel
    ) `
    -WorkingDirectory $Root `
    -LogPrefix "full"

if ($Process.ExitCode -ne 0) {
    throw (
        "Formal regrade stopped or failed. " +
        "Use 05_resume_regrade.ps1 to continue."
    )
}

Write-Host "PASS: formal regrade completed." `
    -ForegroundColor Green
