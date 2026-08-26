param(
    [string]$Root = "C:\pinchbench-gemini"
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

$Source = $PSScriptRoot
$AdapterSource = Join-Path $Source "gemini_openrouter_adapter.py"
$RunnerSource = Join-Path $Source "run_pinchbench_gemini_windows.py"
$StartSource = Join-Path $Source "02_start_gemini_adapter_v1_3.ps1"
$CanarySource = Join-Path $Source "03_run_gemini_network_fix_canary.ps1"
$RollbackSource = Join-Path $Source "04_rollback_gemini_adapter_v1_3_fix.ps1"

$AdapterTarget = Join-Path $Root "adapter-v1\gemini_openrouter_adapter.py"
$RunnerTarget = Join-Path $Root "runner\run_pinchbench_gemini_windows.py"
$StartTarget = Join-Path $Root "runner\02_start_gemini_adapter_v1_3.ps1"
$CanaryTarget = Join-Path $Root "runner\03_run_gemini_network_fix_canary.ps1"
$RollbackTarget = Join-Path $Root "runner\04_rollback_gemini_adapter_v1_3_fix.ps1"
$Common = Join-Path $Root "runner\common_gemini_runner.ps1"

foreach ($Path in @($AdapterSource, $RunnerSource, $StartSource, $CanarySource, $RollbackSource, $AdapterTarget, $RunnerTarget, $Common)) {
    if (-not (Test-Path -LiteralPath $Path)) {
        throw "Required path not found: $Path"
    }
}

. $Common
$Python = Resolve-PythonPath -Root $Root -Python ""
$Stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$Backup = Join-Path $Root "backups\adapter-v1_3-fix-$Stamp"
New-Item -ItemType Directory -Path $Backup -Force | Out-Null

Copy-Item -LiteralPath $AdapterTarget -Destination (Join-Path $Backup "gemini_openrouter_adapter.py") -Force
Copy-Item -LiteralPath $RunnerTarget -Destination (Join-Path $Backup "run_pinchbench_gemini_windows.py") -Force
if (Test-Path -LiteralPath $StartTarget) {
    Copy-Item -LiteralPath $StartTarget -Destination (Join-Path $Backup "02_start_gemini_adapter_v1_3.ps1") -Force
}

Copy-Item -LiteralPath $AdapterSource -Destination $AdapterTarget -Force
Copy-Item -LiteralPath $RunnerSource -Destination $RunnerTarget -Force
Copy-Item -LiteralPath $StartSource -Destination $StartTarget -Force
Copy-Item -LiteralPath $CanarySource -Destination $CanaryTarget -Force
Copy-Item -LiteralPath $RollbackSource -Destination $RollbackTarget -Force

& $Python -X utf8 -m py_compile $AdapterTarget $RunnerTarget
if ($LASTEXITCODE -ne 0) {
    throw "Python compile validation failed. Backup: $Backup"
}

$Version = & $Python -X utf8 $AdapterTarget --version
if ([string]$Version -ne "1.3.0") {
    throw "Adapter version validation failed: $Version"
}

Write-Host "PASS: Gemini adapter v1.3 fix installed."
Write-Host ("Backup: " + $Backup)
Write-Host ("Adapter: " + $AdapterTarget)
Write-Host ("Runner : " + $RunnerTarget)
Write-Host ("Start  : " + $StartTarget)
Write-Host ("Canary : " + $CanaryTarget)
Write-Host ("Rollback: " + $RollbackTarget)
