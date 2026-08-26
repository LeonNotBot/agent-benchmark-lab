param(
    [Parameter(Mandatory=$true)][string]$RunDir,
    [string]$Python="C:\pinchbench-opencode\.venv\Scripts\python.exe",
    [string]$Root="C:\pinchbench-grok-build"
)
$ErrorActionPreference="Stop"
$Script=Join-Path $Root "search-adapter\prepare_reasoning_summary_failures_for_resume.py"
if(-not(Test-Path -LiteralPath $Python)){throw "Python not found: $Python"}
if(-not(Test-Path -LiteralPath $Script)){throw "Cleanup helper not found: $Script"}
& $Python -X utf8 $Script --run-dir $RunDir
if($LASTEXITCODE-ne0){throw "Reasoning-summary failure cleanup refused or failed."}
