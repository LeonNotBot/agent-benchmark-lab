param(
    [string]$Python = "C:\pinchbench-opencode\.venv\Scripts\python.exe",
    [int]$Port = 8767
)

$ErrorActionPreference = "Stop"
$Root = "C:\pinchbench-grok-build"
$Adapter = "$Root\search-adapter\grok_build_search_adapter.py"

$env:GROK_HOME = "$Root\grok-home"
$env:Path = "$Root\bin;$env:Path"
$env:HTTP_PROXY = "http://127.0.0.1:10090"
$env:HTTPS_PROXY = "http://127.0.0.1:10090"
$env:ALL_PROXY = "http://127.0.0.1:10090"
$env:NO_PROXY = "localhost,127.0.0.1,::1"

if ([string]::IsNullOrWhiteSpace($env:OPENROUTER_API_KEY)) {
    throw "Current window does not contain OPENROUTER_API_KEY."
}
if (-not (Test-Path -LiteralPath $Python)) {
    throw "Python not found: $Python"
}
if (-not (Test-Path -LiteralPath $Adapter)) {
    throw "Adapter not found: $Adapter"
}

New-Item -ItemType Directory -Force -Path "$Root\logs" | Out-Null

& $Python $Adapter `
    --host "127.0.0.1" `
    --port $Port `
    --upstream "https://openrouter.ai/api/v1" `
    --target-model "deepseek/deepseek-v4-pro" `
    --timeout-seconds 900 `
    --log "$Root\logs\search-adapter.jsonl"

exit $LASTEXITCODE
