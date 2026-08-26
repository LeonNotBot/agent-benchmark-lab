param(
    [string]$Root = "C:\pinchbench-regrader",
    [string]$RunDir = "C:\pinchbench-regrades\regrade_20260728_165031",
    [string]$Python = "C:\pinchbench-opencode\.venv\Scripts\python.exe"
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

$Source = Join-Path $PSScriptRoot "regrade_pinchbench.py"
$Smoke = Join-Path $PSScriptRoot "runtime_smoke_v1_6.py"
$Target = Join-Path $Root "regrade_pinchbench.py"

foreach ($Required in @(
    $Root,
    $RunDir,
    $Python,
    $Source,
    $Smoke,
    $Target
)) {
    if (-not (Test-Path -LiteralPath $Required)) {
        throw "Required path not found: $Required"
    }
}

$Stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$BackupDir = Join-Path $Root (
    "backup-before-v1.6-image-gen-context-" + $Stamp
)
$Logs = Join-Path $Root "logs\v1_6-image-gen-context"

New-Item -ItemType Directory -Force -Path `
    $BackupDir, $Logs |
    Out-Null

Copy-Item `
    -LiteralPath $Target `
    -Destination (Join-Path $BackupDir "regrade_pinchbench.py") `
    -Force

Copy-Item `
    -LiteralPath $Source `
    -Destination $Target `
    -Force

$CompileOut = Join-Path $Logs "compile.stdout.txt"
$CompileErr = Join-Path $Logs "compile.stderr.txt"
$SmokeOut = Join-Path $Logs "runtime-smoke.stdout.txt"
$SmokeErr = Join-Path $Logs "runtime-smoke.stderr.txt"

Remove-Item `
    -LiteralPath `
        $CompileOut,
        $CompileErr,
        $SmokeOut,
        $SmokeErr `
    -Force `
    -ErrorAction SilentlyContinue

$Compile = Start-Process `
    -FilePath $Python `
    -ArgumentList @(
        "-X", "utf8",
        "-m", "py_compile",
        $Target
    ) `
    -WorkingDirectory $Root `
    -RedirectStandardOutput $CompileOut `
    -RedirectStandardError $CompileErr `
    -NoNewWindow `
    -Wait `
    -PassThru

if ($Compile.ExitCode -ne 0) {
    Copy-Item `
        -LiteralPath (Join-Path $BackupDir "regrade_pinchbench.py") `
        -Destination $Target `
        -Force
    throw "Compile failed. Previous runner restored."
}

$SmokeProcess = Start-Process `
    -FilePath $Python `
    -ArgumentList @(
        "-X", "utf8",
        $Smoke,
        "--runner", $Target
    ) `
    -WorkingDirectory $Root `
    -RedirectStandardOutput $SmokeOut `
    -RedirectStandardError $SmokeErr `
    -NoNewWindow `
    -Wait `
    -PassThru

if ($SmokeProcess.ExitCode -ne 0) {
    Copy-Item `
        -LiteralPath (Join-Path $BackupDir "regrade_pinchbench.py") `
        -Destination $Target `
        -Force

    if (Test-Path -LiteralPath $SmokeErr) {
        Get-Content `
            -LiteralPath $SmokeErr `
            -Encoding UTF8 `
            -Tail 200
    }
    throw "Runtime smoke failed. Previous runner restored."
}

Get-Content -LiteralPath $SmokeOut -Encoding UTF8

$Hash = Get-FileHash `
    -LiteralPath $Target `
    -Algorithm SHA256

Write-Host ""
Write-Host "PASS: Regrader v1.6 installed." `
    -ForegroundColor Green
Write-Host ("Target: " + $Target)
Write-Host ("Backup: " + $BackupDir)
Write-Host ("SHA256: " + $Hash.Hash)
