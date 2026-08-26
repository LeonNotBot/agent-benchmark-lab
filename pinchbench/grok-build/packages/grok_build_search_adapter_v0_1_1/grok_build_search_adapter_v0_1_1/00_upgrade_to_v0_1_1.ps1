param(
    [string]$Destination = "C:\pinchbench-grok-build\search-adapter",
    [string]$Python = "C:\pinchbench-opencode\.venv\Scripts\python.exe"
)

$ErrorActionPreference = "Stop"
$Source = Split-Path -Parent $MyInvocation.MyCommand.Path
$Current = Join-Path $Destination "grok_build_search_adapter.py"
$ExpectedOldHash = "4e33c038652b5d3c8df9a18caec3c3e515e47b1e87427b1030a8e78bb6662653"
$ExpectedNewHash = "2ac246b1470fea24acae8c609f425004c720f06c9bedb3a15cdecc2c0b8304f2"

if (-not (Test-Path -LiteralPath $Destination)) {
    throw "Adapter destination does not exist: $Destination"
}
if (-not (Test-Path -LiteralPath $Current)) {
    throw "Installed adapter not found: $Current"
}
if (-not (Test-Path -LiteralPath $Python)) {
    throw "Python not found: $Python"
}

$ActualOldHash = (Get-FileHash -LiteralPath $Current -Algorithm SHA256).Hash.ToLowerInvariant()
if ($ActualOldHash -ne $ExpectedOldHash -and $ActualOldHash -ne $ExpectedNewHash) {
    throw "Refusing to replace an unexpected adapter. Current SHA256=$ActualOldHash"
}

$Stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$Backup = "$Current.backup-$Stamp"
Copy-Item -LiteralPath $Current -Destination $Backup -Force

Copy-Item -LiteralPath (Join-Path $Source "grok_build_search_adapter.py") -Destination $Current -Force
Copy-Item -LiteralPath (Join-Path $Source "03_run_web_search_adapter_canary.ps1") -Destination (Join-Path $Destination "03_run_web_search_adapter_canary.ps1") -Force
Copy-Item -LiteralPath (Join-Path $Source "04_collect_adapter_evidence.ps1") -Destination (Join-Path $Destination "04_collect_adapter_evidence.ps1") -Force
Copy-Item -LiteralPath (Join-Path $Source "test_adapter_normalization.py") -Destination (Join-Path $Destination "test_adapter_normalization.py") -Force

$ActualNewHash = (Get-FileHash -LiteralPath $Current -Algorithm SHA256).Hash.ToLowerInvariant()
if ($ActualNewHash -ne $ExpectedNewHash) {
    throw "Installed adapter SHA256 mismatch. Expected=$ExpectedNewHash Actual=$ActualNewHash"
}

& $Python (Join-Path $Destination "test_adapter_normalization.py")
if ($LASTEXITCODE -ne 0) {
    throw "Adapter normalization self-test failed."
}

Write-Host "PASS: Grok Build search adapter upgraded to v0.1.1."
Write-Host "Backup : $Backup"
Write-Host "SHA256 : $ActualNewHash"
Write-Host "IMPORTANT: Restart the adapter process in Window A before rerunning the canary."
Write-Host "PinchBench Runner files were not modified."
