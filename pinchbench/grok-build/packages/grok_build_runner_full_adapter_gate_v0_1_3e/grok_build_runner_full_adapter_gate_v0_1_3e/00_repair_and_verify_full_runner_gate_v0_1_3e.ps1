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
$SourceDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Verifier = Join-Path $SourceDir "verify_runner_constants_ast.py"

foreach ($Required in @($Common,$Runner,$Verifier)) {
    if (-not (Test-Path -LiteralPath $Required)) {
        throw "Required file not found: $Required"
    }
}

$Health = Invoke-RestMethod -Uri ($AdapterUrl.TrimEnd("/") + "/healthz") -TimeoutSec 5
if (-not $Health.ok -or [string]$Health.version -ne "0.1.3" -or [string]$Health.target_model -ne "deepseek/deepseek-v4-pro") {
    throw "Expected healthy Adapter v0.1.3 targeting deepseek/deepseek-v4-pro. Actual: $($Health | ConvertTo-Json -Compress)"
}

$Utf8NoBom = [System.Text.UTF8Encoding]::new($false)
$Utf8Bom = [System.Text.UTF8Encoding]::new($true)

function Read-Utf8State {
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

function Write-Utf8State {
    param(
        [Parameter(Mandatory=$true)][string]$Path,
        [Parameter(Mandatory=$true)][string]$Text,
        [Parameter(Mandatory=$true)][bool]$HasBom
    )
    $Encoding = if ($HasBom) { $Utf8Bom } else { $Utf8NoBom }
    [System.IO.File]::WriteAllText($Path,$Text,$Encoding)
}

function Count-Literal {
    param([string]$Text,[string]$Literal)
    ([regex]::Matches($Text,[regex]::Escape($Literal))).Count
}

function Invoke-NativeChecked {
    param(
        [Parameter(Mandatory=$true)][string]$FilePath,
        [Parameter(Mandatory=$true)][string[]]$Arguments,
        [Parameter(Mandatory=$true)][string]$Label,
        [Parameter(Mandatory=$true)][string]$TempDir
    )

    New-Item -ItemType Directory -Force -Path $TempDir | Out-Null
    $Out = Join-Path $TempDir ($Label + ".stdout.txt")
    $Err = Join-Path $TempDir ($Label + ".stderr.txt")
    Remove-Item -LiteralPath $Out,$Err -Force -ErrorAction SilentlyContinue

    $Proc = Start-Process -FilePath $FilePath -ArgumentList $Arguments -NoNewWindow -Wait -PassThru -RedirectStandardOutput $Out -RedirectStandardError $Err

    # ReadAllText always returns a string, including for a zero-byte file.
    $Stdout = if (Test-Path -LiteralPath $Out) {
        [System.IO.File]::ReadAllText($Out,[System.Text.Encoding]::UTF8)
    } else {
        [string]::Empty
    }
    $Stderr = if (Test-Path -LiteralPath $Err) {
        [System.IO.File]::ReadAllText($Err,[System.Text.Encoding]::UTF8)
    } else {
        [string]::Empty
    }

    if ($Proc.ExitCode -ne 0) {
        throw "$Label failed with exit code $($Proc.ExitCode). stderr=$Stderr stdout=$Stdout"
    }

    [pscustomobject]@{
        ExitCode = $Proc.ExitCode
        Stdout = $Stdout.Trim()
        Stderr = $Stderr.Trim()
    }
}

$CommonState = Read-Utf8State -Path $Common
$RunnerState = Read-Utf8State -Path $Runner

$CommonOld = '[string]$h.version -ne "0.1.2"'
$CommonNew = '[string]$h.version -ne "0.1.3"'
$DefaultOld = 'DEFAULT_ADAPTER_VERSION = "0.1.2"'
$DefaultNew = 'DEFAULT_ADAPTER_VERSION = "0.1.3"'
$RevisionOld = 'RUNNER_REVISION = "2026-08-03-grok-build-windows-v1.0.0-search-adapter-0.1.2"'
$RevisionNew = 'RUNNER_REVISION = "2026-08-03-grok-build-windows-v1.0.1-search-adapter-0.1.3"'

$States = @(
    [pscustomobject]@{ Name="PowerShell gate"; Text=$CommonState.Text; Old=$CommonOld; New=$CommonNew },
    [pscustomobject]@{ Name="Python default"; Text=$RunnerState.Text; Old=$DefaultOld; New=$DefaultNew },
    [pscustomobject]@{ Name="Python revision"; Text=$RunnerState.Text; Old=$RevisionOld; New=$RevisionNew }
)
foreach ($State in $States) {
    $OldCount = Count-Literal $State.Text $State.Old
    $NewCount = Count-Literal $State.Text $State.New
    if (-not (($OldCount -eq 1 -and $NewCount -eq 0) -or ($OldCount -eq 0 -and $NewCount -eq 1))) {
        throw "Unexpected $($State.Name) state. old_count=$OldCount new_count=$NewCount"
    }
}

$PatchedCommon = $CommonState.Text.Replace($CommonOld,$CommonNew)
$PatchedRunner = $RunnerState.Text.Replace($DefaultOld,$DefaultNew).Replace($RevisionOld,$RevisionNew)

if ((Count-Literal $PatchedCommon $CommonOld) -ne 0 -or (Count-Literal $PatchedCommon $CommonNew) -ne 1) {
    throw "PowerShell gate validation failed."
}
if ((Count-Literal $PatchedRunner $DefaultOld) -ne 0 -or (Count-Literal $PatchedRunner $DefaultNew) -ne 1) {
    throw "Python Adapter default validation failed."
}
if ((Count-Literal $PatchedRunner $RevisionOld) -ne 0 -or (Count-Literal $PatchedRunner $RevisionNew) -ne 1) {
    throw "Python Runner revision validation failed."
}
if ($PatchedRunner -notmatch 'DEFAULT_MODEL_ID\s*=\s*"deepseek/deepseek-v4-pro"') {
    throw "DeepSeek model constant was not preserved."
}

$ChangedCommon = $PatchedCommon -cne $CommonState.Text
$ChangedRunner = $PatchedRunner -cne $RunnerState.Text
$Stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$BackupDir = Join-Path $RunnerDir "hotfix-backup\full-adapter-gate-v0.1.3e-$Stamp"
New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null

if ($ChangedCommon) {
    Copy-Item -LiteralPath $Common -Destination (Join-Path $BackupDir "common_grok_build_runner.ps1") -Force
    Write-Utf8State -Path $Common -Text $PatchedCommon -HasBom $CommonState.HasBom
}
if ($ChangedRunner) {
    Copy-Item -LiteralPath $Runner -Destination (Join-Path $BackupDir "run_pinchbench_grok_build_windows.py") -Force
    Write-Utf8State -Path $Runner -Text $PatchedRunner -HasBom $RunnerState.HasBom
}

. $Common
Set-GrokBenchmarkEnvironment -Root $Root
$VerifiedHealth = Assert-GrokSearchAdapter -AdapterUrl $AdapterUrl
$Paths = Resolve-GrokRunnerPaths -Root $Root -Python $Python -SkillDir $SkillDir
if ($null -eq $Paths -or [string]::IsNullOrWhiteSpace([string]$Paths.Python)) {
    throw "Resolve-GrokRunnerPaths did not return a Python executable."
}
if (-not (Test-Path -LiteralPath ([string]$Paths.Python))) {
    throw "Resolved Python executable does not exist: $($Paths.Python)"
}

$TempDir = Join-Path $env:TEMP "grok-runner-gate-v0.1.3e-$Stamp"
$null = Invoke-NativeChecked -FilePath ([string]$Paths.Python) -Arguments @("-X","utf8","-m","py_compile",$Runner) -Label "py_compile" -TempDir $TempDir
$Ast = Invoke-NativeChecked -FilePath ([string]$Paths.Python) -Arguments @("-X","utf8",$Verifier,"--runner",$Runner) -Label "ast_verify" -TempDir $TempDir
$Constants = $Ast.Stdout | ConvertFrom-Json

if ([string]$Constants.RUNNER_REVISION -ne "2026-08-03-grok-build-windows-v1.0.1-search-adapter-0.1.3") {
    throw "Unexpected RUNNER_REVISION: $($Constants.RUNNER_REVISION)"
}
if ([string]$Constants.DEFAULT_ADAPTER_VERSION -ne "0.1.3") {
    throw "Unexpected DEFAULT_ADAPTER_VERSION: $($Constants.DEFAULT_ADAPTER_VERSION)"
}
if ([string]$Constants.DEFAULT_MODEL_ID -ne "deepseek/deepseek-v4-pro") {
    throw "Unexpected DEFAULT_MODEL_ID: $($Constants.DEFAULT_MODEL_ID)"
}

$Manifest = [ordered]@{
    installed_at = (Get-Date).ToString("o")
    changed_common = $ChangedCommon
    changed_runner = $ChangedRunner
    runner_revision = [string]$Constants.RUNNER_REVISION
    adapter_expected_version = [string]$Constants.DEFAULT_ADAPTER_VERSION
    model = [string]$Constants.DEFAULT_MODEL_ID
    python = [string]$Paths.Python
    common_sha256 = (Get-FileHash -LiteralPath $Common -Algorithm SHA256).Hash.ToLowerInvariant()
    runner_sha256 = (Get-FileHash -LiteralPath $Runner -Algorithm SHA256).Hash.ToLowerInvariant()
    live_adapter = $VerifiedHealth
}
$Manifest | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath (Join-Path $BackupDir "manifest.json") -Encoding UTF8

Write-Host ""
Write-Host "PASS: active PowerShell and Python Runner gates both require Adapter v0.1.3." -ForegroundColor Green
Write-Host "Changed common  : $ChangedCommon"
Write-Host "Changed runner  : $ChangedRunner"
Write-Host "Runner revision : $($Constants.RUNNER_REVISION)"
Write-Host "Adapter default : $($Constants.DEFAULT_ADAPTER_VERSION)"
Write-Host "Actual model    : $($Constants.DEFAULT_MODEL_ID)"
Write-Host "Python          : $($Paths.Python)"
Write-Host "Manifest        : $(Join-Path $BackupDir 'manifest.json')"
Write-Host "Do not run 06_prepare_invalid_prompt_failures_for_resume.ps1 again. Resume directly."
