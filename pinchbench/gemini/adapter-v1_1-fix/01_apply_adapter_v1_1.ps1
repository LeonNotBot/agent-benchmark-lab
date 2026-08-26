param(
    [string]$Root = "C:\pinchbench-gemini",
    [string]$Python = "C:\pinchbench-opencode\.venv\Scripts\python.exe"
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

$AdapterDir = Join-Path $Root "adapter-v1"
$Target = Join-Path $AdapterDir "gemini_openrouter_adapter.py"
$TargetTest = Join-Path $AdapterDir "test_adapter.py"
$Source = Join-Path $PSScriptRoot "gemini_openrouter_adapter.py"
$SourceTest = Join-Path $PSScriptRoot "test_adapter.py"
$VersionSource = Join-Path $PSScriptRoot "VERSION.txt"
$VersionTarget = Join-Path $AdapterDir "VERSION.txt"
$Logs = Join-Path $Root "logs\adapter-v1"
$Stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$BackupDir = Join-Path $AdapterDir ("backup-before-v1.1-" + $Stamp)

foreach ($Path in @(
    $Python,
    $AdapterDir,
    $Target,
    $Source,
    $SourceTest
)) {
    if (-not (Test-Path -LiteralPath $Path)) {
        throw "Required path not found: $Path"
    }
}

try {
    $Health = Invoke-RestMethod `
        -Method Get `
        -Uri "http://127.0.0.1:8766/healthz" `
        -TimeoutSec 2

    if ($Health.ok -eq $true) {
        throw @"
The adapter is still running on port 8766.
Stop window A with Ctrl+C, then run this patch again.
"@
    }
}
catch {
    if ($_.Exception.Message -like "*still running*") {
        throw
    }
}

New-Item -ItemType Directory -Force -Path $BackupDir, $Logs | Out-Null

Copy-Item -LiteralPath $Target `
    -Destination (Join-Path $BackupDir "gemini_openrouter_adapter.py") `
    -Force

if (Test-Path -LiteralPath $TargetTest) {
    Copy-Item -LiteralPath $TargetTest `
        -Destination (Join-Path $BackupDir "test_adapter.py") `
        -Force
}

if (Test-Path -LiteralPath $VersionTarget) {
    Copy-Item -LiteralPath $VersionTarget `
        -Destination (Join-Path $BackupDir "VERSION.txt") `
        -Force
}

Copy-Item -LiteralPath $Source -Destination $Target -Force
Copy-Item -LiteralPath $SourceTest -Destination $TargetTest -Force
Copy-Item -LiteralPath $VersionSource -Destination $VersionTarget -Force

$CompileOut = Join-Path $Logs "v1_1_compile.stdout.txt"
$CompileErr = Join-Path $Logs "v1_1_compile.stderr.txt"
$TestOut = Join-Path $Logs "v1_1_tests.stdout.txt"
$TestErr = Join-Path $Logs "v1_1_tests.stderr.txt"

Remove-Item `
    -LiteralPath $CompileOut, $CompileErr, $TestOut, $TestErr `
    -Force `
    -ErrorAction SilentlyContinue

$Compile = Start-Process `
    -FilePath $Python `
    -ArgumentList @(
        "-X", "utf8",
        "-m", "py_compile",
        $Target
    ) `
    -WorkingDirectory $AdapterDir `
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
        $TargetTest
    ) `
    -WorkingDirectory $AdapterDir `
    -RedirectStandardOutput $TestOut `
    -RedirectStandardError $TestErr `
    -NoNewWindow `
    -Wait `
    -PassThru

if ($Tests.ExitCode -ne 0) {
    throw "Adapter tests failed. See $TestErr"
}

$Hash = Get-FileHash -LiteralPath $Target -Algorithm SHA256

Write-Host ""
Write-Host "PASS: Adapter v1.1 patch installed." -ForegroundColor Green
Write-Host ("Target: " + $Target)
Write-Host ("Backup: " + $BackupDir)
Write-Host ("SHA256: " + $Hash.Hash)
Write-Host "Next: restart window A, then run the text canary only."
