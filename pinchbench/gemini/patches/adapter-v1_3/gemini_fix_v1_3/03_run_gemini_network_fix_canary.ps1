param(
    [string]$Root = "C:\pinchbench-gemini",
    [string]$SkillDir = "C:\pinchbench-codex\skill",
    [string]$JudgeModel = "openrouter/anthropic/claude-opus-5",
    [string]$ProxyUrl = "http://127.0.0.1:10090"
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

$Common = Join-Path $Root "runner\common_gemini_runner.ps1"
if (-not (Test-Path -LiteralPath $Common)) { throw "Missing: $Common" }
. $Common

Assert-OpenRouterKey
Set-ProxyEnvironment -ProxyUrl $ProxyUrl

$Python = Resolve-PythonPath -Root $Root -Python ""
$Runner = Join-Path $Root "runner\run_pinchbench_gemini_windows.py"
$Gemini = Join-Path $Root "cli\node_modules\.bin\gemini.cmd"
$GeminiHome = Join-Path $Root "gemini-home"
$CanaryRuns = Join-Path $Root "canary-runs\adapter-v1_3"
$AdapterLog = Join-Path $Root "logs\adapter-v1_3\adapter_requests.jsonl"

$Health = Invoke-RestMethod -Method Get -Uri "http://127.0.0.1:8766/healthz" -TimeoutSec 5
if (-not $Health.ok) { throw "Adapter health check failed." }
if ([string]$Health.version -ne "1.3.0") { throw "Expected adapter 1.3.0, got $($Health.version)" }
if (-not $Health.nativeWebSearchBridge) { throw "Native web-search bridge is not enabled." }
if ([int]$Health.maxOutputTokens -lt 32768) { throw "Adapter maxOutputTokens is too low: $($Health.maxOutputTokens)" }

New-Item -ItemType Directory -Path $CanaryRuns -Force | Out-Null
$Started = [DateTimeOffset]::UtcNow

& $Python -X utf8 $Runner `
    --skill-dir $SkillDir `
    --suite "task_stock,task_events,task_deep_research" `
    --gemini-cli $Gemini `
    --gemini-home $GeminiHome `
    --adapter-url "http://127.0.0.1:8766" `
    --expected-adapter-version "1.3.0" `
    --model "deepseek/deepseek-v4-pro" `
    --approval-mode "yolo" `
    --network-timeout 300 `
    --judge-timeout 300 `
    --judge-model $JudgeModel `
    --results-dir $CanaryRuns `
    --keep-workspaces `
    --verbose

$RunnerExit = $LASTEXITCODE
$Run = Get-ChildItem -LiteralPath $CanaryRuns -Directory | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if ($null -eq $Run) { throw "Canary run directory was not created." }

$ResultPath = Join-Path $Run.FullName "results.json"
if (-not (Test-Path -LiteralPath $ResultPath)) { $ResultPath = Join-Path $Run.FullName "results.partial.json" }
$Doc = Get-Content -LiteralPath $ResultPath -Raw -Encoding UTF8 | ConvertFrom-Json
$Rows = if ($null -ne $Doc.results) { @($Doc.results) } else { @($Doc) }

$Stock = $Rows | Where-Object { $_.task_id -eq "task_stock" } | Select-Object -First 1
$Events = $Rows | Where-Object { $_.task_id -eq "task_events" } | Select-Object -First 1
$Deep = $Rows | Where-Object { $_.task_id -eq "task_deep_research" } | Select-Object -First 1
$DeepFile = Join-Path $Run.FullName "workspaces\task_deep_research\wasm_research.md"

$BridgeRequests = 0
$Malformed = 0
$UpstreamErrors = 0
if (Test-Path -LiteralPath $AdapterLog) {
    foreach ($Line in Get-Content -LiteralPath $AdapterLog -Encoding UTF8) {
        try { $Record = $Line | ConvertFrom-Json } catch { continue }
        try { $When = [DateTimeOffset]::Parse([string]$Record.timestamp) } catch { continue }
        if ($When -lt $Started) { continue }
        if (@($Record.tool_names) -contains "openrouter:web_search") { $BridgeRequests++ }
        if ([string]$Record.phase -eq "malformed_tool_arguments") { $Malformed++ }
        if ([string]$Record.phase -in @("upstream_http", "upstream_connect", "stream_parse")) { $UpstreamErrors++ }
    }
}

Write-Host ""
Write-Host "===== ADAPTER V1.3 CANARY GATE ====="
Write-Host ("Run: " + $Run.FullName)
Write-Host ("task_stock: " + $Stock.status + " score=" + $Stock.score)
Write-Host ("task_events: " + $Events.status + " score=" + $Events.score)
Write-Host ("task_deep_research: " + $Deep.status + " score=" + $Deep.score)
Write-Host ("wasm_research.md: " + (Test-Path -LiteralPath $DeepFile))
Write-Host ("OpenRouter web-search bridge requests: " + $BridgeRequests)
Write-Host ("Malformed tool argument events: " + $Malformed)
Write-Host ("Adapter upstream error events: " + $UpstreamErrors)

$GatePass = ($RunnerExit -eq 0) -and ($null -ne $Stock) -and ($Stock.status -eq "success") -and (Test-Path -LiteralPath $DeepFile) -and ((Get-Item -LiteralPath $DeepFile).Length -gt 0) -and ($BridgeRequests -gt 0) -and ($Malformed -eq 0) -and ($UpstreamErrors -eq 0)

if ($GatePass) {
    Write-Host "PASS: Adapter v1.3 infrastructure canary passed."
    if ($Events.status -ne "success") { Write-Host "WARN: task_events still failed; treat it as Agent behavior only after reviewing its transcript." }
    exit 0
}

Write-Host "FAIL: Adapter v1.3 infrastructure canary did not pass. Do not start the 143-task run."
exit 1
