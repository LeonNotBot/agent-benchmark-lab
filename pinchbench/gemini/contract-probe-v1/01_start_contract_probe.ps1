param(
    [string]$Root = "C:\pinchbench-gemini",
    [string]$Python = "C:\pinchbench-opencode\.venv\Scripts\python.exe",
    [int]$Port = 8765
)
$ErrorActionPreference = "Stop"
$Server = Join-Path $PSScriptRoot "gemini_contract_probe_server.py"
$Log = Join-Path $Root "logs\20_contract_requests.jsonl"
foreach ($Path in @($Python, $Server)) {
    if (-not (Test-Path -LiteralPath $Path)) { throw "Required path not found: $Path" }
}
New-Item -ItemType Directory -Force -Path (Split-Path $Log) | Out-Null
Remove-Item -LiteralPath $Log -Force -ErrorAction SilentlyContinue
Write-Host "Starting local Gemini API contract recorder..."
Write-Host "Keep this window open during the probe."
Write-Host ("Log: " + $Log)
& $Python -X utf8 $Server --host 127.0.0.1 --port $Port --log $Log
exit $LASTEXITCODE
