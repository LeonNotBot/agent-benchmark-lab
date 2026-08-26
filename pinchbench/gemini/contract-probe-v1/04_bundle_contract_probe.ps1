param([string]$Root = "C:\pinchbench-gemini")
$ErrorActionPreference = "Stop"
$Logs = Join-Path $Root "logs"
$Stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$Zip = Join-Path ([Environment]::GetFolderPath("Desktop")) ("gemini-cli-contract-probe-" + $Stamp + ".zip")
$Names = @("01_gemini_version.txt","01_gemini_help.txt","01_gemini_help_after_install.txt","02_source_revision.txt","03_env_presence.json","08_openrouter_preflight.json","20_contract_requests.jsonl","21_contract_custom_model.jsonl","21_contract_custom_model.stderr.txt","22_contract_alias_model.jsonl","22_contract_alias_model.stderr.txt","23_contract_summary.json")
$Present = @()
foreach ($Name in $Names) { $Path = Join-Path $Logs $Name; if (Test-Path -LiteralPath $Path) { $Present += $Path } }
if ($Present.Count -lt 4) { throw "Too few probe files were found." }
Compress-Archive -LiteralPath $Present -DestinationPath $Zip -CompressionLevel Optimal -Force
Write-Host "CONTRACT BUNDLE READY" -ForegroundColor Green
Write-Host $Zip
Get-FileHash -LiteralPath $Zip -Algorithm SHA256
