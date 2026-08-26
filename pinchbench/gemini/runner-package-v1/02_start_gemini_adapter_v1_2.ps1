param(
    [string]$Root = "C:\pinchbench-gemini",
    [string]$Python = "",
    [string]$ProxyUrl = "http://127.0.0.1:10090",
    [int]$Port = 8766,
    [int]$UpstreamTimeoutSeconds = 600,
    [double]$HeartbeatSeconds = 10
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

. (Join-Path $PSScriptRoot "common_gemini_runner.ps1")

Assert-OpenRouterKey
Set-ProxyEnvironment -ProxyUrl $ProxyUrl

$ResolvedPython = Resolve-PythonPath `
    -Root $Root `
    -Python $Python

$Adapter = Join-Path $Root `
    "adapter-v1\gemini_openrouter_adapter.py"
$Logs = Join-Path $Root "logs\adapter-v1_2"

foreach ($Required in @($ResolvedPython, $Adapter)) {
    if (-not (Test-Path -LiteralPath $Required)) {
        throw "Required path not found: $Required"
    }
}

New-Item -ItemType Directory -Force -Path $Logs | Out-Null

$env:OPENROUTER_MODEL = "deepseek/deepseek-v4-pro"
$env:OPENROUTER_RESPONSES_URL = `
    "https://openrouter.ai/api/v1/responses"
$env:OPENROUTER_TIMEOUT_SECONDS = `
    [string]$UpstreamTimeoutSeconds
$env:ADAPTER_HEARTBEAT_SECONDS = `
    [string]$HeartbeatSeconds
$env:GEMINI_OPENROUTER_LOG_DIR = $Logs
$env:ADAPTER_LOG_PAYLOADS = "0"
$env:ADAPTER_PARALLEL_TOOL_CALLS = "1"
$env:ADAPTER_REASONING_MODE = "auto"

Write-Host "Starting Gemini adapter v1.2 in window A..."
Write-Host ("URL: http://127.0.0.1:" + $Port)
Write-Host ("Model: " + $env:OPENROUTER_MODEL)
Write-Host ("Heartbeat: " + $HeartbeatSeconds + " seconds")
Write-Host (
    "Upstream timeout: " +
    $UpstreamTimeoutSeconds +
    " seconds"
)
Write-Host ("Logs: " + $Logs)
Write-Host "Keep this window open. Stop with Ctrl+C."
Write-Host ""

$OldErrorActionPreference = $ErrorActionPreference
$HasNativePreference = Test-Path `
    Variable:\PSNativeCommandUseErrorActionPreference

if ($HasNativePreference) {
    $OldNativePreference = `
        $PSNativeCommandUseErrorActionPreference
}

try {
    $ErrorActionPreference = "Continue"

    if ($HasNativePreference) {
        $PSNativeCommandUseErrorActionPreference = $false
    }

    & $ResolvedPython -X utf8 $Adapter `
        --host 127.0.0.1 `
        --port $Port `
        --model $env:OPENROUTER_MODEL `
        --timeout $UpstreamTimeoutSeconds `
        --heartbeat-seconds $HeartbeatSeconds `
        --log-dir $Logs

    $ExitCode = $LASTEXITCODE
}
finally {
    $ErrorActionPreference = $OldErrorActionPreference

    if ($HasNativePreference) {
        $PSNativeCommandUseErrorActionPreference = `
            $OldNativePreference
    }
}

exit $ExitCode
