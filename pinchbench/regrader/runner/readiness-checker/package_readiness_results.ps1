param(
    [string]$OutputRoot = "C:\pinchbench-regrade-readiness"
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

if (-not (Test-Path -LiteralPath $OutputRoot)) {
    throw "Output root not found: $OutputRoot"
}

$Latest = Get-ChildItem `
    -LiteralPath $OutputRoot `
    -Directory `
    -Filter "readiness_*" `
    -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1

if ($null -eq $Latest) {
    throw "No readiness result directory was found."
}

$Stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$Desktop = [Environment]::GetFolderPath("Desktop")
$Zip = Join-Path $Desktop `
    ("pinchbench-regrade-readiness-" + $Stamp + ".zip")

Remove-Item -LiteralPath $Zip -Force -ErrorAction SilentlyContinue

Compress-Archive `
    -LiteralPath $Latest.FullName `
    -DestinationPath $Zip `
    -CompressionLevel Optimal `
    -Force

$Hash = Get-FileHash -LiteralPath $Zip -Algorithm SHA256

Write-Host ""
Write-Host "READINESS ZIP READY" -ForegroundColor Green
Write-Host ("Source: " + $Latest.FullName)
Write-Host ("ZIP: " + $Zip)
Write-Host ("SHA256: " + $Hash.Hash)
