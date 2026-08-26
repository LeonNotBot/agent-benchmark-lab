param(
    [string]$Root = "C:\pinchbench-grok-build",
    [string]$Python = "C:\pinchbench-opencode\.venv\Scripts\python.exe"
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$global:OutputEncoding = New-Object System.Text.UTF8Encoding($false)

$Source = Split-Path -Parent $MyInvocation.MyCommand.Path
$AdapterDir = Join-Path $Root "search-adapter"
$RunnerDir = Join-Path $Root "runner"
$Adapter = Join-Path $AdapterDir "grok_build_search_adapter.py"
$Common = Join-Path $RunnerDir "common_grok_build_runner.ps1"
$Runner = Join-Path $RunnerDir "run_pinchbench_grok_build_windows.py"

foreach($Path in @($Python,$Adapter,$Common,$Runner)){
    if(-not(Test-Path -LiteralPath $Path)){throw "Required path missing: $Path"}
}

$Live = $null
try{$Live = Invoke-RestMethod -Uri "http://127.0.0.1:8767/healthz" -TimeoutSec 5}catch{}
if($Live){
    if(-not$Live.ok -or [string]$Live.target_model -ne "deepseek/deepseek-v4-pro"){
        throw "Live Adapter health/model is unexpected: $($Live|ConvertTo-Json -Compress)"
    }
    if([string]$Live.version -notin @("0.1.4","0.2.0")){
        throw "Expected live Adapter v0.1.4 or v0.2.0 before installation; actual=$($Live.version)"
    }
}

$Stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$Backup = Join-Path $Root "packages\hotfix-backup\canonical-history-v0.2.0-$Stamp"
New-Item -ItemType Directory -Force -Path $Backup,$AdapterDir | Out-Null

Copy-Item -LiteralPath $Adapter -Destination (Join-Path $Backup "grok_build_search_adapter.py") -Force
Copy-Item -LiteralPath $Common -Destination (Join-Path $Backup "common_grok_build_runner.ps1") -Force
Copy-Item -LiteralPath $Runner -Destination (Join-Path $Backup "run_pinchbench_grok_build_windows.py") -Force

foreach($Name in @(
    "grok_build_search_adapter.py",
    "test_canonical_history.py",
    "direct_canonical_history_canary.py",
    "07_run_canonical_history_protocol_canary.ps1",
    "08_run_research_task_isolated_v0_2_0.ps1"
)){
    $From = Join-Path $Source $Name
    if(-not(Test-Path -LiteralPath $From)){throw "Package file missing: $From"}
    Copy-Item -LiteralPath $From -Destination (Join-Path $AdapterDir $Name) -Force
}

$Utf8NoBom = [System.Text.UTF8Encoding]::new($false)
$Utf8Bom = [System.Text.UTF8Encoding]::new($true)

function Read-Utf8State {
    param([Parameter(Mandatory=$true)][string]$Path)
    $Bytes = [System.IO.File]::ReadAllBytes($Path)
    $HasBom = $Bytes.Length -ge 3 -and $Bytes[0] -eq 0xEF -and $Bytes[1] -eq 0xBB -and $Bytes[2] -eq 0xBF
    $Encoding = if($HasBom){$Utf8Bom}else{$Utf8NoBom}
    $Text = $Encoding.GetString($Bytes)
    if($HasBom -and $Text.Length -gt 0 -and [int]$Text[0] -eq 0xFEFF){$Text=$Text.Substring(1)}
    [pscustomobject]@{Text=$Text;HasBom=$HasBom}
}
function Write-Utf8State {
    param([string]$Path,[string]$Text,[bool]$HasBom)
    $Encoding = if($HasBom){$Utf8Bom}else{$Utf8NoBom}
    [System.IO.File]::WriteAllText($Path,$Text,$Encoding)
}

$CommonState = Read-Utf8State $Common
$CommonMatches = [regex]::Matches($CommonState.Text,'\[string\]\$h\.version\s+-ne\s+"[^"]+"')
if($CommonMatches.Count -ne 1){throw "Expected exactly one active PowerShell Adapter version gate; found $($CommonMatches.Count)"}
$CommonPatched = [regex]::Replace(
    $CommonState.Text,
    '\[string\]\$h\.version\s+-ne\s+"[^"]+"',
    '[string]$h.version -ne "0.2.0"',
    1
)
Write-Utf8State $Common $CommonPatched $CommonState.HasBom

$RunnerState = Read-Utf8State $Runner
$DefaultMatches = [regex]::Matches($RunnerState.Text,'DEFAULT_ADAPTER_VERSION\s*=\s*"[^"]+"')
if($DefaultMatches.Count -ne 1){throw "Expected exactly one DEFAULT_ADAPTER_VERSION; found $($DefaultMatches.Count)"}
$RunnerPatched = [regex]::Replace(
    $RunnerState.Text,
    'DEFAULT_ADAPTER_VERSION\s*=\s*"[^"]+"',
    'DEFAULT_ADAPTER_VERSION = "0.2.0"',
    1
)

$RevisionMatches = [regex]::Matches($RunnerPatched,'RUNNER_REVISION\s*=\s*"[^"]+"')
if($RevisionMatches.Count -ne 1){throw "Expected exactly one RUNNER_REVISION; found $($RevisionMatches.Count)"}
$RunnerPatched = [regex]::Replace(
    $RunnerPatched,
    'RUNNER_REVISION\s*=\s*"[^"]+"',
    'RUNNER_REVISION = "2026-08-03-grok-build-windows-v1.1.0-canonical-history-adapter-0.2.0"',
    1
)

$RunnerPatched = [regex]::Replace(
    $RunnerPatched,
    '"adapter_scope":\s*"[^"]*",',
    '"adapter_scope": "canonicalize all Responses history items; repair web-search action schemas; stringify tool payloads; portable-history retry; local diagnostics",',
    1
)
if($RunnerPatched -notmatch 'DEFAULT_MODEL_ID\s*=\s*"deepseek/deepseek-v4-pro"'){
    throw "DeepSeek target-model constant changed unexpectedly."
}
Write-Utf8State $Runner $RunnerPatched $RunnerState.HasBom

& $Python -X utf8 -m py_compile `
    (Join-Path $AdapterDir "grok_build_search_adapter.py") `
    (Join-Path $AdapterDir "test_canonical_history.py") `
    (Join-Path $AdapterDir "direct_canonical_history_canary.py") `
    $Runner
if($LASTEXITCODE -ne 0){throw "Python compile validation failed."}

& $Python -X utf8 (Join-Path $AdapterDir "test_canonical_history.py")
if($LASTEXITCODE -ne 0){throw "Canonical-history unit tests failed."}

$InstalledAdapterHash = (Get-FileHash -LiteralPath $Adapter -Algorithm SHA256).Hash.ToLowerInvariant()
$InstalledCommonHash = (Get-FileHash -LiteralPath $Common -Algorithm SHA256).Hash.ToLowerInvariant()
$InstalledRunnerHash = (Get-FileHash -LiteralPath $Runner -Algorithm SHA256).Hash.ToLowerInvariant()

$AdapterText = [System.IO.File]::ReadAllText($Adapter,[System.Text.Encoding]::UTF8)
$CommonText = [System.IO.File]::ReadAllText($Common,[System.Text.Encoding]::UTF8)
$RunnerText = [System.IO.File]::ReadAllText($Runner,[System.Text.Encoding]::UTF8)
if($AdapterText -notmatch 'VERSION\s*=\s*"0\.2\.0"'){throw "Installed Adapter version is not 0.2.0"}
if($CommonText -notmatch '\[string\]\$h\.version\s+-ne\s+"0\.2\.0"'){throw "PowerShell Runner gate is not 0.2.0"}
if($RunnerText -notmatch 'DEFAULT_ADAPTER_VERSION\s*=\s*"0\.2\.0"'){throw "Python Runner gate is not 0.2.0"}

$Manifest = [ordered]@{
    installed_at = (Get-Date).ToString("o")
    backup = $Backup
    live_adapter_before_restart = $Live
    adapter_sha256 = $InstalledAdapterHash
    common_sha256 = $InstalledCommonHash
    runner_sha256 = $InstalledRunnerHash
    adapter_version = "0.2.0"
    compiler = "canonical-history-v1"
    target_model = "deepseek/deepseek-v4-pro"
}
$Manifest | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath (Join-Path $Backup "manifest.json") -Encoding UTF8

Write-Host ""
Write-Host "PASS: canonical-history Adapter v0.2.0 installed." -ForegroundColor Green
Write-Host "Adapter SHA256 : $InstalledAdapterHash"
Write-Host "Runner revision: 2026-08-03-grok-build-windows-v1.1.0-canonical-history-adapter-0.2.0"
Write-Host "Backup         : $Backup"
Write-Host "IMPORTANT: restart Window A before running the protocol canary."
Write-Host "This installer did not modify the existing benchmark run or progress files."
