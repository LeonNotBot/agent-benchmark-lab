param(
    [string]$Root = "C:\pinchbench-codex",
    [string]$Python = "C:\pinchbench-opencode\.venv\Scripts\python.exe",
    [string]$ProxyUrl = "http://127.0.0.1:10090"
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

$Runner = "$Root\runner\run_pinchbench_codex_windows.py"
$Skill = "$Root\skill"
$Codex = "$Root\codex-cli\node_modules\.bin\codex.cmd"
$CodexHome = "$Root\codex-home"
$Model = "deepseek/deepseek-v4-pro"
$Suite = "task_todo_list_cleanup,task_cron_organizer"

$env:CODEX_HOME = $CodexHome
$env:PYTHONUTF8 = "1"
$env:PYTHONIOENCODING = "utf-8"
$env:NO_COLOR = "1"
$env:FORCE_COLOR = "0"

if (-not [string]::IsNullOrWhiteSpace($ProxyUrl)) {
    $env:HTTP_PROXY = $ProxyUrl
    $env:HTTPS_PROXY = $ProxyUrl
    $env:ALL_PROXY = $ProxyUrl
    $env:NO_PROXY = "localhost,127.0.0.1,::1"
}

foreach ($Path in @(
    $Python,
    $Runner,
    $Skill,
    $Codex,
    "$CodexHome\config.toml"
)) {
    if (-not (Test-Path -LiteralPath $Path)) {
        throw "找不到必要路径：$Path"
    }
}

if (
    [string]::IsNullOrWhiteSpace($env:OPENROUTER_API_KEY) -or
    $env:OPENROUTER_API_KEY -match "你的|真实Key|OpenRouter Key"
) {
    throw "当前 PowerShell 没有设置真实的 OPENROUTER_API_KEY。"
}

$Revision = & $Python -c @"
import importlib.util, pathlib
p = pathlib.Path(r'$Runner')
text = p.read_text(encoding='utf-8')
for line in text.splitlines():
    if line.startswith('RUNNER_REVISION = '):
        print(line.split('=', 1)[1].strip().strip('"'))
        break
"@

Write-Host "Runner revision      : $Revision"
Write-Host "Python               : $Python"
Write-Host "Validation suite     : $Suite"
Write-Host "Expected behavior    : encoding_normalized_count > 0 for BOM/UTF-16 outputs"
Write-Host ""

if ($Revision -notmatch "v1\.1-encoding-normalization") {
    throw "当前 runner 不是编码修复版 v1.1。"
}

Set-Location $Root

& $Python -X utf8 $Runner `
    --skill-dir $Skill `
    --codex $Codex `
    --expected-codex-version "0.145.0" `
    --model $Model `
    --approval-policy never `
    --sandbox-mode workspace-write `
    --windows-sandbox unelevated `
    --suite $Suite `
    --timeout-multiplier 3.0 `
    --network-timeout 300 `
    --judge-timeout 300 `
    --results-dir "$Root\runs" `
    --keep-workspaces `
    --verbose

$ExitCode = $LASTEXITCODE
if ($ExitCode -ne 0) {
    throw "编码修复验证运行失败，退出码：$ExitCode"
}

$LatestRun = Get-ChildItem -LiteralPath "$Root\runs" -Directory |
    Where-Object { $_.Name -like "codex_*" } |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1

if ($null -eq $LatestRun) {
    throw "找不到最新 Codex 结果目录。"
}

$ResultsPath = Join-Path $LatestRun.FullName "results.json"
$Document = Get-Content -LiteralPath $ResultsPath -Raw -Encoding UTF8 |
    ConvertFrom-Json
$Rows = @($Document.results)

Write-Host ""
Write-Host "验证结果：" -ForegroundColor Cyan
$Rows |
    Select-Object `
        task_id,
        score,
        status,
        success,
        encoding_normalized_count,
        encoding_normalized_files,
        encoding_normalization_errors |
    Format-List

$Bad = @(
    $Rows | Where-Object {
        $_.success -ne $true -or
        $null -eq $_.score -or
        [double]$_.score -lt 0.80 -or
        @($_.encoding_normalization_errors).Count -gt 0
    }
)

if ($Bad.Count -gt 0) {
    throw "编码修复验证未通过。请保留结果目录并上传日志。"
}

Write-Host "编码修复验证通过，可以重新开始全量测试。" -ForegroundColor Green
Write-Host "结果目录：$($LatestRun.FullName)"
