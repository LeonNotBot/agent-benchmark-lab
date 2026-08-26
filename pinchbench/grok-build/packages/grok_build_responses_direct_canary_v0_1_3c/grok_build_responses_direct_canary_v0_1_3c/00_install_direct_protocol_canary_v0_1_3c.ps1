param(
    [string]$Destination = "C:\pinchbench-grok-build\search-adapter",
    [string]$Python = "C:\pinchbench-opencode\.venv\Scripts\python.exe"
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$global:OutputEncoding = New-Object System.Text.UTF8Encoding($false)

$Source = Split-Path -Parent $MyInvocation.MyCommand.Path
$Adapter = Join-Path $Destination "grok_build_search_adapter.py"
$ExpectedAdapterHash = "85e31d546110bca5c72c0a51b03f555d7d093f64b7717754fd47cbe1d3a70906"
$ExpectedProbeHash = "911283e538fca12b6dd89b6859922677f8ca1ebc5cfa60d4d773f4e70a15c321"
$ExpectedRunHash = "2e623212771f33197870580b2ec3f8dc96d36052e37b8fcf580c00c674f5afef"

if (-not (Test-Path -LiteralPath $Adapter)) {
    throw "Installed adapter not found: $Adapter"
}
if (-not (Test-Path -LiteralPath $Python)) {
    throw "Python not found: $Python"
}

$ActualAdapterHash = (Get-FileHash -LiteralPath $Adapter -Algorithm SHA256).Hash.ToLowerInvariant()
if ($ActualAdapterHash -ne $ExpectedAdapterHash) {
    throw "Expected exact Adapter v0.1.3 core. Current SHA256=$ActualAdapterHash"
}

Copy-Item -LiteralPath (Join-Path $Source "direct_protocol_canary.py") -Destination (Join-Path $Destination "direct_protocol_canary.py") -Force
Copy-Item -LiteralPath (Join-Path $Source "07_run_direct_protocol_canary.ps1") -Destination (Join-Path $Destination "07_run_direct_protocol_canary.ps1") -Force

$ActualProbeHash = (Get-FileHash -LiteralPath (Join-Path $Destination "direct_protocol_canary.py") -Algorithm SHA256).Hash.ToLowerInvariant()
$ActualRunHash = (Get-FileHash -LiteralPath (Join-Path $Destination "07_run_direct_protocol_canary.ps1") -Algorithm SHA256).Hash.ToLowerInvariant()
if ($ActualProbeHash -ne $ExpectedProbeHash) {
    throw "Installed Python probe SHA256 mismatch: $ActualProbeHash"
}
if ($ActualRunHash -ne $ExpectedRunHash) {
    throw "Installed PowerShell runner SHA256 mismatch: $ActualRunHash"
}

& $Python -X utf8 -m py_compile (Join-Path $Destination "direct_protocol_canary.py")
if ($LASTEXITCODE -ne 0) {
    throw "Direct protocol canary compile check failed."
}

Write-Host "PASS: deterministic direct protocol canary v0.1.3c installed." -ForegroundColor Green
Write-Host "Adapter core SHA256 remains: $ActualAdapterHash"
Write-Host "Adapter restart is not required."
