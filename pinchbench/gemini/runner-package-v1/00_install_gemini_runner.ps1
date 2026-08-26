param(
    [string]$Root = "C:\pinchbench-gemini",
    [string]$Python = ""
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

. (Join-Path $PSScriptRoot "common_gemini_runner.ps1")

$ResolvedPython = Resolve-PythonPath `
    -Root $Root `
    -Python $Python

$RunnerDir = Join-Path $Root "runner"
$Stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$BackupDir = Join-Path $RunnerDir (
    "backup-before-gemini-runner-v1-" + $Stamp
)
$Logs = Join-Path $Root "logs\gemini-runner-install"

New-Item -ItemType Directory -Force -Path `
    $RunnerDir, $BackupDir, $Logs |
    Out-Null

$Files = @(
    "run_pinchbench_gemini_windows.py",
    "common_gemini_runner.ps1",
    "01_preflight_gemini.ps1",
    "02_start_gemini_adapter_v1_2.ps1",
    "03_run_gemini_smoke.ps1",
    "04_monitor_pinchbench_gemini_windows.ps1",
    "05_run_gemini_full.ps1",
    "06_bundle_gemini_run_diagnostic.ps1",
    "README_CN.txt",
    "VERSION.txt",
    "VALIDATION_GEMINI_RUNNER_V1.txt"
)

foreach ($Name in $Files) {
    $Source = Join-Path $PSScriptRoot $Name
    if (-not (Test-Path -LiteralPath $Source)) {
        throw "Package file missing: $Source"
    }

    $Target = Join-Path $RunnerDir $Name
    if (Test-Path -LiteralPath $Target) {
        Copy-Item `
            -LiteralPath $Target `
            -Destination (Join-Path $BackupDir $Name) `
            -Force
    }

    Copy-Item `
        -LiteralPath $Source `
        -Destination $Target `
        -Force
}

$CompileOut = Join-Path $Logs "compile.stdout.txt"
$CompileErr = Join-Path $Logs "compile.stderr.txt"

Remove-Item `
    -LiteralPath $CompileOut, $CompileErr `
    -Force `
    -ErrorAction SilentlyContinue

$Compile = Start-Process `
    -FilePath $ResolvedPython `
    -ArgumentList @(
        "-X", "utf8",
        "-m", "py_compile",
        (Join-Path $RunnerDir "run_pinchbench_gemini_windows.py")
    ) `
    -WorkingDirectory $RunnerDir `
    -RedirectStandardOutput $CompileOut `
    -RedirectStandardError $CompileErr `
    -NoNewWindow `
    -Wait `
    -PassThru

if ($Compile.ExitCode -ne 0) {
    throw "Runner compile failed. See $CompileErr"
}

$Hash = Get-FileHash `
    -LiteralPath (
        Join-Path $RunnerDir "run_pinchbench_gemini_windows.py"
    ) `
    -Algorithm SHA256

Write-Host ""
Write-Host "PASS: Gemini PinchBench runner v1 installed." `
    -ForegroundColor Green
Write-Host ("Runner dir: " + $RunnerDir)
Write-Host ("Backup dir: " + $BackupDir)
Write-Host ("Python: " + $ResolvedPython)
Write-Host ("Runner SHA256: " + $Hash.Hash)
