param(
    [string]$Root = "C:\pinchbench-gemini",
    [string]$Python = "C:\pinchbench-opencode\.venv\Scripts\python.exe",
    [int]$Port = 8766,
    [int]$UpstreamTimeoutSeconds = 600,
    [double]$HeartbeatSeconds = 10
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

$Adapter = Join-Path $PSScriptRoot "gemini_openrouter_adapter.py"
$Logs = Join-Path $Root "logs\adapter-v1_2"

foreach ($Required in @($Python, $Adapter)) {
    if (-not (Test-Path -LiteralPath $Required)) {
        throw "Required path not found: $Required"
    }
}

if ([string]::IsNullOrWhiteSpace($env:OPENROUTER_API_KEY)) {
    throw "OPENROUTER_API_KEY is missing in window A."
}

New-Item -ItemType Directory -Force -Path $Logs | Out-Null

$env:OPENROUTER_MODEL = "deepseek/deepseek-v4-pro"
$env:OPENROUTER_RESPONSES_URL = `
    "https://openrouter.ai/api/v1/responses"
$env:OPENROUTER_TIMEOUT_SECONDS = [string]$UpstreamTimeoutSeconds
$env:ADAPTER_HEARTBEAT_SECONDS = [string]$HeartbeatSeconds
$env:GEMINI_OPENROUTER_LOG_DIR = $Logs
$env:ADAPTER_LOG_PAYLOADS = "0"
$env:ADAPTER_PARALLEL_TOOL_CALLS = "1"
$env:ADAPTER_REASONING_MODE = "auto"
$env:NO_PROXY = "localhost,127.0.0.1,::1"
$env:no_proxy = "localhost,127.0.0.1,::1"

Write-Host "Starting Gemini to OpenRouter adapter v1.2..."
Write-Host ("Local URL: http://127.0.0.1:" + $Port)
Write-Host ("Heartbeat: " + $HeartbeatSeconds + " seconds")
Write-Host ("Upstream hard timeout: " + $UpstreamTimeoutSeconds + " seconds")
Write-Host ("Logs: " + $Logs)
Write-Host "Keep this window open. Stop with Ctrl+C."
Write-Host ""

$OldErrorActionPreference = $ErrorActionPreference
$HasNativePreference = Test-Path `
    Variable:\PSNativeCommandUseErrorActionPreference

if ($HasNativePreference) {
    $OldNativePreference = $PSNativeCommandUseErrorActionPreference
}

try {
    $ErrorActionPreference = "Continue"
    if ($HasNativePreference) {
        $PSNativeCommandUseErrorActionPreference = $false
    }

    & $Python -X utf8 $Adapter `
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
        $PSNativeCommandUseErrorActionPreference = $OldNativePreference
    }
}

exit $ExitCode
