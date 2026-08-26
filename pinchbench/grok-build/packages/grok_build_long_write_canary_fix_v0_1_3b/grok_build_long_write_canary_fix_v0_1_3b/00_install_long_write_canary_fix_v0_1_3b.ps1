param(
    [string]$Destination = "C:\pinchbench-grok-build\search-adapter"
)

$ErrorActionPreference = "Stop"
$Source = Split-Path -Parent $MyInvocation.MyCommand.Path
$Installed = Join-Path $Destination "05_run_long_write_wire_canary.ps1"
$ExpectedOldHash = "f50069a0aee0d22521319b4d716b0550e7e7dbd14c13a8b4c0d0be76f2fd83b3"
$ExpectedNewHash = "8785c0212e4bec6512c9d04b6d76c3280ab769eba76b3afaf74274868c0ff460"

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

Write-Host "PASS: long-write canary v0.1.3b installed." -ForegroundColor Green
Write-Host "Backup : $Backup"
Write-Host "SHA256 : $InstalledHash"
Write-Host "Adapter core was not modified and does not need to be restarted."
