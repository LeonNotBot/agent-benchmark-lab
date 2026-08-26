param(
    [string]$Root = "C:\pinchbench-grok-build",
    [string]$Python = "C:\pinchbench-opencode\.venv\Scripts\python.exe"
)
$ErrorActionPreference="Stop"
[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false)
$global:OutputEncoding=New-Object System.Text.UTF8Encoding($false)
$Adapter=Join-Path $Root "search-adapter\grok_build_search_adapter.py"
$Probe=Join-Path $Root "search-adapter\direct_reasoning_summary_canary.py"
if(-not(Test-Path -LiteralPath $Python)){throw "Python not found: $Python"}
if(-not(Test-Path -LiteralPath $Adapter)){throw "Adapter not found: $Adapter"}
if(-not(Test-Path -LiteralPath $Probe)){throw "Canary not found: $Probe"}
& $Python -X utf8 $Probe --adapter $Adapter --python $Python
if($LASTEXITCODE-ne0){throw "Reasoning-summary direct protocol canary failed."}
Write-Host "PASS: deterministic reasoning-summary protocol gate completed." -ForegroundColor Green
