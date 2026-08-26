param(
    [string]$InstallDir = "C:\pinchbench-gemini\judge-repair",
    [string]$FormalStderrLog = "C:\pinchbench-gemini\logs\gemini-runner\full-20260731-173521.stderr.txt",
    [string]$Python = ""
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

$PackageDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$TargetRegrader = Join-Path $InstallDir "regrade_pinchbench.py"
$ReplacementRegrader = Join-Path $PackageDir "regrade_pinchbench.py"
$Extractor = Join-Path $PackageDir "extract_hybrid_automated_breakdowns.py"
$RecoveryJson = Join-Path $InstallDir "recovered_hybrid_automated_breakdowns.json"
$ExpectedCurrentHash = "a9e98a47fa0dc6c0692af71b479651a57411740e652e173454385a5f9c6ec253"

foreach ($Path in @($TargetRegrader, $ReplacementRegrader, $Extractor, $FormalStderrLog)) {
    if (-not (Test-Path -LiteralPath $Path)) { throw "Required path missing: $Path" }
}

$ActualCurrentHash = (Get-FileHash -LiteralPath $TargetRegrader -Algorithm SHA256).Hash.ToLowerInvariant()
if ($ActualCurrentHash -ne $ExpectedCurrentHash) {
    throw "Installed regrader differs from the reviewed source. Expected $ExpectedCurrentHash, actual $ActualCurrentHash. Do not patch; upload the current file."
}

$Candidates = @()
if (-not [string]::IsNullOrWhiteSpace($Python)) { $Candidates += $Python }
$Candidates += @(
    "C:\pinchbench-opencode\.venv\Scripts\python.exe",
    "C:\pinchbench-codex\.venv\Scripts\python.exe"
)
$ResolvedPython = $Candidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if ([string]::IsNullOrWhiteSpace($ResolvedPython)) { throw "Supported Python not found." }

$Stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$Backup = "$TargetRegrader.backup-hybrid-recovery-$Stamp"
Copy-Item -LiteralPath $TargetRegrader -Destination $Backup -Force

& $ResolvedPython -X utf8 $Extractor --log $FormalStderrLog --output $RecoveryJson
if ($LASTEXITCODE -ne 0) { throw "Failed to recover automated breakdowns from the formal runner log." }

$Recovery = Get-Content -LiteralPath $RecoveryJson -Raw -Encoding UTF8 | ConvertFrom-Json
if ([int]$Recovery.task_count -ne 8) { throw "Expected 8 recovered tasks, got $($Recovery.task_count)." }

Copy-Item -LiteralPath $ReplacementRegrader -Destination $TargetRegrader -Force
& $ResolvedPython -X utf8 -m py_compile $TargetRegrader
if ($LASTEXITCODE -ne 0) {
    Copy-Item -LiteralPath $Backup -Destination $TargetRegrader -Force
    throw "Replacement regrader failed syntax validation; original restored."
}

Write-Host "PASS: hybrid regrade recovery installed."
Write-Host ("Backup: " + $Backup)
Write-Host ("Recovered breakdowns: " + $RecoveryJson)
Write-Host ("Formal log SHA256: " + $Recovery.source_log_sha256)
Write-Host "The 14 completed regrade jobs remain unchanged; only the 8 failed hybrid jobs should be resumed."
