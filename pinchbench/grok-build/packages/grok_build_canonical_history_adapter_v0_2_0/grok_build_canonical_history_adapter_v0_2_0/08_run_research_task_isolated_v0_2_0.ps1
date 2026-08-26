param(
    [Parameter(Mandatory=$true)]
    [ValidateSet("task_deep_research","task_oss_alternative_research")]
    [string]$TaskId,
    [string]$Root = "C:\pinchbench-grok-build",
    [string]$Python = "",
    [string]$SkillDir = "",
    [string]$ProxyUrl = "http://127.0.0.1:10090",
    [string]$AdapterUrl = "http://127.0.0.1:8767"
)

$ErrorActionPreference="Stop"
[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false)
$global:OutputEncoding=New-Object System.Text.UTF8Encoding($false)

. (Join-Path $Root "runner\common_grok_build_runner.ps1")
Set-GrokBenchmarkEnvironment -Root $Root -ProxyUrl $ProxyUrl
Assert-OpenRouterKey
$Health=Invoke-RestMethod -Uri ($AdapterUrl.TrimEnd("/")+"/healthz") -TimeoutSec 5
if(-not$Health.ok -or [string]$Health.version -ne "0.2.0" -or [string]$Health.compiler -ne "canonical-history-v1" -or [string]$Health.target_model -ne "deepseek/deepseek-v4-pro"){
    throw "Expected live canonical Adapter v0.2.0. Actual: $($Health|ConvertTo-Json -Compress)"
}

$Paths=Resolve-GrokRunnerPaths -Root $Root -Python $Python -SkillDir $SkillDir
$CanaryRoot=Join-Path $Root ("canary-runs\canonical-history-v0.2.0\"+$TaskId)
New-Item -ItemType Directory -Force -Path $CanaryRoot|Out-Null
$Before=@(Get-ChildItem $CanaryRoot -Directory -Filter "grok_build_*" -ErrorAction SilentlyContinue|ForEach-Object{$_.FullName})
$Stamp=Get-Date -Format "yyyyMMdd-HHmmss"
$Started=[DateTimeOffset]::UtcNow
$Out=Join-Path $Paths.Logs ("canonical-"+$TaskId+"-"+$Stamp+".stdout.txt")
$Err=Join-Path $Paths.Logs ("canonical-"+$TaskId+"-"+$Stamp+".stderr.txt")

$Args=@(
    "-X","utf8",$Paths.Runner,
    "--skill-dir",$Paths.Skill,
    "--grok-build-cli",$Paths.Grok,
    "--grok-build-home",$Paths.Home,
    "--adapter-url",$AdapterUrl,
    "--expected-adapter-version","0.2.0",
    "--suite",$TaskId,
    "--judge-model","openrouter/anthropic/claude-opus-5",
    "--timeout-multiplier","3.0",
    "--network-timeout","300",
    "--judge-timeout","300",
    "--results-dir",$CanaryRoot,
    "--keep-workspaces",
    "--clear-judge-cache",
    "--verbose"
)

$Proc=Start-Process -FilePath $Paths.Python -ArgumentList $Args -WorkingDirectory $Root -RedirectStandardOutput $Out -RedirectStandardError $Err -NoNewWindow -Wait -PassThru
Show-LoggedProcessResult $Proc $Out $Err 260

$Runs=@(Get-ChildItem $CanaryRoot -Directory -Filter "grok_build_*" -ErrorAction SilentlyContinue|Sort-Object LastWriteTime -Descending)
$Run=$Runs|Where-Object{$Before-notcontains$_.FullName}|Select-Object -First 1
if(-not$Run){$Run=$Runs|Select-Object -First 1}
if(-not$Run){throw "No isolated run directory was created. stdout=$Out stderr=$Err"}

$ResultPath=Join-Path $Run.FullName "results.json"
$Row=$null
if(Test-Path -LiteralPath $ResultPath){
    $Payload=Get-Content -LiteralPath $ResultPath -Raw -Encoding UTF8|ConvertFrom-Json
    $Row=@($Payload.results)|Where-Object{$_.task_id-eq$TaskId}|Select-Object -Last 1
}
if(-not$Row){
    $Progress=Join-Path $Run.FullName "progress.jsonl"
    if(Test-Path -LiteralPath $Progress){
        $Row=Get-Content -LiteralPath $Progress -Encoding UTF8|ForEach-Object{try{$_|ConvertFrom-Json}catch{}}|Where-Object{$_.task_id-eq$TaskId}|Select-Object -Last 1
    }
}
if(-not$Row){throw "Task result missing. Run=$($Run.FullName)"}

$Evidence=(@([string]$Row.error,[string]$Row.stderr,[string]$Row.grade_error)-join"`n")
if($Evidence-match"Invalid Responses API request"){
    throw "Task still hit an upstream Responses schema failure. Run=$($Run.FullName)"
}
if($Row.success-ne$true -or [string]$Row.status-ne"success" -or [int]$Row.returncode-ne0){
    throw "Task did not complete successfully. success=$($Row.success) status=$($Row.status) returncode=$($Row.returncode) score=$($Row.score) error=$($Row.error) Run=$($Run.FullName)"
}

$ExpectedFile=if($TaskId-eq"task_deep_research"){"wasm_research.md"}else{"oss_alternatives.md"}
$Report=Join-Path ([string]$Row.workspace) $ExpectedFile
if(-not(Test-Path -LiteralPath $Report)){throw "Expected report is missing: $Report"}
if((Get-Item -LiteralPath $Report).Length-lt1000){throw "Expected report is unexpectedly small: $Report"}

$Log=Join-Path $Root "logs\search-adapter.jsonl"
$FallbackCount=0
$FallbackFailureCount=0
if(Test-Path -LiteralPath $Log){
    foreach($Line in Get-Content -LiteralPath $Log -Encoding UTF8){
        try{$Event=$Line|ConvertFrom-Json}catch{continue}
        try{$When=[DateTimeOffset]::Parse([string]$Event.ts)}catch{continue}
        if($When-lt$Started){continue}
        if([string]$Event.event-eq"portable_history_fallback_retry"){$FallbackCount++}
        if([string]$Event.event-eq"portable_history_fallback_failed"){$FallbackFailureCount++}
    }
}
if($FallbackFailureCount-gt0){throw "Adapter portable-history fallback failed during the task. Count=$FallbackFailureCount"}

Write-Host ""
Write-Host "PASS: $TaskId completed through canonical Adapter v0.2.0." -ForegroundColor Green
Write-Host "Run               : $($Run.FullName)"
Write-Host "Score             : $($Row.score)"
Write-Host "Elapsed           : $($Row.elapsed)"
Write-Host "Report            : $Report"
Write-Host "Portable retries  : $FallbackCount"
Write-Host "Portable failures : $FallbackFailureCount"
