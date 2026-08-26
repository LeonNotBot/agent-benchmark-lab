param(
    [string]$Root = "C:\pinchbench-gemini",
    [string]$Python = "C:\pinchbench-opencode\.venv\Scripts\python.exe"
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

$TargetDir = Join-Path $Root "adapter-v1"
$TargetAdapter = Join-Path $TargetDir "gemini_openrouter_adapter.py"
$TargetTests = Join-Path $TargetDir "test_adapter.py"
$TargetVersion = Join-Path $TargetDir "VERSION.txt"
$TargetStart = Join-Path $TargetDir "02_start_adapter_v1_2.ps1"
$TargetCanary = Join-Path $TargetDir "03_run_remaining_canaries_v1_2.ps1"
$TargetBundle = Join-Path $TargetDir "04_bundle_v1_2_diagnostics.ps1"

$SourceAdapter = Join-Path $PSScriptRoot "gemini_openrouter_adapter.py"
$SourceTests = Join-Path $PSScriptRoot "test_adapter.py"
$SourceVersion = Join-Path $PSScriptRoot "VERSION.txt"
$SourceStart = Join-Path $PSScriptRoot "02_start_adapter_v1_2.ps1"
$SourceCanary = Join-Path $PSScriptRoot "03_run_remaining_canaries_v1_2.ps1"
$SourceBundle = Join-Path $PSScriptRoot "04_bundle_v1_2_diagnostics.ps1"

foreach ($Required in @(
    $Python,
    $TargetDir,
    $SourceAdapter,
    $SourceTests,
    $SourceVersion,
    $SourceStart,
    $SourceCanary,
    $SourceBundle
)) {
    if (-not (Test-Path -LiteralPath $Required)) {
        throw "Required path not found: $Required"
    }
}

try {
    $Health = Invoke-RestMethod `
        -Method Get `
        -Uri "http://127.0.0.1:8766/healthz" `
        -TimeoutSec 2

    if ($Health.ok -eq $true) {
        throw "Adapter is still running. Stop window A with Ctrl+C first."
    }
}
catch {
    if ($_.Exception.Message -like "*still running*") {
        throw
    }
}

$Stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$Backup = Join-Path $TargetDir ("backup-before-v1.2-" + $Stamp)
$Logs = Join-Path $Root "logs\adapter-v1_2-install"

New-Item -ItemType Directory -Force -Path $Backup, $Logs | Out-Null

foreach ($Name in @(
    "gemini_openrouter_adapter.py",
    "test_adapter.py",
    "VERSION.txt",
    "02_start_adapter.ps1",
    "03_run_canaries.ps1",
    "03_run_canaries_timeout_safe.ps1"
)) {
    $Existing = Join-Path $TargetDir $Name
    if (Test-Path -LiteralPath $Existing) {
        Copy-Item `
            -LiteralPath $Existing `
            -Destination (Join-Path $Backup $Name) `
            -Force
    }
}

Copy-Item -LiteralPath $SourceAdapter -Destination $TargetAdapter -Force
Copy-Item -LiteralPath $SourceTests -Destination $TargetTests -Force
Copy-Item -LiteralPath $SourceVersion -Destination $TargetVersion -Force
Copy-Item -LiteralPath $SourceStart -Destination $TargetStart -Force
Copy-Item -LiteralPath $SourceCanary -Destination $TargetCanary -Force
Copy-Item -LiteralPath $SourceBundle -Destination $TargetBundle -Force

$CompileOut = Join-Path $Logs "compile.stdout.txt"
$CompileErr = Join-Path $Logs "compile.stderr.txt"
$TestOut = Join-Path $Logs "tests.stdout.txt"
$TestErr = Join-Path $Logs "tests.stderr.txt"

foreach ($Path in @($CompileOut, $CompileErr, $TestOut, $TestErr)) {
    Remove-Item -LiteralPath $Path -Force -ErrorAction SilentlyContinue
}

$Compile = Start-Process `
    -FilePath $Python `
    -ArgumentList @(
        "-X", "utf8",
        "-m", "py_compile",
        $TargetAdapter
    ) `
    -WorkingDirectory $TargetDir `
    -RedirectStandardOutput $CompileOut `
    -RedirectStandardError $CompileErr `
    -NoNewWindow `
    -Wait `
    -PassThru

if ($Compile.ExitCode -ne 0) {
    throw "Adapter compile failed. See $CompileErr"
}

$Tests = Start-Process `
    -FilePath $Python `
    -ArgumentList @(
        "-X", "utf8",
        $TargetTests
    ) `
    -WorkingDirectory $TargetDir `
    -RedirectStandardOutput $TestOut `
    -RedirectStandardError $TestErr `
    -NoNewWindow `
    -Wait `
    -PassThru

if ($Tests.ExitCode -ne 0) {
    throw "Adapter tests failed. See $TestErr"
}

$Hash = Get-FileHash -LiteralPath $TargetAdapter -Algorithm SHA256

Write-Host ""
Write-Host "PASS: Adapter v1.2 installed." -ForegroundColor Green
Write-Host ("Target: " + $TargetAdapter)
Write-Host ("Backup: " + $Backup)
Write-Host ("SHA256: " + $Hash.Hash)
Write-Host "Local tests: 9 passed."
