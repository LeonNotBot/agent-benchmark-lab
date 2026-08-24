param(
  [string]$Root = "C:\pinchbench-our-framework",
  [string]$ResultsRoot = "C:\pbv5d",
  [int]$MaxInfraRetries = 3
)
$ErrorActionPreference="Stop"
$Here=Split-Path -Parent $MyInvocation.MyCommand.Path
$Verify=Join-Path $Here "verify_v5d_bundle.ps1"
$Controller=Join-Path $Here "run_v5d_replacements_final.ps1"
if(!(Test-Path $Verify)){throw "Missing preflight: $Verify"}
if(!(Test-Path $Controller)){throw "Missing controller: $Controller"}

Write-Host "[0/5] Validate final replacement bundle before touching server/results..."
powershell.exe -NoProfile -ExecutionPolicy Bypass -File $Verify
if($LASTEXITCODE -ne 0){throw "Bundle preflight failed."}

Write-Host "[1/5] Stop framework server..."
powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Root "runner\05_stop_our_framework_server_windows.ps1")

Write-Host "[2/5] Kill stale PinchBench replacement runner(s) using $ResultsRoot..."
$Me=$PID
Get-CimInstance Win32_Process -ErrorAction SilentlyContinue|Where-Object{
  $_.ProcessId-ne$Me -and $_.CommandLine -and
  $_.CommandLine-match'03_run_pinchbench_our_framework_windows\.py' -and
  $_.CommandLine-match[regex]::Escape($ResultsRoot)
}|ForEach-Object{
  Write-Host "Killing stale runner PID=$($_.ProcessId)"
  Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
}
Start-Sleep -Seconds 2

Write-Host "[3/5] Clear old replacement results and isolated Claude project cache..."
if(Test-Path $ResultsRoot){
  cmd.exe /d /c "rd /s /q `"\\?\$ResultsRoot`"" | Out-Null
  if(Test-Path $ResultsRoot){throw "Could not clear ResultsRoot: $ResultsRoot"}
}
New-Item -ItemType Directory -Force -Path $ResultsRoot|Out-Null
$Projects=Join-Path $Root "config\projects"
if(Test-Path $Projects){cmd.exe /d /c "rd /s /q `"\\?\$Projects`"" | Out-Null}
New-Item -ItemType Directory -Force -Path $Projects|Out-Null

Write-Host "[4/5] Start framework server..."
powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Root "runner\01_start_our_framework_server_windows.ps1")
$Health=Invoke-RestMethod "http://127.0.0.1:10086/api/health" -Proxy $null
if(!$Health){throw "Framework health check failed."}

Write-Host "[5/5] Start all replacement tasks from task 1..."
powershell.exe -NoProfile -ExecutionPolicy Bypass -File $Controller -Root $Root -ResultsRoot $ResultsRoot -MaxInfraRetries $MaxInfraRetries
exit $LASTEXITCODE
