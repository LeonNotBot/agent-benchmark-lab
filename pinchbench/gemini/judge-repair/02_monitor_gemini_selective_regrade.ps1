param(
    [string]$Python = "",
    [string]$RunDir = ""
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Config = Join-Path $Root "regrade_config_gemini.json"
$Regrader = Join-Path $Root "regrade_pinchbench.py"
$OutputRoot = "C:\pinchbench-gemini\selective-regrades"

$Candidates = @()
if (-not [string]::IsNullOrWhiteSpace($Python)) { $Candidates += $Python }
$Candidates += @("C:\pinchbench-opencode\.venv\Scripts\python.exe", "C:\pinchbench-codex\.venv\Scripts\python.exe")
$ResolvedPython = $Candidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if ([string]::IsNullOrWhiteSpace($ResolvedPython)) { throw "Supported Python not found." }

if ([string]::IsNullOrWhiteSpace($RunDir)) {
    $Latest = Get-ChildItem -LiteralPath $OutputRoot -Directory -Filter "smoke_*" -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($null -eq $Latest) { throw "No selective regrade run found." }
    $RunDir = $Latest.FullName
}

& $ResolvedPython -X utf8 $Regrader --config $Config status --run-dir $RunDir --watch 5
exit $LASTEXITCODE
