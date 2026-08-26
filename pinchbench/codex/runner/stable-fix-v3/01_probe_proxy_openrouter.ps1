param(
    [string]$Root = "C:\pinchbench-codex",
    [string]$Python = "C:\pinchbench-opencode\.venv\Scripts\python.exe",
    [string]$ProxyUrl = "http://127.0.0.1:10090",
    [int]$ShortAttempts = 5,
    [int]$LongAttempts = 2,
    [switch]$TestDirect
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

$Probe = Join-Path $PSScriptRoot "probe_openrouter_responses.py"
$Logs = "$Root\logs"

foreach ($RequiredPath in @($Python, $Probe)) {
    if (-not (Test-Path -LiteralPath $RequiredPath)) {
        throw "找不到必要路径：$RequiredPath"
    }
}

if ([string]::IsNullOrWhiteSpace($env:OPENROUTER_API_KEY)) {
    throw "当前 PowerShell 没有 OPENROUTER_API_KEY。"
}

New-Item -ItemType Directory -Path $Logs -Force | Out-Null
$Stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$ProxyOutput = "$Logs\openrouter-responses-proxy-$Stamp.json"

Write-Host "先测试显式代理 Responses SSE。" -ForegroundColor Cyan

& $Python -X utf8 $Probe `
    --mode proxy `
    --proxy $ProxyUrl `
    --short-attempts $ShortAttempts `
    --long-attempts $LongAttempts `
    --output $ProxyOutput

$ProxyExit = $LASTEXITCODE

if ($TestDirect) {
    $DirectOutput = "$Logs\openrouter-responses-direct-$Stamp.json"

    Write-Host ""
    Write-Host "再测试完全不使用环境代理的直连。" -ForegroundColor Cyan

    & $Python -X utf8 $Probe `
        --mode direct `
        --short-attempts $ShortAttempts `
        --long-attempts $LongAttempts `
        --output $DirectOutput

    $DirectExit = $LASTEXITCODE

    Write-Host ""
    Write-Host "代理结果：$ProxyOutput"
    Write-Host "直连结果：$DirectOutput"

    if ($ProxyExit -ne 0 -and $DirectExit -eq 0) {
        throw "代理流失败而直连成功：本地代理或代理线路有问题。"
    }

    if ($ProxyExit -ne 0 -and $DirectExit -ne 0) {
        throw "代理和直连都失败：不能启动正式 benchmark。"
    }

    if ($ProxyExit -eq 0 -and $DirectExit -ne 0) {
        Write-Host "直连失败但代理通过：当前网络需要代理，代理链路正常。" `
            -ForegroundColor Yellow
    }
}
else {
    Write-Host ""
    Write-Host "代理结果：$ProxyOutput"

    if ($ProxyExit -ne 0) {
        throw "代理 Responses SSE 测试失败。可加 -TestDirect 做对照。"
    }
}

Write-Host ""
Write-Host "PASS：代理/OpenRouter Responses SSE 基线通过。" `
    -ForegroundColor Green
