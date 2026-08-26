param(
    [string]$Python = "",
    [string]$ProxyUrl = "http://127.0.0.1:10090"
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Config = Join-Path $Root "regrade_config_gemini.json"
$Regrader = Join-Path $Root "regrade_pinchbench.py"
$Merger = Join-Path $Root "merge_gemini_selective_regrade.py"
$OriginalRun = "C:\pinchbench-gemini\runs\gemini_20260731_173523"
$OutputRoot = "C:\pinchbench-gemini\selective-regrades"
$CorrectedRoot = "C:\pinchbench-gemini\regraded-results"
$JudgeModel = "openrouter/anthropic/claude-opus-5"

if ([string]::IsNullOrWhiteSpace([string]$env:OPENROUTER_API_KEY)) {
    throw "OPENROUTER_API_KEY is missing in this PowerShell window."
}

if (-not [string]::IsNullOrWhiteSpace($ProxyUrl)) {
    $env:HTTP_PROXY = $ProxyUrl
    $env:HTTPS_PROXY = $ProxyUrl
    $env:ALL_PROXY = $ProxyUrl
}
$env:NO_PROXY = "localhost,127.0.0.1,::1"
$env:no_proxy = "localhost,127.0.0.1,::1"

$Candidates = @()
if (-not [string]::IsNullOrWhiteSpace($Python)) { $Candidates += $Python }
$Candidates += @(
    "C:\pinchbench-opencode\.venv\Scripts\python.exe",
    "C:\pinchbench-codex\.venv\Scripts\python.exe"
)
$ResolvedPython = $null
foreach ($Candidate in $Candidates) {
    if (Test-Path -LiteralPath $Candidate) {
        $ResolvedPython = (Resolve-Path -LiteralPath $Candidate).Path
        break
    }
}
if ([string]::IsNullOrWhiteSpace($ResolvedPython)) {
    throw ("Supported Python not found. Tried: " + ($Candidates -join " | "))
}

foreach ($Path in @(
    $Config,
    $Regrader,
    $Merger,
    (Join-Path $OriginalRun "results.json"),
    (Join-Path $OriginalRun "run_config.json"),
    "C:\pinchbench-codex\skill\scripts\lib_agent.py",
    "C:\pinchbench-codex\skill\scripts\lib_grading.py",
    "C:\pinchbench-codex\skill\tasks\manifest.yaml"
)) {
    if (-not (Test-Path -LiteralPath $Path)) { throw "Required path missing: $Path" }
}

New-Item -ItemType Directory -Path $OutputRoot,$CorrectedRoot -Force | Out-Null
$LogRoot = Join-Path $OutputRoot "launcher-logs"
New-Item -ItemType Directory -Path $LogRoot -Force | Out-Null
$Stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$PreflightLog = Join-Path $LogRoot "preflight-$Stamp.txt"
$RunLog = Join-Path $LogRoot "run-$Stamp.txt"
$MergeLog = Join-Path $LogRoot "merge-$Stamp.txt"

Write-Host "===== PREFLIGHT ====="
& $ResolvedPython -X utf8 $Regrader --config $Config preflight --judge-model $JudgeModel 2>&1 |
    Tee-Object -FilePath $PreflightLog |
    ForEach-Object { Write-Host $_ }
if ($LASTEXITCODE -ne 0) {
    throw "Selective regrade preflight failed. Log: $PreflightLog"
}

Write-Host ""
Write-Host "===== REGRADING 22 FROZEN OUTPUTS ====="
Write-Host "Agent execution will NOT run again."
Write-Host "Automated Git grader N/A will remain unchanged."
$Started = Get-Date
& $ResolvedPython -X utf8 $Regrader --config $Config run --suite smoke --judge-model $JudgeModel --verbose 2>&1 |
    Tee-Object -FilePath $RunLog |
    ForEach-Object { Write-Host $_ }
$RunExit = $LASTEXITCODE

$RegradeRun = Get-ChildItem -LiteralPath $OutputRoot -Directory -Filter "smoke_*" -ErrorAction SilentlyContinue |
    Where-Object { $_.LastWriteTime -ge $Started.AddMinutes(-1) } |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
if ($null -eq $RegradeRun) {
    throw "Could not locate the selective regrade run directory. Log: $RunLog"
}

if ($RunExit -ne 0) {
    Write-Host ""
    Write-Host ("Regrade run: " + $RegradeRun.FullName)
    Write-Host "At least one Judge job is still failed. Corrected results were NOT generated."
    $ResumeCommand = 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "{0}" -RunDir "{1}"' -f (Join-Path $Root "03_resume_gemini_selective_regrade.ps1"), $RegradeRun.FullName
    Write-Host ("Resume command: " + $ResumeCommand)
    throw "Selective regrade incomplete. Exit code: $RunExit"
}

Write-Host ""
Write-Host "===== MERGING INTO A NEW 143-TASK RESULT ====="
& $ResolvedPython -X utf8 $Merger --original-run $OriginalRun --regrade-run $RegradeRun.FullName --output-root $CorrectedRoot 2>&1 |
    Tee-Object -FilePath $MergeLog |
    ForEach-Object { Write-Host $_ }
if ($LASTEXITCODE -ne 0) {
    throw "Regrade completed, but strict merge validation failed. Log: $MergeLog"
}

$OutputLine = Get-Content -LiteralPath $MergeLog -Encoding UTF8 |
    Where-Object { $_ -like "OUTPUT_DIR=*" } |
    Select-Object -Last 1
$CorrectedDir = if ($OutputLine) { $OutputLine.Substring("OUTPUT_DIR=".Length) } else { "" }

Write-Host ""
Write-Host "PASS: selective frozen-output regrade and strict merge completed." -ForegroundColor Green
Write-Host ("Regrade evidence: " + $RegradeRun.FullName)
Write-Host ("Corrected result: " + $CorrectedDir)
Write-Host "The original run was not modified."
