$ErrorActionPreference="Stop"
$Here=Split-Path -Parent $MyInvocation.MyCommand.Path
Write-Host "[preflight] PowerShell parser check..."
$Bad=$false
Get-ChildItem -LiteralPath $Here -Filter "*.ps1" -File|ForEach-Object{
  $Tokens=$null;$Errors=$null
  [System.Management.Automation.Language.Parser]::ParseFile($_.FullName,[ref]$Tokens,[ref]$Errors)|Out-Null
  if($Errors.Count){
    $Bad=$true
    Write-Host "  FAIL $($_.Name)"
    $Errors|ForEach-Object{Write-Host "    $($_.Message)"}
  }else{Write-Host "  OK $($_.Name)"}
}
if($Bad){exit 2}

$Python="C:\pinchbench-our-framework\.venv\Scripts\python.exe"
if(!(Test-Path $Python)){throw "Python missing: $Python"}
Write-Host "[preflight] Python compile check..."
foreach($F in @("classify_replacement_attempt.py","merge_replacements_and_recount_tokens.py","test_classifier.py")){
  $P=Join-Path $Here $F
  & $Python -m py_compile $P
  if($LASTEXITCODE -ne 0){throw "py_compile failed: $F"}
  Write-Host "  OK $F"
}
Write-Host "[preflight] Classifier regression tests..."
& $Python (Join-Path $Here "test_classifier.py")
if($LASTEXITCODE -ne 0){throw "Classifier tests failed."}

# Contract checks that prevent a repeat of R8's double-retry ambiguity.
$Controller=Get-Content -LiteralPath (Join-Path $Here "run_v5d_replacements_final.ps1") -Raw -Encoding UTF8
if($Controller -notmatch '"--infra-retries","0"'){throw "Controller contract failed: original runner must be invoked with --infra-retries 0"}
if($Controller -match '"--infra-retries","[1-9]'){throw "Controller contract failed: nested infra retry detected"}
if($Controller -notmatch '\$MaxAttempts=\$MaxInfraRetries\+1'){throw "Controller contract failed: retry budget must be retries+initial attempt"}
Write-Host "[preflight] Retry-layer contract..."
Write-Host "  OK one Python process = one benchmark attempt"
Write-Host "  OK original runner internal infra retries disabled"
Write-Host "  OK max attempts = 1 + MaxInfraRetries"
Write-Host "BUNDLE_PREFLIGHT_OK"
