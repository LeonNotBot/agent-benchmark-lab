param(
    [string]$Root = "C:\pinchbench-grok-build",
    [string]$AdapterUrl = "http://127.0.0.1:8767"
)

$ErrorActionPreference = "Stop"
$Common = Join-Path $Root "runner\common_grok_build_runner.ps1"
. $Common
$Health = Assert-GrokSearchAdapter -AdapterUrl $AdapterUrl
$Line = Select-String -LiteralPath $Common -Pattern '\[string\]\$h\.version\s+-ne\s+"0\.1\.3"' | Select-Object -First 1
if (-not $Line) { throw "Runner v0.1.3 gate not found." }
Write-Host "PASS: Runner preflight accepts Adapter v0.1.3."
Write-Host "Gate line: $($Line.LineNumber): $($Line.Line.Trim())"
$Health | ConvertTo-Json -Depth 10
