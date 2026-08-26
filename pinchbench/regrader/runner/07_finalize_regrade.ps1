param(
    [string]$Python = "",
    [string]$RunDir = ""
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

$Root = "C:\pinchbench-regrader"
. (Join-Path $Root "common_regrade.ps1")
$ResolvedPython = Resolve-RegradePython -Python $Python

$Arguments = @(
    "-X", "utf8",
    (Join-Path $Root "regrade_pinchbench.py"),
    "--config",
    (Join-Path $Root "regrade_config.json"),
    "finalize"
)

if (-not [string]::IsNullOrWhiteSpace($RunDir)) {
    $Arguments += @("--run-dir", $RunDir)
}

$Process = Invoke-RegradeProcess `
    -Python $ResolvedPython `
    -Arguments $Arguments `
    -WorkingDirectory $Root `
    -LogPrefix "finalize"

if ($Process.ExitCode -ne 0) {
    throw "Regrade export finalization failed."
}

Write-Host "PASS: regrade exports generated." `
    -ForegroundColor Green
