param(
    [string]$Root = "C:\pinchbench-gemini",
    [string]$Python = "",
    [string]$SkillDir = "",
    [string]$ProxyUrl = "http://127.0.0.1:10090",
    [string]$JudgeModel = "openrouter/anthropic/claude-opus-5",
    [string]$AdapterUrl = "http://127.0.0.1:8766"
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

. (Join-Path $PSScriptRoot "common_gemini_runner.ps1")

Assert-OpenRouterKey
Set-ProxyEnvironment -ProxyUrl $ProxyUrl

$Paths = Get-GeminiRunnerPaths `
    -Root $Root `
    -Python $Python `
    -SkillDir $SkillDir

$Stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$Stdout = Join-Path $Paths.Logs (
    "preflight-" + $Stamp + ".stdout.txt"
)
$Stderr = Join-Path $Paths.Logs (
    "preflight-" + $Stamp + ".stderr.txt"
)

$Arguments = @(
    "-X", "utf8",
    $Paths.Runner,
    "--skill-dir", $Paths.Skill,
    "--gemini-cli", $Paths.Gemini,
    "--expected-gemini-version", "0.52.0",
    "--gemini-home", $Paths.GeminiHome,
    "--adapter-url", $AdapterUrl,
    "--expected-adapter-version", "1.3.0",
    "--model", "deepseek/deepseek-v4-pro",
    "--approval-mode", "yolo",
    "--suite", "all",
    "--judge-model", $JudgeModel,
    "--timeout-multiplier", "3.0",
    "--network-timeout", "300",
    "--judge-timeout", "300",
    "--results-dir", $Paths.Runs,
    "--preflight"
)

$Process = Start-Process `
    -FilePath $Paths.Python `
    -ArgumentList $Arguments `
    -WorkingDirectory $Root `
    -RedirectStandardOutput $Stdout `
    -RedirectStandardError $Stderr `
    -NoNewWindow `
    -Wait `
    -PassThru

Show-LoggedProcessResult `
    -Process $Process `
    -StdoutPath $Stdout `
    -StderrPath $Stderr `
    -TailLines 240

if ($Process.ExitCode -ne 0) {
    throw "Gemini preflight failed with exit code $($Process.ExitCode)."
}

Write-Host "PASS: Gemini full-suite preflight passed." `
    -ForegroundColor Green
