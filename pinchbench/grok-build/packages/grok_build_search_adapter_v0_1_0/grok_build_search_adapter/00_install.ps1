param(
    [string]$Destination = "C:\pinchbench-grok-build\search-adapter"
)

$ErrorActionPreference = "Stop"
$Source = Split-Path -Parent $MyInvocation.MyCommand.Path

New-Item -ItemType Directory -Force -Path $Destination | Out-Null

Get-ChildItem -LiteralPath $Source -File |
    Where-Object { $_.Name -ne "00_install.ps1" } |
    Copy-Item -Destination $Destination -Force

Write-Host "PASS: Grok Build search adapter installed."
Write-Host "Destination: $Destination"
Write-Host "PinchBench Runner files were not modified."
