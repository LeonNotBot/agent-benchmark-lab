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
$Logs = Join-Path $Root "logs\adapter-v1_3"

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
$env:ADAPTER_MAX_OUTPUT_TOKENS = "32768"
$env:LANG = "en_US.UTF-8"
$env:LC_ALL = "en_US.UTF-8"
$env:LC_MESSAGES = "en_US.UTF-8"
$env:LANGUAGE = "en_US:en"
$env:ADAPTER_WEB_SEARCH_ENGINE = "exa"
$env:ADAPTER_WEB_SEARCH_MAX_RESULTS = "5"
$env:ADAPTER_WEB_SEARCH_MAX_USES = "1"
$env:ADAPTER_WEB_SEARCH_MAX_TOTAL_RESULTS = "5"
$env:ADAPTER_WEB_SEARCH_CONTEXT_SIZE = "low"
$env:ADAPTER_WEB_SEARCH_MAX_CHARACTERS = "3000"

Write-Host "Starting Gemini adapter v1.3 in window A..."
Write-Host ("URL: http://127.0.0.1:" + $Port)
Write-Host ("Model: " + $env:OPENROUTER_MODEL)
Write-Host ("Heartbeat: " + $HeartbeatSeconds + " seconds")
Write-Host (
    "Upstream timeout: " +
    $UpstreamTimeoutSeconds +
    " seconds"
)
Write-Host ("Max output tokens: " + $env:ADAPTER_MAX_OUTPUT_TOKENS)
Write-Host ("Web search bridge: OpenRouter " + $env:ADAPTER_WEB_SEARCH_ENGINE)
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
