param(
    [ValidateSet("quick", "full-hash")]
    [string]$Mode = "quick",

    [string]$Python = "C:\pinchbench-opencode\.venv\Scripts\python.exe",

    [string]$OutputRoot = "C:\pinchbench-regrade-readiness"
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

$Checker = Join-Path $PSScriptRoot "verify_regrade_inputs.py"
$Config = Join-Path $PSScriptRoot "regrade_runs.json"

foreach ($Required in @($Python, $Checker, $Config)) {
    if (-not (Test-Path -LiteralPath $Required)) {
        throw "Required path not found: $Required"
    }
}

New-Item -ItemType Directory -Force -Path $OutputRoot | Out-Null

$Stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$Stdout = Join-Path $OutputRoot ("checker-" + $Stamp + ".stdout.txt")
$Stderr = Join-Path $OutputRoot ("checker-" + $Stamp + ".stderr.txt")

$Arguments = @(
    "-X", "utf8",
    $Checker,
    "--config", $Config,
    "--output-root", $OutputRoot,
    "--mode", $Mode
)

$Process = Start-Process `
    -FilePath $Python `
    -ArgumentList $Arguments `
    -WorkingDirectory $PSScriptRoot `
    -RedirectStandardOutput $Stdout `
    -RedirectStandardError $Stderr `
    -NoNewWindow `
    -Wait `
    -PassThru

Write-Host ""
if (Test-Path -LiteralPath $Stdout) {
    Get-Content -LiteralPath $Stdout -Encoding UTF8
}

if (
    (Test-Path -LiteralPath $Stderr) -and
    (Get-Item -LiteralPath $Stderr).Length -gt 0
) {
    Write-Host ""
    Write-Host "Checker stderr:" -ForegroundColor Yellow
    Get-Content -LiteralPath $Stderr -Encoding UTF8
}

Write-Host ""
Write-Host ("Checker exit code: " + $Process.ExitCode)
Write-Host ("Stdout log: " + $Stdout)
Write-Host ("Stderr log: " + $Stderr)

switch ($Process.ExitCode) {
    0 {
        Write-Host "PASS: all configured runs are READY." `
            -ForegroundColor Green
    }
    2 {
        Write-Warning (
            "Check completed with warnings. " +
            "Open readiness_report.html before re-grading."
        )
    }
    3 {
        Write-Warning (
            "One or more runs are incomplete or not found. " +
            "Open candidate_runs.csv and readiness_report.html."
        )
    }
    default {
        throw "Checker failed with exit code $($Process.ExitCode)."
    }
}
