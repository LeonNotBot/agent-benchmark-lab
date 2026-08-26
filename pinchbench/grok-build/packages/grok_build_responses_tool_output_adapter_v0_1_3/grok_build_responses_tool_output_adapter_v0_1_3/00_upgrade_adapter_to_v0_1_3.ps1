param(
    [string]$Destination = "C:\pinchbench-grok-build\search-adapter",
    [string]$Python = "C:\pinchbench-opencode\.venv\Scripts\python.exe"
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$global:OutputEncoding = New-Object System.Text.UTF8Encoding($false)

$Source = Split-Path -Parent $MyInvocation.MyCommand.Path
$Current = Join-Path $Destination "grok_build_search_adapter.py"
$ExpectedOldHash = "db4be8cfbdb99749d659eb33120a6c1dbdbf11c597c273eb3f2f0d39d63fdd43"
$ExpectedNewHash = "85e31d546110bca5c72c0a51b03f555d7d093f64b7717754fd47cbe1d3a70906"

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
$Backup = "$Current.backup-responses-input-$Stamp"
Copy-Item -LiteralPath $Current -Destination $Backup -Force

Copy-Item -LiteralPath (Join-Path $Source "grok_build_search_adapter.py") -Destination $Current -Force
Copy-Item -LiteralPath (Join-Path $Source "03_run_web_search_adapter_canary.ps1") -Destination (Join-Path $Destination "03_run_web_search_adapter_canary.ps1") -Force
Copy-Item -LiteralPath (Join-Path $Source "test_request_wire_normalization.py") -Destination (Join-Path $Destination "test_request_wire_normalization.py") -Force
Copy-Item -LiteralPath (Join-Path $Source "05_run_long_write_wire_canary.ps1") -Destination (Join-Path $Destination "05_run_long_write_wire_canary.ps1") -Force
Copy-Item -LiteralPath (Join-Path $Source "prepare_invalid_prompt_failures_for_resume.py") -Destination (Join-Path $Destination "prepare_invalid_prompt_failures_for_resume.py") -Force
Copy-Item -LiteralPath (Join-Path $Source "06_prepare_invalid_prompt_failures_for_resume.ps1") -Destination (Join-Path $Destination "06_prepare_invalid_prompt_failures_for_resume.ps1") -Force

$ActualNewHash = (Get-FileHash -LiteralPath $Current -Algorithm SHA256).Hash.ToLowerInvariant()
if ($ActualNewHash -ne $ExpectedNewHash) {
    throw "Installed adapter SHA256 mismatch. Expected=$ExpectedNewHash Actual=$ActualNewHash"
}

& $Python -X utf8 -m py_compile $Current (Join-Path $Destination "prepare_invalid_prompt_failures_for_resume.py")
if ($LASTEXITCODE -ne 0) {
    throw "Python compile check failed."
}

& $Python -X utf8 (Join-Path $Destination "test_request_wire_normalization.py")
if ($LASTEXITCODE -ne 0) {
    throw "Request wire-normalization self-test failed."
}

Write-Host "PASS: Grok Build Responses tool-output adapter upgraded to v0.1.3." -ForegroundColor Green
Write-Host "Backup : $Backup"
Write-Host "SHA256 : $ActualNewHash"
Write-Host "IMPORTANT: restart the adapter process before running canaries."
Write-Host "Runner, task prompts, graders, run directories and existing progress were not modified."
