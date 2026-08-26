param(
    [string]$Root = "C:\pinchbench-gemini"
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

$RunnerDir = Join-Path $Root "runner"
if (-not (Test-Path -LiteralPath $RunnerDir)) {
    throw "Runner directory not found: $RunnerDir"
}

$Files = @(
    "03b_run_gemini_events_language_canary.ps1",
    "Collect_Current_Gemini_V13_Deep_Canary.ps1"
)

foreach ($Name in $Files) {
    $Source = Join-Path $PSScriptRoot $Name
    if (-not (Test-Path -LiteralPath $Source)) {
        throw "Package file missing: $Source"
    }
    Copy-Item `
        -LiteralPath $Source `
        -Destination (Join-Path $RunnerDir $Name) `
        -Force
}

Write-Host "PASS: Exact diagnostic tools installed."
Write-Host "No existing Runner, Adapter, canary, or full-run file was modified."
foreach ($Name in $Files) {
    Write-Host ("  " + (Join-Path $RunnerDir $Name))
}
