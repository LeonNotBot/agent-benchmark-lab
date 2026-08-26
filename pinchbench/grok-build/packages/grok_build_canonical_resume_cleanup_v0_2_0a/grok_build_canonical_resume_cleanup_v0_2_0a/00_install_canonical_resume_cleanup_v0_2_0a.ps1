param(
    [string]$Root = "C:\pinchbench-grok-build",
    [string]$Python = "",
    [string]$SkillDir = "",
    [string]$AdapterUrl = "http://127.0.0.1:8767"
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$global:OutputEncoding = New-Object System.Text.UTF8Encoding($false)

$Source = Split-Path -Parent $MyInvocation.MyCommand.Path
$Destination = Join-Path $Root "search-adapter"
$Common = Join-Path $Root "runner\common_grok_build_runner.ps1"
$Runner = Join-Path $Root "runner\run_pinchbench_grok_build_windows.py"

foreach($Path in @($Destination,$Common,$Runner)){
    if(-not(Test-Path -LiteralPath $Path)){throw "Required path missing: $Path"}
}

$Health = Invoke-RestMethod -Uri ($AdapterUrl.TrimEnd("/") + "/healthz") -TimeoutSec 5
if(
    -not $Health.ok -or
    [string]$Health.version -ne "0.2.0" -or
    [string]$Health.compiler -ne "canonical-history-v1" -or
    [string]$Health.target_model -ne "deepseek/deepseek-v4-pro"
){
    throw "Expected healthy canonical Adapter v0.2.0. Actual: $($Health | ConvertTo-Json -Compress)"
}

$CommonText = [System.IO.File]::ReadAllText($Common,[System.Text.Encoding]::UTF8)
$RunnerText = [System.IO.File]::ReadAllText($Runner,[System.Text.Encoding]::UTF8)
if($CommonText -notmatch '\[string\]\$h\.version\s+-ne\s+"0\.2\.0"'){
    throw "PowerShell Runner does not currently require Adapter v0.2.0."
}
if($RunnerText -notmatch 'DEFAULT_ADAPTER_VERSION\s*=\s*"0\.2\.0"'){
    throw "Python Runner does not currently require Adapter v0.2.0."
}
if($RunnerText -notmatch 'DEFAULT_MODEL_ID\s*=\s*"deepseek/deepseek-v4-pro"'){
    throw "Python Runner model gate is unexpected."
}

foreach($Name in @(
    "prepare_canonical_resume_v0_2_0a.py",
    "09_prepare_canonical_resume_v0_2_0a.ps1"
)){
    Copy-Item -LiteralPath (Join-Path $Source $Name) -Destination (Join-Path $Destination $Name) -Force
}

. $Common
$Paths = Resolve-GrokRunnerPaths -Root $Root -Python $Python -SkillDir $SkillDir
& $Paths.Python -X utf8 -m py_compile (Join-Path $Destination "prepare_canonical_resume_v0_2_0a.py")
if($LASTEXITCODE -ne 0){throw "Cleanup helper compile validation failed."}

Write-Host "PASS: canonical resume cleanup v0.2.0a installed." -ForegroundColor Green
Write-Host "This installer did not modify benchmark progress, workspaces, transcripts, or results."
Write-Host "Next run 09_prepare_canonical_resume_v0_2_0a.ps1 against the original run."
