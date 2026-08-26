param(
    [string]$Destination = "C:\pinchbench-grok-build\search-adapter"
)

$ErrorActionPreference = "Stop"
$Source = Split-Path -Parent $MyInvocation.MyCommand.Path
$Installed = Join-Path $Destination "05_run_long_write_wire_canary.ps1"
$ExpectedOldHash = "5a6eef07afe889aa9cc17fb2326ed4896b59509744349d3417492ef535280b8c"
$ExpectedNewHash = "f50069a0aee0d22521319b4d716b0550e7e7dbd14c13a8b4c0d0be76f2fd83b3"

if (-not (Test-Path -LiteralPath $Installed)) {
    throw "Installed long-write canary not found: $Installed"
}

$ActualHash = (Get-FileHash -LiteralPath $Installed -Algorithm SHA256).Hash.ToLowerInvariant()
if ($ActualHash -ne $ExpectedOldHash -and $ActualHash -ne $ExpectedNewHash) {
    throw "Refusing to replace an unexpected canary. Current SHA256=$ActualHash"
}

$Backup = "$Installed.backup-$(Get-Date -Format yyyyMMdd-HHmmss)"
Copy-Item -LiteralPath $Installed -Destination $Backup -Force
Copy-Item -LiteralPath (Join-Path $Source "05_run_long_write_wire_canary.ps1") -Destination $Installed -Force

$InstalledHash = (Get-FileHash -LiteralPath $Installed -Algorithm SHA256).Hash.ToLowerInvariant()
if ($InstalledHash -ne $ExpectedNewHash) {
    throw "Installed canary SHA256 mismatch. Expected=$ExpectedNewHash Actual=$InstalledHash"
}

Write-Host "PASS: long-write canary v0.1.3a installed." -ForegroundColor Green
Write-Host "Backup : $Backup"
Write-Host "SHA256 : $InstalledHash"
Write-Host "Adapter core was not modified and does not need to be restarted."
