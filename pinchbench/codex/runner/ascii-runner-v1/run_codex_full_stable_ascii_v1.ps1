param(
    [string]$Root = "C:\pinchbench-codex",
    [string]$Python = "C:\pinchbench-opencode\.venv\Scripts\python.exe",
    [string]$ProxyUrl = "http://127.0.0.1:10090"
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

$Runner = Join-Path $Root "runner\run_pinchbench_codex_windows.py"
$Codex = Join-Path $Root "codex-cli\node_modules\.bin\codex.cmd"
$Skill = Join-Path $Root "skill"
$Runs = Join-Path $Root "runs"
$Logs = Join-Path $Root "logs"
$Config = Join-Path $Root "codex-home\config.toml"
$Catalog = Join-Path $Root "codex-home\models.deepseek-v4-pro.json"
$Probe = Join-Path $Root "runner\stable-fix-v3\probe_openrouter_responses.py"

$RequiredPaths = @(
    $Python,
    $Runner,
    $Codex,
    $Skill,
    $Config,
    $Catalog,
    $Probe
)

foreach ($RequiredPath in $RequiredPaths) {
    if (-not (Test-Path -LiteralPath $RequiredPath)) {
        throw "Required path not found: $RequiredPath"
    }
}

if ([string]::IsNullOrWhiteSpace($env:OPENROUTER_API_KEY)) {
    throw "OPENROUTER_API_KEY is not set in this PowerShell session."
}

$ConfigText = [System.IO.File]::ReadAllText($Config)
if ($ConfigText -notmatch "PINCHBENCH_WINDOWS_LONG_WRITE_GUARD_V2") {
    throw "Guard V2 was not found in config.toml."
}

$RunnerText = [System.IO.File]::ReadAllText($Runner)
if ($RunnerText -notmatch "maybe_recover_post_completion_stream_disconnect") {
    throw "Post-completion transport recovery patch was not found in the runner."
}
if ($RunnerText -notmatch "strict-roundtrip BOM-less Windows ANSI/CP936/GB18030") {
    throw "Encoding fix v3.2 was not found in the runner."
}

$ProbeText = [System.IO.File]::ReadAllText($Probe)
if ($ProbeText -match "(?m)^\s*import requests\s*$") {
    throw "The old requests-based proxy probe is still installed."
}

$CatalogText = [System.IO.File]::ReadAllText($Catalog)
$CatalogDoc = $CatalogText | ConvertFrom-Json
$Model = @($CatalogDoc.models) |
    Where-Object { $_.slug -eq "deepseek/deepseek-v4-pro" } |
    Select-Object -First 1

if ($null -eq $Model) {
    throw "DeepSeek V4 Pro was not found in the model catalog."
}
if ($null -ne $Model.apply_patch_tool_type) {
    throw "apply_patch_tool_type must be null."
}
if ([int64]$Model.context_window -ne 1048576) {
    throw "Unexpected context_window."
}
if ([int64]$Model.auto_compact_token_limit -ne 943718) {
    throw "Unexpected auto_compact_token_limit."
}

& $Python -X utf8 -m py_compile $Runner
if ($LASTEXITCODE -ne 0) {
    throw "The Python runner failed syntax validation."
}

$env:CODEX_HOME = Join-Path $Root "codex-home"
$env:PYTHONUTF8 = "1"
$env:PYTHONIOENCODING = "utf-8"
$env:NO_COLOR = "1"
$env:FORCE_COLOR = "0"
$env:HTTP_PROXY = $ProxyUrl
$env:HTTPS_PROXY = $ProxyUrl
$env:ALL_PROXY = $ProxyUrl
$env:NO_PROXY = "localhost,127.0.0.1,::1"

New-Item -ItemType Directory -Path $Runs -Force | Out-Null
New-Item -ItemType Directory -Path $Logs -Force | Out-Null

$Stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$Preflight = Join-Path $Logs "openrouter-responses-full-preflight-$Stamp.json"

Write-Host "Running OpenRouter proxy preflight..." -ForegroundColor Cyan

& $Python -X utf8 $Probe `
    --mode proxy `
    --proxy $ProxyUrl `
    --short-attempts 2 `
    --long-attempts 0 `
    --output $Preflight

if ($LASTEXITCODE -ne 0) {
    throw "OpenRouter proxy preflight failed."
}

$FullLog = Join-Path $Logs "codex-full-stable-ascii-v1-$Stamp.txt"
$RunnerExitCode = 1

Write-Host ""
Write-Host "Starting the 143-task full run..." -ForegroundColor Cyan
Write-Host "Console log: $FullLog"

Set-Location $Root
Start-Transcript -Path $FullLog -Force

try {
    & $Python -X utf8 $Runner `
        --skill-dir $Skill `
        --codex $Codex `
        --expected-codex-version "0.145.0" `
        --model "deepseek/deepseek-v4-pro" `
        --approval-policy never `
        --sandbox-mode workspace-write `
        --windows-sandbox unelevated `
        --suite all `
        --timeout-multiplier 3.0 `
        --network-timeout 300 `
        --judge-timeout 300 `
        --results-dir $Runs `
        --keep-workspaces `
        --clear-judge-cache `
        --verbose

    $RunnerExitCode = $LASTEXITCODE
}
finally {
    Stop-Transcript
}

$LatestRun = Get-ChildItem -LiteralPath $Runs -Directory |
    Where-Object { $_.Name -like "codex_*" } |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1

if ($null -ne $LatestRun) {
    $Snapshot = Join-Path $LatestRun.FullName "environment_snapshot"
    New-Item -ItemType Directory -Path $Snapshot -Force | Out-Null

    Copy-Item -LiteralPath $Config `
        -Destination (Join-Path $Snapshot "config.toml") -Force
    Copy-Item -LiteralPath $Catalog `
        -Destination (Join-Path $Snapshot "models.deepseek-v4-pro.json") -Force
    Copy-Item -LiteralPath $Runner `
        -Destination (Join-Path $Snapshot "run_pinchbench_codex_windows.py") -Force
    Copy-Item -LiteralPath $Probe `
        -Destination (Join-Path $Snapshot "probe_openrouter_responses.py") -Force
    Copy-Item -LiteralPath $Preflight `
        -Destination (Join-Path $Snapshot "openrouter-preflight.json") -Force

    Write-Host "Latest run: $($LatestRun.FullName)"
}

Write-Host "Runner exit code: $RunnerExitCode"
Write-Host "Console log: $FullLog"
exit $RunnerExitCode
