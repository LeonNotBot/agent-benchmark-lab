param(
    [string]$Root="C:\pinchbench-grok-build",
    [string]$Python="C:\pinchbench-opencode\.venv\Scripts\python.exe"
)
$ErrorActionPreference="Stop"
[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false)
$global:OutputEncoding=New-Object System.Text.UTF8Encoding($false)

$Source=Split-Path -Parent $MyInvocation.MyCommand.Path
$AdapterDir=Join-Path $Root "search-adapter"
$RunnerDir=Join-Path $Root "runner"
$Adapter=Join-Path $AdapterDir "grok_build_search_adapter.py"
$Common=Join-Path $RunnerDir "common_grok_build_runner.ps1"
$Runner=Join-Path $RunnerDir "run_pinchbench_grok_build_windows.py"

foreach($Path in @($Adapter,$Common,$Runner,$Python)){
    if(-not(Test-Path -LiteralPath $Path)){throw "Required path missing: $Path"}
}

$Health=$null
try{$Health=Invoke-RestMethod -Uri "http://127.0.0.1:8767/healthz" -TimeoutSec 5}catch{}
if($Health){
    if(-not$Health.ok-or[string]$Health.target_model-ne"deepseek/deepseek-v4-pro"){
        throw "Live Adapter target model/health is unexpected: $($Health|ConvertTo-Json -Compress)"
    }
    if([string]$Health.version-notin@("0.1.3","0.1.4")){
        throw "Expected live Adapter v0.1.3 or v0.1.4 before upgrade, actual=$($Health.version)"
    }
}

$Stamp=Get-Date -Format "yyyyMMdd-HHmmss"
$Backup=Join-Path $Root "packages\hotfix-backup\reasoning-summary-v0.1.4-$Stamp"
New-Item -ItemType Directory -Force -Path $Backup,$AdapterDir|Out-Null
Copy-Item -LiteralPath $Adapter -Destination (Join-Path $Backup "grok_build_search_adapter.py") -Force
Copy-Item -LiteralPath $Common -Destination (Join-Path $Backup "common_grok_build_runner.ps1") -Force
Copy-Item -LiteralPath $Runner -Destination (Join-Path $Backup "run_pinchbench_grok_build_windows.py") -Force

Copy-Item -LiteralPath (Join-Path $Source "grok_build_search_adapter.py") -Destination $Adapter -Force
foreach($Name in @(
    "test_reasoning_summary_normalization.py",
    "direct_reasoning_summary_canary.py",
    "07_run_reasoning_summary_protocol_canary.ps1",
    "08_run_task_deep_research_isolated.ps1",
    "prepare_reasoning_summary_failures_for_resume.py",
    "09_prepare_reasoning_summary_failures_for_resume.ps1"
)){
    Copy-Item -LiteralPath (Join-Path $Source $Name) -Destination (Join-Path $AdapterDir $Name) -Force
}

$Utf8NoBom=[System.Text.UTF8Encoding]::new($false)
$Utf8Bom=[System.Text.UTF8Encoding]::new($true)
function Read-State([string]$Path){
    $Bytes=[System.IO.File]::ReadAllBytes($Path)
    $Bom=$Bytes.Length-ge3-and$Bytes[0]-eq0xEF-and$Bytes[1]-eq0xBB-and$Bytes[2]-eq0xBF
    $Encoding=if($Bom){$Utf8Bom}else{$Utf8NoBom}
    $Text=$Encoding.GetString($Bytes)
    if($Bom-and$Text.Length-gt0-and[int]$Text[0]-eq0xFEFF){$Text=$Text.Substring(1)}
    [pscustomobject]@{Text=$Text;Bom=$Bom}
}
function Write-State([string]$Path,[string]$Text,[bool]$Bom){
    $Encoding=if($Bom){$Utf8Bom}else{$Utf8NoBom}
    [System.IO.File]::WriteAllText($Path,$Text,$Encoding)
}

$CommonState=Read-State $Common
$CommonMatches=[regex]::Matches($CommonState.Text,'\[string\]\$h\.version\s+-ne\s+"0\.1\.[234]"')
if($CommonMatches.Count-ne1){throw "Expected exactly one PowerShell Adapter gate, found $($CommonMatches.Count)"}
$CommonPatched=[regex]::Replace($CommonState.Text,'\[string\]\$h\.version\s+-ne\s+"0\.1\.[234]"','[string]$h.version -ne "0.1.4"',1)
Write-State $Common $CommonPatched $CommonState.Bom

$RunnerState=Read-State $Runner
$DefaultMatches=[regex]::Matches($RunnerState.Text,'DEFAULT_ADAPTER_VERSION\s*=\s*"0\.1\.[234]"')
if($DefaultMatches.Count-ne1){throw "Expected exactly one Python DEFAULT_ADAPTER_VERSION, found $($DefaultMatches.Count)"}
$RunnerPatched=[regex]::Replace($RunnerState.Text,'DEFAULT_ADAPTER_VERSION\s*=\s*"0\.1\.[234]"','DEFAULT_ADAPTER_VERSION = "0.1.4"',1)

$RevisionMatches=[regex]::Matches($RunnerPatched,'RUNNER_REVISION\s*=\s*"[^"]+"')
if($RevisionMatches.Count-ne1){throw "Expected exactly one RUNNER_REVISION, found $($RevisionMatches.Count)"}
$RunnerPatched=[regex]::Replace($RunnerPatched,'RUNNER_REVISION\s*=\s*"[^"]+"','RUNNER_REVISION = "2026-08-03-grok-build-windows-v1.0.2-search-adapter-0.1.4-reasoning-summary"',1)

$OldScope='"adapter_scope": "force benchmark model; normalize OpenRouter web-search response events; suppress legacy SSE DONE",'
$NewScope='"adapter_scope": "force benchmark model; normalize web-search events; suppress legacy SSE DONE; repair missing reasoning summary arrays; stringify structured tool payloads",'
if($RunnerPatched.Contains($OldScope)){$RunnerPatched=$RunnerPatched.Replace($OldScope,$NewScope)}
Write-State $Runner $RunnerPatched $RunnerState.Bom

& $Python -X utf8 -m py_compile $Adapter $Runner (Join-Path $AdapterDir "prepare_reasoning_summary_failures_for_resume.py") (Join-Path $AdapterDir "direct_reasoning_summary_canary.py")
if($LASTEXITCODE-ne0){throw "Python compile validation failed."}
& $Python -X utf8 (Join-Path $AdapterDir "test_reasoning_summary_normalization.py")
if($LASTEXITCODE-ne0){throw "Adapter reasoning-summary unit test failed."}

$AdapterText=[System.IO.File]::ReadAllText($Adapter,[System.Text.Encoding]::UTF8)
if($AdapterText-notmatch'VERSION\s*=\s*"0\.1\.4"'){throw "Installed Adapter version constant is not 0.1.4"}
$CommonText=[System.IO.File]::ReadAllText($Common,[System.Text.Encoding]::UTF8)
$RunnerText=[System.IO.File]::ReadAllText($Runner,[System.Text.Encoding]::UTF8)
if($CommonText-notmatch'\[string\]\$h\.version\s+-ne\s+"0\.1\.4"'){throw "PowerShell gate is not 0.1.4"}
if($RunnerText-notmatch'DEFAULT_ADAPTER_VERSION\s*=\s*"0\.1\.4"'){throw "Python gate is not 0.1.4"}
if($RunnerText-notmatch'DEFAULT_MODEL_ID\s*=\s*"deepseek/deepseek-v4-pro"'){throw "DeepSeek model gate changed unexpectedly"}

$Manifest=[ordered]@{
    installed_at=(Get-Date).ToString("o")
    backup=$Backup
    adapter_sha256=(Get-FileHash -LiteralPath $Adapter -Algorithm SHA256).Hash.ToLowerInvariant()
    common_sha256=(Get-FileHash -LiteralPath $Common -Algorithm SHA256).Hash.ToLowerInvariant()
    runner_sha256=(Get-FileHash -LiteralPath $Runner -Algorithm SHA256).Hash.ToLowerInvariant()
    live_adapter_before_restart=$Health
}
$Manifest|ConvertTo-Json -Depth 20|Set-Content -LiteralPath (Join-Path $Backup "manifest.json") -Encoding UTF8

Write-Host ""
Write-Host "PASS: Adapter v0.1.4 reasoning-summary compatibility files installed." -ForegroundColor Green
Write-Host "Backup : $Backup"
Write-Host "IMPORTANT: restart Window A; the currently running process still uses its previously loaded code."
Write-Host "After restart run 07_run_reasoning_summary_protocol_canary.ps1, then the isolated one-task canary."
