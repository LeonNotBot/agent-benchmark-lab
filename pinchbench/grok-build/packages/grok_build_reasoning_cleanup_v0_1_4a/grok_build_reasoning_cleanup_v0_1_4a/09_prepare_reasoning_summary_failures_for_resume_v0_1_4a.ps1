param(
    [Parameter(Mandatory=$true)][string]$RunDir,
    [string]$Python="C:\pinchbench-opencode\.venv\Scripts\python.exe",
    [string]$Root="C:\pinchbench-grok-build",
    [string]$AdapterLog="C:\pinchbench-grok-build\logs\search-adapter.jsonl"
)
$ErrorActionPreference="Stop"
[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false)
$global:OutputEncoding=New-Object System.Text.UTF8Encoding($false)

$Script=Join-Path $Root "search-adapter\prepare_reasoning_summary_failures_for_resume_v0_1_4a.py"
if(-not(Test-Path -LiteralPath $Python)){throw "Python not found: $Python"}
if(-not(Test-Path -LiteralPath $Script)){throw "Cleanup helper not found: $Script"}

& $Python -X utf8 $Script --run-dir $RunDir --root $Root --adapter-log $AdapterLog
if($LASTEXITCODE-ne0){
    throw "Reasoning-summary v0.1.4a cleanup refused or failed. No progress changes should be assumed unless the script printed PASS."
}
