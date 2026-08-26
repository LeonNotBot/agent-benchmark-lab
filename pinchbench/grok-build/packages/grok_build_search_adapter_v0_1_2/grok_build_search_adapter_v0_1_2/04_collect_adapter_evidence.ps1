param(
    [string]$OutputDirectory = "$HOME\Downloads"
)

$ErrorActionPreference = "Stop"
$Root = "C:\pinchbench-grok-build"
$Stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$Stage = Join-Path $env:TEMP "grok_build_search_adapter_evidence_$Stamp"
$Zip = Join-Path $OutputDirectory "grok_build_search_adapter_evidence_v0_1_1_$Stamp.zip"

Remove-Item -LiteralPath $Stage,$Zip -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $Stage | Out-Null

$Files = @(
    "$Root\grok-home\config.toml",
    "$Root\logs\search-adapter.jsonl",
    "$Root\canary\web-search-adapter\stdout.json",
    "$Root\canary\web-search-adapter\stderr.txt",
    "$Root\canary\web-search-adapter\web_probe.md",
    "$Root\search-adapter\grok_build_search_adapter.py",
    "$Root\search-adapter\01_start_search_adapter.ps1",
    "$Root\search-adapter\02_configure_grok_build_for_adapter.ps1",
    "$Root\search-adapter\03_run_web_search_adapter_canary.ps1",
    "$Root\search-adapter\test_adapter_normalization.py"
)

foreach ($File in $Files) {
    if (Test-Path -LiteralPath $File) {
        Copy-Item -LiteralPath $File -Destination $Stage -Force
    }
}

@"
Created: $(Get-Date -Format o)
Adapter version expected: 0.1.1
Adapter: http://127.0.0.1:8767/v1
Target model: deepseek/deepseek-v4-pro
Proxy: http://127.0.0.1:10090
The package does not intentionally include OPENROUTER_API_KEY.
"@ | Set-Content -LiteralPath (Join-Path $Stage "README.txt") -Encoding UTF8

Compress-Archive -Path (Join-Path $Stage "*") -DestinationPath $Zip -Force
Get-Item -LiteralPath $Zip | Select-Object FullName,Length
