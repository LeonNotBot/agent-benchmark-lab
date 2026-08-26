param(
    [string]$Root = "C:\pinchbench-grok-build",
    [string]$Python = "C:\pinchbench-opencode\.venv\Scripts\python.exe"
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$global:OutputEncoding = New-Object System.Text.UTF8Encoding($false)

$Source = Split-Path -Parent $MyInvocation.MyCommand.Path
$RequiredFiles = @(
    "run_pinchbench_grok_build_windows.py",
    "selftest_grok_build_runner.py",
    "common_grok_build_runner.ps1",
    "01_preflight_grok_build.ps1",
    "02_run_grok_build_smoke.ps1",
    "03_monitor_pinchbench_grok_build_windows.ps1",
    "04_run_grok_build_full.ps1",
    "05_resume_grok_build_run.ps1",
    "06_bundle_grok_build_run_diagnostic.ps1"
)

foreach ($FileName in $RequiredFiles) {
    $PackageFile = Join-Path $Source $FileName
    if (-not (Test-Path -LiteralPath $PackageFile)) {
        throw "Package file missing: $FileName"
    }
}

$GrokExecutable = Join-Path $Root "bin\grok.exe"
$ExistingGrokHome = Join-Path $Root "grok-home"
$BenchmarkHome = Join-Path $Root "benchmark-home"
$RunnerDirectory = Join-Path $Root "runner"
$RunsDirectory = Join-Path $Root "runs"
$LogsDirectory = Join-Path $Root "logs\grok-build-runner"
$ExistingConfig = Join-Path $ExistingGrokHome "config.toml"

if (-not (Test-Path -LiteralPath $GrokExecutable)) {
    throw "grok.exe not found: $GrokExecutable"
}
if (-not (Test-Path -LiteralPath $ExistingConfig)) {
    throw "Existing Grok config missing: $ExistingConfig"
}
if (-not (Test-Path -LiteralPath $Python)) {
    throw "Python not found: $Python"
}

$VersionOutput = (& $GrokExecutable --version 2>&1 | Out-String).Trim()
if ($LASTEXITCODE -ne 0) {
    throw "grok --version failed with exit code $LASTEXITCODE"
}
if ($VersionOutput -notmatch "0\.2\.118") {
    throw "Expected Grok Build 0.2.118, actual: $VersionOutput"
}

$GrokHash = (Get-FileHash -LiteralPath $GrokExecutable -Algorithm SHA256).Hash.ToLowerInvariant()
$ExpectedGrokHash = "8b365d13ba0956bd8015069a7230370dd11496cd18d03b5eb148a329a8d96f7c"
if ($GrokHash -ne $ExpectedGrokHash) {
    throw "Unexpected grok.exe SHA256: $GrokHash"
}

$ConfigText = Get-Content -LiteralPath $ExistingConfig -Raw -Encoding UTF8
$RequiredConfigLines = @(
    '[models]',
    'default = "deepseek-v4-pro-openrouter"',
    'web_search = "deepseek-v4-pro-openrouter"',
    'model = "deepseek/deepseek-v4-pro"',
    'base_url = "http://127.0.0.1:8767/v1"',
    'env_key = "OPENROUTER_API_KEY"',
    'api_backend = "responses"'
)

foreach ($RequiredLine in $RequiredConfigLines) {
    if (-not $ConfigText.Contains($RequiredLine)) {
        throw "Existing config does not match the validated canary configuration. Missing: $RequiredLine"
    }
}

if ($ConfigText -match '(?im)^\s*(api[_-]?key|token|secret)\s*=') {
    throw "Existing Grok config contains an inline secret; env_key is required."
}

# Destructive operations occur only after every immutable prerequisite passes.
Remove-Item -LiteralPath $RunnerDirectory,$BenchmarkHome -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $RunnerDirectory,$BenchmarkHome,$RunsDirectory,$LogsDirectory | Out-Null

Get-ChildItem -LiteralPath $Source -File |
    Where-Object { $_.Name -ne "00_install_grok_build_runner.ps1" } |
    Copy-Item -Destination $RunnerDirectory -Force

$BenchmarkConfig = Join-Path $BenchmarkHome "config.toml"
Copy-Item -LiteralPath $ExistingConfig -Destination $BenchmarkConfig -Force

@'

# Benchmark isolation: prevent user-level Claude/Cursor compatibility files
# from adding rules, skills, MCP servers, hooks, or foreign sessions.
[compat.cursor]
skills = false
rules = false
agents = false
mcps = false
hooks = false
sessions = false

[compat.claude]
skills = false
rules = false
agents = false
mcps = false
hooks = false
sessions = false

[compat.codex]
sessions = false
'@ | Add-Content -LiteralPath $BenchmarkConfig -Encoding UTF8

& $Python -X utf8 -m py_compile (Join-Path $RunnerDirectory "run_pinchbench_grok_build_windows.py")
if ($LASTEXITCODE -ne 0) {
    throw "Runner py_compile failed with exit code $LASTEXITCODE"
}

& $Python -X utf8 (Join-Path $RunnerDirectory "selftest_grok_build_runner.py")
if ($LASTEXITCODE -ne 0) {
    throw "Runner self-test failed with exit code $LASTEXITCODE"
}

$InstalledHashes = Get-ChildItem -LiteralPath $RunnerDirectory -File |
    Sort-Object Name |
    ForEach-Object {
        "$((Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant())  $($_.Name)"
    }
$InstalledHashes | Set-Content -LiteralPath (Join-Path $RunnerDirectory "SHA256SUMS.txt") -Encoding UTF8

Write-Host "PASS: Grok Build PinchBench runner installed." -ForegroundColor Green
Write-Host "Runner: $RunnerDirectory"
Write-Host "Benchmark GROK_HOME: $BenchmarkHome"
Write-Host "Existing adapter/config were not overwritten."
