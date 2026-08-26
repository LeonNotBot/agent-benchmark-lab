param(
    [string]$Root = "C:\pinchbench-gemini",
    [string]$Python = "C:\pinchbench-opencode\.venv\Scripts\python.exe"
)
$ErrorActionPreference = "Stop"
$Summarizer = Join-Path $PSScriptRoot "summarize_gemini_contract_probe.py"
$Logs = Join-Path $Root "logs"
$Requests = Join-Path $Logs "20_contract_requests.jsonl"
$CustomOut = Join-Path $Logs "21_contract_custom_model.jsonl"
$AliasOut = Join-Path $Logs "22_contract_alias_model.jsonl"
$Summary = Join-Path $Logs "23_contract_summary.json"
foreach ($Path in @($Python,$Summarizer,$Requests)) {
    if (-not (Test-Path -LiteralPath $Path)) { throw "Required path not found: $Path" }
}
& $Python -X utf8 $Summarizer --requests $Requests --custom-output $CustomOut --alias-output $AliasOut --output $Summary
if ($LASTEXITCODE -ne 0) { throw "Contract summary failed." }
Write-Host ""
Write-Host "PASS: contract summary created." -ForegroundColor Green
Write-Host ("Summary: " + $Summary)
