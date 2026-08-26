param(
    [Parameter(Mandatory=$true)][string]$RunDir,
    [string]$Root = "C:\pinchbench-grok-build",
    [string]$Python = "C:\pinchbench-opencode\.venv\Scripts\python.exe"
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$global:OutputEncoding = New-Object System.Text.UTF8Encoding($false)

if (-not (Test-Path -LiteralPath $RunDir)) {
    throw "Run directory not found: $RunDir"
}
if (-not (Test-Path -LiteralPath $Python)) {
    throw "Python not found: $Python"
}

$Active = @(
    Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
        Where-Object {
            $_.CommandLine -and
            $_.CommandLine -match "run_pinchbench_grok_build_windows\.py" -and
            $_.CommandLine -like "*$RunDir*"
        }
)
if ($Active.Count -gt 0) {
    $Details = $Active | Select-Object ProcessId,Name,CommandLine | Format-List | Out-String
    throw "The full run is still active. Stop it before repairing progress.`n$Details"
}

$Helper = Join-Path $PSScriptRoot "prepare_invalid_prompt_failures_for_resume.py"
if (-not (Test-Path -LiteralPath $Helper)) {
    throw "Repair helper missing: $Helper"
}

& $Python -X utf8 $Helper --run-dir $RunDir
if ($LASTEXITCODE -ne 0) {
    throw "Progress repair failed."
}

Write-Host ""
Write-Host "PASS: original results were backed up and the three validated rows are ready for controlled rerun." -ForegroundColor Green
