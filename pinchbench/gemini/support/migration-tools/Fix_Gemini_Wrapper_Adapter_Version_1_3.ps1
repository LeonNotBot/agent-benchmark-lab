param(
    [string]$Root = "C:\pinchbench-gemini"
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

$RunnerDir = Join-Path $Root "runner"
$Targets = @(
    (Join-Path $RunnerDir "01_preflight_gemini.ps1"),
    (Join-Path $RunnerDir "03_run_gemini_smoke.ps1"),
    (Join-Path $RunnerDir "05_run_gemini_full.ps1")
)

$Stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$BackupDir = Join-Path $Root "backups\wrapper-version-hotfix-$Stamp"
New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null

$Changed = @()

foreach ($Path in $Targets) {
    if (-not (Test-Path -LiteralPath $Path)) {
        throw "Missing wrapper script: $Path"
    }

    $Text = Get-Content -LiteralPath $Path -Raw -Encoding UTF8
    $Original = $Text

    # The v1.2 wrappers may express the expected adapter version either as a
    # parameter default, a local variable, or a direct CLI argument.
    $Text = $Text -replace '1\.2\.0', '1.3.0'

    Copy-Item -LiteralPath $Path -Destination (Join-Path $BackupDir (Split-Path $Path -Leaf)) -Force

    if ($Text -ne $Original) {
        [System.IO.File]::WriteAllText(
            $Path,
            $Text,
            (New-Object System.Text.UTF8Encoding($true))
        )
        $Changed += $Path
    }
}

$Runner = Join-Path $RunnerDir "run_pinchbench_gemini_windows.py"
if (-not (Test-Path -LiteralPath $Runner)) {
    throw "Missing Python runner: $Runner"
}

$RunnerText = Get-Content -LiteralPath $Runner -Raw -Encoding UTF8
if ($RunnerText -notmatch 'DEFAULT_ADAPTER_VERSION\s*=\s*"1\.3\.0"') {
    throw "Python runner is not the v1.3 runner. Reinstall the v1.3 package before continuing."
}

$Remaining = @()
foreach ($Path in $Targets) {
    $Matches = Select-String -LiteralPath $Path -Pattern '1\.2\.0' -AllMatches -ErrorAction SilentlyContinue
    if ($Matches) {
        $Remaining += $Path
    }
}

if ($Remaining.Count -gt 0) {
    throw ("Old adapter version remains in: " + ($Remaining -join ", "))
}

Write-Host "PASS: Gemini wrapper scripts now expect adapter 1.3.0."
Write-Host ("Backup: " + $BackupDir)
Write-Host ("Changed files: " + $Changed.Count)
foreach ($Path in $Changed) {
    Write-Host ("  " + $Path)
}
