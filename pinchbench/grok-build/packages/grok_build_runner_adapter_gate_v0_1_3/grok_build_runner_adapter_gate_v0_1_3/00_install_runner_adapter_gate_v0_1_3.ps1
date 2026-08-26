param(
    [string]$Root = "C:\pinchbench-grok-build",
    [string]$AdapterUrl = "http://127.0.0.1:8767"
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$global:OutputEncoding = New-Object System.Text.UTF8Encoding($false)

$Common = Join-Path $Root "runner\common_grok_build_runner.ps1"
if (-not (Test-Path -LiteralPath $Common)) {
    throw "Runner common script not found: $Common"
}

$Health = Invoke-RestMethod -Uri ($AdapterUrl.TrimEnd("/") + "/healthz") -TimeoutSec 5
if (-not $Health.ok) {
    throw "Adapter health check returned ok=false."
}
if ([string]$Health.version -ne "0.1.3") {
    throw "Expected live Adapter v0.1.3, actual version=$($Health.version)"
}
if ([string]$Health.target_model -ne "deepseek/deepseek-v4-pro") {
    throw "Unexpected target model: $($Health.target_model)"
}

$Utf8NoBom = [System.Text.UTF8Encoding]::new($false)
$Utf8Bom = [System.Text.UTF8Encoding]::new($true)
$RawBytes = [System.IO.File]::ReadAllBytes($Common)
$HadBom = (
    $RawBytes.Length -ge 3 -and
    $RawBytes[0] -eq 0xEF -and
    $RawBytes[1] -eq 0xBB -and
    $RawBytes[2] -eq 0xBF
)
$Encoding = if ($HadBom) { $Utf8Bom } else { $Utf8NoBom }
$Text = $Encoding.GetString($RawBytes)
if ($HadBom -and $Text.Length -gt 0 -and [int]$Text[0] -eq 0xFEFF) {
    $Text = $Text.Substring(1)
}

$Old = '[string]$h.version -ne "0.1.2"'
$New = '[string]$h.version -ne "0.1.3"'
$OldCount = ([regex]::Matches($Text, [regex]::Escape($Old))).Count
$NewCount = ([regex]::Matches($Text, [regex]::Escape($New))).Count

if ($OldCount -eq 0 -and $NewCount -eq 1) {
    Write-Host "INFO: Runner already accepts Adapter v0.1.3; no content change needed."
}
elseif ($OldCount -eq 1 -and $NewCount -eq 0) {
    $BeforeHash = (Get-FileHash -LiteralPath $Common -Algorithm SHA256).Hash.ToLowerInvariant()
    $Stamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $BackupDir = Join-Path $Root "runner\hotfix-backup\adapter-gate-v0.1.3-$Stamp"
    New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null
    $Backup = Join-Path $BackupDir "common_grok_build_runner.ps1"
    Copy-Item -LiteralPath $Common -Destination $Backup -Force

    $Patched = $Text.Replace($Old, $New)
    if (([regex]::Matches($Patched, [regex]::Escape($Old))).Count -ne 0) {
        throw "Old Adapter version gate remains after replacement."
    }
    if (([regex]::Matches($Patched, [regex]::Escape($New))).Count -ne 1) {
        throw "Patched Adapter version gate count is not exactly one."
    }
    if ($Patched -notmatch '\[string\]\$h\.target_model\s+-ne\s+"deepseek/deepseek-v4-pro"') {
        throw "Target-model safety check was not preserved."
    }

    if ($HadBom) {
        [System.IO.File]::WriteAllText($Common, $Patched, $Utf8Bom)
    } else {
        [System.IO.File]::WriteAllText($Common, $Patched, $Utf8NoBom)
    }

    $AfterHash = (Get-FileHash -LiteralPath $Common -Algorithm SHA256).Hash.ToLowerInvariant()
    $Manifest = [ordered]@{
        installed_at = (Get-Date).ToString("o")
        file = $Common
        backup = $Backup
        before_sha256 = $BeforeHash
        after_sha256 = $AfterHash
        changed = $true
        old_gate = "0.1.2"
        new_gate = "0.1.3"
    }
    $Manifest | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $BackupDir "manifest.json") -Encoding UTF8

    Write-Host "Backup : $Backup"
    Write-Host "Before : $BeforeHash"
    Write-Host "After  : $AfterHash"
}
else {
    throw "Refusing to patch unexpected version-gate state. old_count=$OldCount new_count=$NewCount"
}

# Reload the installed file and test the exact Runner preflight function.
. $Common
$Verified = Assert-GrokSearchAdapter -AdapterUrl $AdapterUrl
if (-not $Verified.ok -or [string]$Verified.version -ne "0.1.3" -or [string]$Verified.target_model -ne "deepseek/deepseek-v4-pro") {
    throw "Patched Runner preflight did not accept the live Adapter."
}

Write-Host ""
Write-Host "PASS: Runner now accepts live Adapter v0.1.3 and preserves the DeepSeek target-model gate." -ForegroundColor Green
Write-Host "Do not run the three-task cleanup script again; proceed directly to resume."
