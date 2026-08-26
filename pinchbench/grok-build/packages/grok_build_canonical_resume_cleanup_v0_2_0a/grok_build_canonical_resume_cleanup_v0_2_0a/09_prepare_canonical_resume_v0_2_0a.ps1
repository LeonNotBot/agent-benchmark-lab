param(
    [Parameter(Mandatory=$true)]
    [string]$RunDir,
    [string]$Root = "C:\pinchbench-grok-build",
    [string]$Python = "",
    [string]$SkillDir = "",
    [string]$AdapterUrl = "http://127.0.0.1:8767"
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$global:OutputEncoding = New-Object System.Text.UTF8Encoding($false)

$Common = Join-Path $Root "runner\common_grok_build_runner.ps1"
$Helper = Join-Path $Root "search-adapter\prepare_canonical_resume_v0_2_0a.py"
if(-not(Test-Path -LiteralPath $Common)){throw "Runner common script missing: $Common"}
if(-not(Test-Path -LiteralPath $Helper)){throw "Cleanup helper missing: $Helper"}

$Health = Invoke-RestMethod -Uri ($AdapterUrl.TrimEnd("/") + "/healthz") -TimeoutSec 5
if(
    -not $Health.ok -or
    [string]$Health.version -ne "0.2.0" -or
    [string]$Health.compiler -ne "canonical-history-v1" -or
    [string]$Health.target_model -ne "deepseek/deepseek-v4-pro"
){
    throw "Expected healthy canonical Adapter v0.2.0. Actual: $($Health | ConvertTo-Json -Compress)"
}

$Busy = @(
    Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object {
        [string]$_.CommandLine -like "*run_pinchbench_grok_build_windows.py*" -and
        [string]$_.CommandLine -like "*$RunDir*"
    }
)
if($Busy.Count -gt 0){
    $Details = $Busy | Select-Object ProcessId,Name,CommandLine | Format-List | Out-String
    throw "The original full Runner is still active. Stop it before cleanup.`n$Details"
}

. $Common
$Paths = Resolve-GrokRunnerPaths -Root $Root -Python $Python -SkillDir $SkillDir
if($null -eq $Paths -or [string]::IsNullOrWhiteSpace([string]$Paths.Python)){
    throw "Unable to resolve the benchmark Python executable."
}

& $Paths.Python -X utf8 $Helper --root $Root --run-dir $RunDir
if($LASTEXITCODE -ne 0){
    throw "Canonical resume cleanup refused or failed. Do not resume unless the helper printed PASS."
}
