param(
    [string]$RunDir = "C:\pinchbench-opencode-kimi\runs\opencode_kimi_k3_20260810_180834"
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

$rg = Get-ChildItem -LiteralPath $RunDir -Directory -Filter "regrade_opus5_problems_v2_*" |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1

if ($null -eq $rg) { throw "No regrade_opus5_problems_v2_* directory found under $RunDir" }

$srcJson = Join-Path $rg.FullName "results.regraded.json"
$srcCsv  = Join-Path $rg.FullName "results.regraded.csv"
$srcXlsx = Join-Path $rg.FullName "results.regraded.xlsx"
$srcCmp  = Join-Path $rg.FullName "regrade_comparison.csv"
$srcCfg  = Join-Path $rg.FullName "regrade_config.json"

foreach ($p in @($srcJson,$srcCsv,$srcXlsx,$srcCmp,$srcCfg)) {
    if (-not (Test-Path -LiteralPath $p)) { throw "Missing regrade output: $p" }
}

# Preserve the original formal-run files. Publish corrected copies next to them.
Copy-Item -LiteralPath $srcJson -Destination (Join-Path $RunDir "results.corrected.json") -Force
Copy-Item -LiteralPath $srcCsv  -Destination (Join-Path $RunDir "results.corrected.csv") -Force
Copy-Item -LiteralPath $srcXlsx -Destination (Join-Path $RunDir "results.corrected.xlsx") -Force
Copy-Item -LiteralPath $srcCmp  -Destination (Join-Path $RunDir "regrade_comparison.corrected.csv") -Force
Copy-Item -LiteralPath $srcCfg  -Destination (Join-Path $RunDir "regrade_config.corrected.json") -Force

$manifest = [ordered]@{
    published_at = (Get-Date).ToString("o")
    source_formal_run = $RunDir
    source_regrade_dir = $rg.FullName
    policy = "Original formal-run files preserved; only the 8 grading-failure/problem scores were replaced using frozen Agent outputs and Claude Opus 5 v2 regrade."
    original_results_json = (Join-Path $RunDir "results.json")
    corrected_results_json = (Join-Path $RunDir "results.corrected.json")
    corrected_results_csv = (Join-Path $RunDir "results.corrected.csv")
    corrected_results_xlsx = (Join-Path $RunDir "results.corrected.xlsx")
}
$manifest | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $RunDir "corrected_results_manifest.json") -Encoding UTF8

Write-Host ""
Write-Host "CORRECTED RESULTS PUBLISHED" -ForegroundColor Green
Write-Host ("Source regrade : " + $rg.FullName)
Write-Host ("JSON           : " + (Join-Path $RunDir "results.corrected.json"))
Write-Host ("CSV            : " + (Join-Path $RunDir "results.corrected.csv"))
Write-Host ("XLSX           : " + (Join-Path $RunDir "results.corrected.xlsx"))
Write-Host "Original results.json/results.csv/results.xlsx were NOT overwritten." -ForegroundColor Yellow
