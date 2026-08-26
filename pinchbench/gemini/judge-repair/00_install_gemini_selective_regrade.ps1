param(
    [string]$InstallDir = "C:\pinchbench-gemini\judge-repair"
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

$Source = Split-Path -Parent $MyInvocation.MyCommand.Path
$Required = @(
    "regrade_pinchbench.py",
    "reference_runner_contract.py",
    "merge_gemini_selective_regrade.py",
    "regrade_config_gemini.json",
    "TASKS.txt",
    "README.txt",
    "01_run_gemini_selective_regrade.ps1",
    "02_monitor_gemini_selective_regrade.ps1",
    "03_resume_gemini_selective_regrade.ps1"
)
foreach ($Name in $Required) {
    if (-not (Test-Path -LiteralPath (Join-Path $Source $Name))) {
        throw "Package file missing: $Name"
    }
}

if (Test-Path -LiteralPath $InstallDir) {
    $Backup = $InstallDir + ".backup-" + (Get-Date -Format "yyyyMMdd-HHmmss")
    Move-Item -LiteralPath $InstallDir -Destination $Backup
    Write-Host ("Existing install backed up to: " + $Backup)
}

New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
Copy-Item -Path (Join-Path $Source "*") -Destination $InstallDir -Recurse -Force

Write-Host "PASS: Gemini selective regrade package installed."
Write-Host ("Install: " + $InstallDir)
Write-Host "Original Agent results will remain read-only."
