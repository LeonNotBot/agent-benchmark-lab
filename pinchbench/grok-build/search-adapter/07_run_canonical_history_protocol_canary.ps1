param(
    [string]$Root = "C:\pinchbench-grok-build",
    [string]$Python = "C:\pinchbench-opencode\.venv\Scripts\python.exe"
)
$ErrorActionPreference="Stop"
[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false)
$global:OutputEncoding=New-Object System.Text.UTF8Encoding($false)

$Adapter=Join-Path $Root "search-adapter\grok_build_search_adapter.py"
$Canary=Join-Path $Root "search-adapter\direct_canonical_history_canary.py"
if(-not(Test-Path -LiteralPath $Python)){throw "Python not found: $Python"}
if(-not(Test-Path -LiteralPath $Adapter)){throw "Adapter not found: $Adapter"}
if(-not(Test-Path -LiteralPath $Canary)){throw "Canary not found: $Canary"}

$Health=Invoke-RestMethod -Uri "http://127.0.0.1:8767/healthz" -TimeoutSec 5
if(-not$Health.ok -or [string]$Health.version -ne "0.2.0" -or [string]$Health.compiler -ne "canonical-history-v1" -or [string]$Health.target_model -ne "deepseek/deepseek-v4-pro"){
    throw "Expected live canonical Adapter v0.2.0. Actual: $($Health|ConvertTo-Json -Compress)"
}

& $Python -X utf8 $Canary --adapter $Adapter --python $Python
if($LASTEXITCODE-ne0){throw "Canonical-history deterministic protocol canary failed."}
Write-Host "PASS: live Adapter v0.2.0 and deterministic protocol gate are ready." -ForegroundColor Green
