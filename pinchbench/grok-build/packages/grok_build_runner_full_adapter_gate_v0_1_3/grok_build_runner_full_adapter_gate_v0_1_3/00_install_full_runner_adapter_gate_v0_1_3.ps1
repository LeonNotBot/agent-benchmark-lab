param(
    [string]$Root = "C:\pinchbench-grok-build",
    [string]$AdapterUrl = "http://127.0.0.1:8767",
    [string]$Python = "",
    [string]$SkillDir = ""
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$global:OutputEncoding = New-Object System.Text.UTF8Encoding($false)

$RunnerDir = Join-Path $Root "runner"
$Common = Join-Path $RunnerDir "common_grok_build_runner.ps1"
$Runner = Join-Path $RunnerDir "run_pinchbench_grok_build_windows.py"

foreach ($Required in @($Common,$Runner)) {
    if (-not (Test-Path -LiteralPath $Required)) {
        throw "Required Runner file not found: $Required"
    }
}

$Health = Invoke-RestMethod -Uri ($AdapterUrl.TrimEnd("/") + "/healthz") -TimeoutSec 5
if (-not $Health.ok -or [string]$Health.version -ne "0.1.3" -or [string]$Health.target_model -ne "deepseek/deepseek-v4-pro") {
    throw "Expected healthy Adapter v0.1.3 targeting deepseek/deepseek-v4-pro. Actual: $($Health | ConvertTo-Json -Compress)"
}

$Utf8NoBom = [System.Text.UTF8Encoding]::new($false)
$Utf8Bom = [System.Text.UTF8Encoding]::new($true)

function Read-Utf8TextPreservingBom {
    param([Parameter(Mandatory=$true)][string]$Path)
    $Bytes = [System.IO.File]::ReadAllBytes($Path)
    $HasBom = $Bytes.Length -ge 3 -and $Bytes[0] -eq 0xEF -and $Bytes[1] -eq 0xBB -and $Bytes[2] -eq 0xBF
    $Encoding = if ($HasBom) { $Utf8Bom } else { $Utf8NoBom }
    $Text = $Encoding.GetString($Bytes)
    if ($HasBom -and $Text.Length -gt 0 -and [int]$Text[0] -eq 0xFEFF) {
        $Text = $Text.Substring(1)
    }
    [pscustomobject]@{ Text=$Text; HasBom=$HasBom }
}

function Write-Utf8TextPreservingBom {
    param(
        [Parameter(Mandatory=$true)][string]$Path,
        [Parameter(Mandatory=$true)][string]$Text,
        [Parameter(Mandatory=$true)][bool]$HasBom
    )
    $Encoding = if ($HasBom) { $Utf8Bom } else { $Utf8NoBom }
    [System.IO.File]::WriteAllText($Path,$Text,$Encoding)
}

$CommonState = Read-Utf8TextPreservingBom -Path $Common
$RunnerState = Read-Utf8TextPreservingBom -Path $Runner

$CommonOld = '[string]$h.version -ne "0.1.2"'
$CommonNew = '[string]$h.version -ne "0.1.3"'
$DefaultOld = 'DEFAULT_ADAPTER_VERSION = "0.1.2"'
$DefaultNew = 'DEFAULT_ADAPTER_VERSION = "0.1.3"'
$RevisionOld = 'RUNNER_REVISION = "2026-08-03-grok-build-windows-v1.0.0-search-adapter-0.1.2"'
$RevisionNew = 'RUNNER_REVISION = "2026-08-03-grok-build-windows-v1.0.1-search-adapter-0.1.3"'

function Count-Literal {
    param([string]$Text,[string]$Literal)
    return ([regex]::Matches($Text,[regex]::Escape($Literal))).Count
}

$CommonOldCount = Count-Literal $CommonState.Text $CommonOld
$CommonNewCount = Count-Literal $CommonState.Text $CommonNew
$DefaultOldCount = Count-Literal $RunnerState.Text $DefaultOld
$DefaultNewCount = Count-Literal $RunnerState.Text $DefaultNew
$RevisionOldCount = Count-Literal $RunnerState.Text $RevisionOld
$RevisionNewCount = Count-Literal $RunnerState.Text $RevisionNew

if (-not (
    (($CommonOldCount -eq 1 -and $CommonNewCount -eq 0) -or ($CommonOldCount -eq 0 -and $CommonNewCount -eq 1)) -and
    (($DefaultOldCount -eq 1 -and $DefaultNewCount -eq 0) -or ($DefaultOldCount -eq 0 -and $DefaultNewCount -eq 1)) -and
    (($RevisionOldCount -eq 1 -and $RevisionNewCount -eq 0) -or ($RevisionOldCount -eq 0 -and $RevisionNewCount -eq 1))
)) {
    throw "Unexpected active Runner version-gate state. common_old=$CommonOldCount common_new=$CommonNewCount default_old=$DefaultOldCount default_new=$DefaultNewCount revision_old=$RevisionOldCount revision_new=$RevisionNewCount"
}

$Stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$BackupDir = Join-Path $RunnerDir "hotfix-backup\full-adapter-gate-v0.1.3-$Stamp"
New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null
Copy-Item -LiteralPath $Common -Destination (Join-Path $BackupDir "common_grok_build_runner.ps1") -Force
Copy-Item -LiteralPath $Runner -Destination (Join-Path $BackupDir "run_pinchbench_grok_build_windows.py") -Force

$BeforeCommonHash = (Get-FileHash -LiteralPath $Common -Algorithm SHA256).Hash.ToLowerInvariant()
$BeforeRunnerHash = (Get-FileHash -LiteralPath $Runner -Algorithm SHA256).Hash.ToLowerInvariant()

$PatchedCommon = $CommonState.Text.Replace($CommonOld,$CommonNew)
$PatchedRunner = $RunnerState.Text.Replace($DefaultOld,$DefaultNew).Replace($RevisionOld,$RevisionNew)

if ((Count-Literal $PatchedCommon $CommonOld) -ne 0 -or (Count-Literal $PatchedCommon $CommonNew) -ne 1) {
    throw "PowerShell Adapter gate validation failed before write."
}
if ((Count-Literal $PatchedRunner $DefaultOld) -ne 0 -or (Count-Literal $PatchedRunner $DefaultNew) -ne 1) {
    throw "Python DEFAULT_ADAPTER_VERSION validation failed before write."
}
if ((Count-Literal $PatchedRunner $RevisionOld) -ne 0 -or (Count-Literal $PatchedRunner $RevisionNew) -ne 1) {
    throw "Python RUNNER_REVISION validation failed before write."
}
if ($PatchedRunner -notmatch 'DEFAULT_MODEL_ID\s*=\s*"deepseek/deepseek-v4-pro"') {
    throw "DeepSeek model safety constant was not preserved."
}

Write-Utf8TextPreservingBom -Path $Common -Text $PatchedCommon -HasBom $CommonState.HasBom
Write-Utf8TextPreservingBom -Path $Runner -Text $PatchedRunner -HasBom $RunnerState.HasBom

$AfterCommonHash = (Get-FileHash -LiteralPath $Common -Algorithm SHA256).Hash.ToLowerInvariant()
$AfterRunnerHash = (Get-FileHash -LiteralPath $Runner -Algorithm SHA256).Hash.ToLowerInvariant()

. $Common
Set-GrokBenchmarkEnvironment -Root $Root
$VerifiedHealth = Assert-GrokSearchAdapter -AdapterUrl $AdapterUrl
$Paths = Resolve-GrokRunnerPaths -Root $Root -Python $Python -SkillDir $SkillDir

& $Paths.Python -X utf8 -m py_compile $Runner
if ($LASTEXITCODE -ne 0) {
    throw "Patched Python Runner compile check failed."
}

$Probe = & $Paths.Python -X utf8 -c "import importlib.util; p=r'$Runner'; s=importlib.util.spec_from_file_location('grok_runner_gate_probe',p); m=importlib.util.module_from_spec(s); s.loader.exec_module(m); print(m.RUNNER_REVISION); print(m.DEFAULT_ADAPTER_VERSION); print(m.DEFAULT_MODEL_ID)" 2>&1
if ($LASTEXITCODE -ne 0) {
    throw "Unable to import patched Runner constants: $($Probe -join [Environment]::NewLine)"
}
$ProbeLines = @($Probe | ForEach-Object {[string]$_})
if ($ProbeLines.Count -lt 3 -or $ProbeLines[-3] -ne "2026-08-03-grok-build-windows-v1.0.1-search-adapter-0.1.3" -or $ProbeLines[-2] -ne "0.1.3" -or $ProbeLines[-1] -ne "deepseek/deepseek-v4-pro") {
    throw "Patched Runner constants are unexpected: $($ProbeLines -join ' | ')"
}

$Manifest = [ordered]@{
    installed_at = (Get-Date).ToString("o")
    backup_dir = $BackupDir
    common_before_sha256 = $BeforeCommonHash
    common_after_sha256 = $AfterCommonHash
    runner_before_sha256 = $BeforeRunnerHash
    runner_after_sha256 = $AfterRunnerHash
    runner_revision = $ProbeLines[-3]
    adapter_expected_version = $ProbeLines[-2]
    model = $ProbeLines[-1]
    live_adapter = $VerifiedHealth
}
$Manifest | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath (Join-Path $BackupDir "manifest.json") -Encoding UTF8

Write-Host ""
Write-Host "PASS: active PowerShell and Python Runner gates now both require Adapter v0.1.3." -ForegroundColor Green
Write-Host "Runner revision : $($ProbeLines[-3])"
Write-Host "Adapter default : $($ProbeLines[-2])"
Write-Host "Actual model    : $($ProbeLines[-1])"
Write-Host "Backup          : $BackupDir"
Write-Host "Python SHA256   : $AfterRunnerHash"
Write-Host "Do not run 06_prepare_invalid_prompt_failures_for_resume.ps1 again. Resume directly."
