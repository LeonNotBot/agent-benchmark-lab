param(
    [string]$Root = "C:\pinchbench-grok-build",
    [string]$Python = "C:\pinchbench-opencode\.venv\Scripts\python.exe"
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$global:OutputEncoding = New-Object System.Text.UTF8Encoding($false)

$Adapter = Join-Path $Root "search-adapter\grok_build_search_adapter.py"
$Probe = Join-Path $Root "search-adapter\direct_protocol_canary.py"
$ExpectedAdapterHash = "85e31d546110bca5c72c0a51b03f555d7d093f64b7717754fd47cbe1d3a70906"

if (-not (Test-Path -LiteralPath $Python)) {
    throw "Python not found: $Python"
}
if (-not (Test-Path -LiteralPath $Adapter)) {
    throw "Installed adapter not found: $Adapter"
}
if (-not (Test-Path -LiteralPath $Probe)) {
    throw "Direct protocol canary not found: $Probe"
}

$ActualAdapterHash = (Get-FileHash -LiteralPath $Adapter -Algorithm SHA256).Hash.ToLowerInvariant()
if ($ActualAdapterHash -ne $ExpectedAdapterHash) {
    throw "Expected exact Adapter v0.1.3 core. Current SHA256=$ActualAdapterHash"
}

$env:NO_PROXY = "localhost,127.0.0.1,::1"
$env:no_proxy = "localhost,127.0.0.1,::1"

& $Python -X utf8 $Probe --adapter $Adapter --expected-version "0.1.3"
if ($LASTEXITCODE -ne 0) {
    throw "Direct Responses protocol canary failed."
}

Write-Host ""
Write-Host "PASS: deterministic Responses protocol gate completed." -ForegroundColor Green
Write-Host "The installed Adapter v0.1.3 repaired the exact malformed request shape without using an external model call."
