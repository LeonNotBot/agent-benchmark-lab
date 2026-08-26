param(
    [Parameter(Mandatory = $true)][string]$RunDir,
    [string]$Python = "",
    [string]$ProxyUrl = "http://127.0.0.1:10090"
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Config = Join-Path $Root "regrade_config_gemini.json"
$Regrader = Join-Path $Root "regrade_pinchbench.py"
$Merger = Join-Path $Root "merge_gemini_selective_regrade.py"
$OriginalRun = "C:\pinchbench-gemini\runs\gemini_20260731_173523"
$CorrectedRoot = "C:\pinchbench-gemini\regraded-results"

if ([string]::IsNullOrWhiteSpace([string]$env:OPENROUTER_API_KEY)) { throw "OPENROUTER_API_KEY is missing." }
$env:HTTP_PROXY=$ProxyUrl; $env:HTTPS_PROXY=$ProxyUrl; $env:ALL_PROXY=$ProxyUrl
$env:NO_PROXY="localhost,127.0.0.1,::1"; $env:no_proxy=$env:NO_PROXY

$Candidates=@(); if(-not [string]::IsNullOrWhiteSpace($Python)){$Candidates+=$Python}; $Candidates+=@("C:\pinchbench-opencode\.venv\Scripts\python.exe","C:\pinchbench-codex\.venv\Scripts\python.exe")
$ResolvedPython=$Candidates|Where-Object{Test-Path -LiteralPath $_}|Select-Object -First 1
if([string]::IsNullOrWhiteSpace($ResolvedPython)){throw "Supported Python not found."}

& $ResolvedPython -X utf8 $Regrader --config $Config resume --run-dir $RunDir --retry-failed --verbose
if($LASTEXITCODE -ne 0){throw "Some regrade jobs are still failed. Do not merge yet."}
& $ResolvedPython -X utf8 $Regrader --config $Config finalize --run-dir $RunDir
if($LASTEXITCODE -ne 0){throw "Regrade finalize failed."}
New-Item -ItemType Directory -Path $CorrectedRoot -Force | Out-Null
& $ResolvedPython -X utf8 $Merger --original-run $OriginalRun --regrade-run $RunDir --output-root $CorrectedRoot
if($LASTEXITCODE -ne 0){throw "Strict merge validation failed."}
Write-Host "PASS: resumed regrade and corrected result generation completed." -ForegroundColor Green
