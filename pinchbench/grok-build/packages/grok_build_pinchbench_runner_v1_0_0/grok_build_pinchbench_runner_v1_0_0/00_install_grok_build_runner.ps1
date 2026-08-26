param([string]$Root="C:\pinchbench-grok-build",[string]$Python="C:\pinchbench-opencode\.venv\Scripts\python.exe")
$ErrorActionPreference="Stop";[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false)
$Source=Split-Path -Parent $MyInvocation.MyCommand.Path
$Required=@("run_pinchbench_grok_build_windows.py","selftest_grok_build_runner.py","common_grok_build_runner.ps1","01_preflight_grok_build.ps1","02_run_grok_build_smoke.ps1","03_monitor_pinchbench_grok_build_windows.ps1","04_run_grok_build_full.ps1","05_resume_grok_build_run.ps1","06_bundle_grok_build_run_diagnostic.ps1")
foreach($f in $Required){if(-not(Test-Path -LiteralPath (Join-Path $Source $f))){throw "Package file missing: $f"}}
$Grok=Join-Path $Root "bin\grok.exe";$ExistingHome=Join-Path $Root "grok-home";$Home=Join-Path $Root "benchmark-home";$Runner=Join-Path $Root "runner"
if(-not(Test-Path $Grok)){throw "grok.exe not found: $Grok"};if(-not(Test-Path (Join-Path $ExistingHome "config.toml"))){throw "Existing Grok config missing."};if(-not(Test-Path $Python)){throw "Python not found: $Python"}
$Version=& $Grok --version;if($Version -notmatch "0\.2\.118"){throw "Expected Grok Build 0.2.118, actual: $Version"}
$Hash=(Get-FileHash $Grok -Algorithm SHA256).Hash.ToLowerInvariant();if($Hash -ne "8b365d13ba0956bd8015069a7230370dd11496cd18d03b5eb148a329a8d96f7c"){throw "Unexpected grok.exe SHA256: $Hash"}
$ExistingConfig=Join-Path $ExistingHome "config.toml"
$ConfigText=Get-Content -LiteralPath $ExistingConfig -Raw -Encoding UTF8
foreach($RequiredLine in @('[models]','default = "deepseek-v4-pro-openrouter"','web_search = "deepseek-v4-pro-openrouter"','model = "deepseek/deepseek-v4-pro"','base_url = "http://127.0.0.1:8767/v1"','env_key = "OPENROUTER_API_KEY"','api_backend = "responses"')){if(-not $ConfigText.Contains($RequiredLine)){throw "Existing config does not match the validated canary configuration. Missing: $RequiredLine"}}
if($ConfigText -match '(?im)^\s*(api[_-]?key|token|secret)\s*='){throw "Existing Grok config contains an inline secret; env_key is required."}
Remove-Item -LiteralPath $Runner,$Home -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $Runner,$Home,(Join-Path $Root "runs"),(Join-Path $Root "logs\grok-build-runner")|Out-Null
Get-ChildItem -LiteralPath $Source -File|Where-Object {$_.Name -ne "00_install_grok_build_runner.ps1"}|Copy-Item -Destination $Runner -Force
Copy-Item -LiteralPath $ExistingConfig -Destination (Join-Path $Home "config.toml") -Force
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
'@ | Add-Content -LiteralPath (Join-Path $Home "config.toml") -Encoding UTF8
& $Python -X utf8 -m py_compile (Join-Path $Runner "run_pinchbench_grok_build_windows.py");if($LASTEXITCODE-ne 0){throw "Runner py_compile failed"}
& $Python -X utf8 (Join-Path $Runner "selftest_grok_build_runner.py");if($LASTEXITCODE-ne 0){throw "Runner self-test failed"}
$Hashes=Get-ChildItem $Runner -File|ForEach-Object{"$((Get-FileHash $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant())  $($_.Name)"};$Hashes|Set-Content (Join-Path $Runner "SHA256SUMS.txt") -Encoding UTF8
Write-Host "PASS: Grok Build PinchBench runner installed." -ForegroundColor Green;Write-Host "Runner: $Runner";Write-Host "Benchmark GROK_HOME: $Home";Write-Host "Existing adapter/config were not overwritten."
