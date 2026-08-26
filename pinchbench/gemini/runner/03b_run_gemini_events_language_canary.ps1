param(
    [string]$Root = "C:\pinchbench-gemini",
    [string]$SkillDir = "C:\pinchbench-codex\skill",
    [string]$JudgeModel = "openrouter/anthropic/claude-opus-5",
    [string]$ProxyUrl = "http://127.0.0.1:10090"
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

$Common = Join-Path $Root "runner\common_gemini_runner.ps1"
if (-not (Test-Path -LiteralPath $Common)) {
    throw "Missing current common runner file: $Common"
}
. $Common

Assert-OpenRouterKey
Set-ProxyEnvironment -ProxyUrl $ProxyUrl

$Python = Resolve-PythonPath -Root $Root -Python ""
$Runner = Join-Path $Root "runner\run_pinchbench_gemini_windows.py"
$Gemini = Join-Path $Root "cli\node_modules\.bin\gemini.cmd"
$GeminiHome = Join-Path $Root "gemini-home"
$Runs = Join-Path $Root "canary-runs\events-language-v1_3"

foreach ($Required in @($Python, $Runner, $Gemini, $GeminiHome, $SkillDir)) {
    if (-not (Test-Path -LiteralPath $Required)) {
        throw "Required path not found: $Required"
    }
}

$Health = Invoke-RestMethod `
    -Method Get `
    -Uri "http://127.0.0.1:8766/healthz" `
    -TimeoutSec 5

if (-not $Health.ok) {
    throw "Adapter health check failed."
}
if ([string]$Health.version -ne "1.3.0") {
    throw "Expected adapter 1.3.0, got $($Health.version)"
}

New-Item -ItemType Directory -Path $Runs -Force | Out-Null

& $Python -X utf8 $Runner `
    --skill-dir $SkillDir `
    --suite "task_events" `
    --gemini-cli $Gemini `
    --gemini-home $GeminiHome `
    --adapter-url "http://127.0.0.1:8766" `
    --expected-adapter-version "1.3.0" `
    --model "deepseek/deepseek-v4-pro" `
    --approval-mode "yolo" `
    --network-timeout 300 `
    --judge-timeout 300 `
    --judge-model $JudgeModel `
    --results-dir $Runs `
    --keep-workspaces `
    --verbose

$RunnerExit = $LASTEXITCODE
$Run = Get-ChildItem -LiteralPath $Runs -Directory |
    Where-Object { $_.Name -like "gemini_*" } |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1

if ($null -eq $Run) {
    throw "Language canary run directory was not created."
}

$ResultPath = Join-Path $Run.FullName "results.json"
if (-not (Test-Path -LiteralPath $ResultPath)) {
    $ResultPath = Join-Path $Run.FullName "results.partial.json"
}
if (-not (Test-Path -LiteralPath $ResultPath)) {
    throw "No results file was created in $($Run.FullName)"
}

$Doc = Get-Content -LiteralPath $ResultPath -Raw -Encoding UTF8 |
    ConvertFrom-Json
$Rows = if ($null -ne $Doc.results) { @($Doc.results) } else { @($Doc) }
$Row = $Rows |
    Where-Object { $_.task_id -eq "task_events" } |
    Select-Object -First 1

if ($null -eq $Row) {
    throw "task_events result was not found in $ResultPath"
}

$Output = [string]$Row.output
$JapaneseKanaDetected = [regex]::IsMatch(
    $Output,
    "[\u3040-\u30ff]"
)

$EventsFile = Join-Path `
    $Run.FullName `
    "workspaces\task_events\events.md"

Write-Host ""
Write-Host "===== EXACT EVENTS LANGUAGE CANARY ====="
Write-Host ("Run: " + $Run.FullName)
Write-Host ("Runner exit: " + $RunnerExit)
Write-Host ("Status: " + [string]$Row.status)
Write-Host ("Score: " + [string]$Row.score)
Write-Host ("events.md exists: " + (Test-Path -LiteralPath $EventsFile))
Write-Host ("Japanese kana in final response: " + $JapaneseKanaDetected)

if (
    ($RunnerExit -eq 0) -and
    ([string]$Row.status -eq "success") -and
    (Test-Path -LiteralPath $EventsFile) -and
    (-not $JapaneseKanaDetected)
) {
    Write-Host "PASS: task_events completed and the final response did not use Japanese kana."
    exit 0
}

if (
    ([string]$Row.status -eq "success") -and
    $JapaneseKanaDetected
) {
    Write-Host "FAIL_LANGUAGE: task completed, but the final response used Japanese."
    Write-Host "Do not change the benchmark prompt. Preserve this run and compare after changing only the proxy exit node."
    exit 2
}

Write-Host "FAIL_EXECUTION: task_events did not complete successfully."
exit 1
