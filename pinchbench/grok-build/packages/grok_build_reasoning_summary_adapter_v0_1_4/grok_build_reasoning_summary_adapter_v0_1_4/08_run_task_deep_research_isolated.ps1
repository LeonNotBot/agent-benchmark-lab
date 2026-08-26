param(
    [string]$Root="C:\pinchbench-grok-build",
    [string]$Python="",
    [string]$SkillDir="",
    [string]$ProxyUrl="http://127.0.0.1:10090",
    [string]$AdapterUrl="http://127.0.0.1:8767"
)
$ErrorActionPreference="Stop"
[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false)
$global:OutputEncoding=New-Object System.Text.UTF8Encoding($false)

. (Join-Path $Root "runner\common_grok_build_runner.ps1")
Set-GrokBenchmarkEnvironment -Root $Root -ProxyUrl $ProxyUrl
Assert-OpenRouterKey
$Health=Assert-GrokSearchAdapter -AdapterUrl $AdapterUrl
if([string]$Health.version-ne"0.1.4"){throw "Expected live Adapter v0.1.4, actual $($Health.version)"}
$p=Resolve-GrokRunnerPaths -Root $Root -Python $Python -SkillDir $SkillDir

$CanaryRoot=Join-Path $Root "canary-runs\reasoning-summary-v0.1.4"
New-Item -ItemType Directory -Force -Path $CanaryRoot|Out-Null
$Before=@(Get-ChildItem $CanaryRoot -Directory -Filter "grok_build_*" -ErrorAction SilentlyContinue | ForEach-Object {$_.FullName})
$Stamp=Get-Date -Format "yyyyMMdd-HHmmss"
$Out=Join-Path $p.Logs "reasoning-summary-deep-research-$Stamp.stdout.txt"
$Err=Join-Path $p.Logs "reasoning-summary-deep-research-$Stamp.stderr.txt"

$ProcessArguments=@(
    "-X","utf8",$p.Runner,
    "--skill-dir",$p.Skill,
    "--grok-build-cli",$p.Grok,
    "--grok-build-home",$p.Home,
    "--adapter-url",$AdapterUrl,
    "--expected-adapter-version","0.1.4",
    "--suite","task_deep_research",
    "--judge-model","openrouter/anthropic/claude-opus-5",
    "--timeout-multiplier","3.0",
    "--network-timeout","300",
    "--judge-timeout","300",
    "--results-dir",$CanaryRoot,
    "--keep-workspaces",
    "--clear-judge-cache",
    "--verbose"
)
$Proc=Start-Process -FilePath $p.Python -ArgumentList $ProcessArguments -WorkingDirectory $Root -RedirectStandardOutput $Out -RedirectStandardError $Err -NoNewWindow -Wait -PassThru
Show-LoggedProcessResult $Proc $Out $Err 260

$After=@(Get-ChildItem $CanaryRoot -Directory -Filter "grok_build_*" -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending)
$Run=$After|Where-Object {$Before-notcontains$_.FullName}|Select-Object -First 1
if(-not$Run){$Run=$After|Select-Object -First 1}
if(-not$Run){throw "No isolated canary run directory was created."}

$ResultPath=Join-Path $Run.FullName "results.json"
if(-not(Test-Path -LiteralPath $ResultPath)){throw "Missing isolated results.json: $ResultPath"}
$Payload=Get-Content -LiteralPath $ResultPath -Raw -Encoding UTF8|ConvertFrom-Json
$Row=@($Payload.results)|Where-Object {$_.task_id-eq"task_deep_research"}|Select-Object -Last 1
if(-not$Row){throw "task_deep_research result missing from isolated run."}

$Evidence=(@([string]$Row.error,[string]$Row.stderr,[string]$Row.grade_error)-join"`n")
if($Evidence-match"Invalid Responses API request|expected array, received undefined"){
    throw "Isolated task still hit the Responses reasoning-history schema failure. Run=$($Run.FullName)"
}
if(-not[bool]$Row.success-or[string]$Row.status-ne"success"){
    throw "Isolated task did not complete successfully. status=$($Row.status) score=$($Row.score) error=$($Row.error) Run=$($Run.FullName)"
}
$Report=Join-Path ([string]$Row.workspace) "wasm_research.md"
if(-not(Test-Path -LiteralPath $Report)){throw "Agent succeeded but wasm_research.md is missing: $Report"}
if((Get-Item -LiteralPath $Report).Length-lt1000){throw "wasm_research.md is unexpectedly small."}

Write-Host ""
Write-Host "PASS: isolated task_deep_research completed through Adapter v0.1.4." -ForegroundColor Green
Write-Host "Run    : $($Run.FullName)"
Write-Host "Score  : $($Row.score)"
Write-Host "Elapsed: $($Row.elapsed)"
Write-Host "Report : $Report"
Write-Host "NEXT: only now run 09_prepare_reasoning_summary_failures_for_resume.ps1."
