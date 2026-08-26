param(
    [string]$Root = "C:\pinchbench-gemini",
    [string]$BackupDir = ""
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($BackupDir)) {
    $BackupDir = (Get-ChildItem -LiteralPath (Join-Path $Root "backups") -Directory -Filter "adapter-v1_3-fix-*" -ErrorAction Stop | Sort-Object LastWriteTime -Descending | Select-Object -First 1).FullName
}
if (-not (Test-Path -LiteralPath $BackupDir)) { throw "Backup not found: $BackupDir" }

Copy-Item -LiteralPath (Join-Path $BackupDir "gemini_openrouter_adapter.py") -Destination (Join-Path $Root "adapter-v1\gemini_openrouter_adapter.py") -Force
Copy-Item -LiteralPath (Join-Path $BackupDir "run_pinchbench_gemini_windows.py") -Destination (Join-Path $Root "runner\run_pinchbench_gemini_windows.py") -Force
Write-Host ("PASS: Rolled back from " + $BackupDir)
