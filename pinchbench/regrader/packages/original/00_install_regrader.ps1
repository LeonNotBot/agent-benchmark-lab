param(
    [string]$InstallDir = "C:\pinchbench-regrader",
    [string]$Python = ""
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

. (Join-Path $PSScriptRoot "common_regrade.ps1")

$ResolvedPython = Resolve-RegradePython -Python $Python
$Stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$Backup = $InstallDir + "-backup-" + $Stamp

if (Test-Path -LiteralPath $InstallDir) {
    Copy-Item `
        -LiteralPath $InstallDir `
        -Destination $Backup `
        -Recurse `
        -Force
}

New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null

$Files = @(
    "regrade_pinchbench.py",
    "reference_runner_contract.py",
    "regrade_config.json",
    "common_regrade.ps1",
    "01_preflight_regrade.ps1",
    "02_run_regrade_smoke.ps1",
    "03_monitor_regrade.ps1",
    "04_run_regrade_full.ps1",
    "05_resume_regrade.ps1",
    "06_stop_regrade.ps1",
    "07_finalize_regrade.ps1",
    "08_bundle_regrade_results.ps1",
    "source_manifest.yaml",
    "source_run_config.json",
    "source_results_schema.json",
    "README_CN.txt",
    "VERSION.txt",
    "VALIDATION_RESULTS.txt",
    "LOCAL_TEST_RESULTS.json"
)

foreach ($Name in $Files) {
    $Source = Join-Path $PSScriptRoot $Name
    if (-not (Test-Path -LiteralPath $Source)) {
        throw "Package file missing: $Source"
    }

    Copy-Item `
        -LiteralPath $Source `
        -Destination (Join-Path $InstallDir $Name) `
        -Force
}

$CompileOut = Join-Path $InstallDir "install.compile.stdout.txt"
$CompileErr = Join-Path $InstallDir "install.compile.stderr.txt"

$Process = Start-Process `
    -FilePath $ResolvedPython `
    -ArgumentList @(
        "-X", "utf8",
        "-m", "py_compile",
        (Join-Path $InstallDir "regrade_pinchbench.py"),
        (Join-Path $InstallDir "reference_runner_contract.py")
    ) `
    -WorkingDirectory $InstallDir `
    -RedirectStandardOutput $CompileOut `
    -RedirectStandardError $CompileErr `
    -NoNewWindow `
    -Wait `
    -PassThru

if ($Process.ExitCode -ne 0) {
    throw "Python compile failed. See $CompileErr"
}

Write-Host ""
Write-Host "PASS: PinchBench regrader installed." `
    -ForegroundColor Green
Write-Host ("Install dir: " + $InstallDir)
Write-Host ("Python: " + $ResolvedPython)

if (Test-Path -LiteralPath $Backup) {
    Write-Host ("Backup: " + $Backup)
}
