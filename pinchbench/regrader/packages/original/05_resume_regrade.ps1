param(
    [string]$Python = "",
    [string]$ProxyUrl = "http://127.0.0.1:10090",
    [string]$RunDir = "",
    [switch]$RetryFailed
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

$Root = "C:\pinchbench-regrader"
. (Join-Path $Root "common_regrade.ps1")

Assert-RegradeKey
Set-RegradeProxy -ProxyUrl $ProxyUrl
$ResolvedPython = Resolve-RegradePython -Python $Python

$Arguments = @(
    "-X", "utf8",
    (Join-Path $Root "regrade_pinchbench.py"),
    "--config",
    (Join-Path $Root "regrade_config.json"),
    "resume"
)

if (-not [string]::IsNullOrWhiteSpace($RunDir)) {
    $Arguments += @("--run-dir", $RunDir)
}

if ($RetryFailed) {
    $Arguments += "--retry-failed"
}

$Process = Invoke-RegradeProcess `
    -Python $ResolvedPython `
    -Arguments $Arguments `
    -WorkingDirectory $Root `
    -LogPrefix "resume"

if ($Process.ExitCode -ne 0) {
    throw (
        "Resume stopped or failed. Progress remains saved."
    )
}

Write-Host "PASS: regrade resume completed." `
    -ForegroundColor Green
