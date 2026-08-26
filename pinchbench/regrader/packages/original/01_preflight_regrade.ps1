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

$Process = Invoke-RegradeProcess `
    -Python $ResolvedPython `
    -Arguments @(
        "-X", "utf8",
        (Join-Path $Root "regrade_pinchbench.py"),
        "--config",
        (Join-Path $Root "regrade_config.json"),
        "preflight",
        "--judge-model",
        $JudgeModel
    ) `
    -WorkingDirectory $Root `
    -LogPrefix "preflight"

if ($Process.ExitCode -ne 0) {
    throw "Regrade preflight failed."
}

Write-Host "PASS: regrade preflight passed." `
    -ForegroundColor Green
