param(
    [string]$Root = "C:\pinchbench-codex"
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

$Monitor = Join-Path $Root "runner\monitor_pinchbench_codex_windows.ps1"

if (-not (Test-Path -LiteralPath $Monitor)) {
    throw "Monitor script not found: $Monitor"
}

& powershell.exe `
    -NoProfile `
    -ExecutionPolicy Bypass `
    -File $Monitor

exit $LASTEXITCODE
