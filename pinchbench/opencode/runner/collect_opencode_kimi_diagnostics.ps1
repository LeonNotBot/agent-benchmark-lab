param(
    [string]$Root = "C:\pinchbench-opencode-kimi",
    [string]$RunDir = ""
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

if ([string]::IsNullOrWhiteSpace($RunDir)) {
    $latest = Get-ChildItem -LiteralPath (Join-Path $Root "runs") -Directory -Filter "opencode_kimi_k3_*" -ErrorAction Stop | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($null -eq $latest) { throw "No opencode_kimi_k3_* run directory found under $Root\runs" }
    $RunDir = $latest.FullName
}

$RunDir = (Resolve-Path -LiteralPath $RunDir).Path
$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$diagRoot = Join-Path $Root ("diagnostics\opencode_kimi_diag_" + $stamp)
$zipPath = $diagRoot + ".zip"
New-Item -ItemType Directory -Force $diagRoot | Out-Null

Write-Host "Collecting diagnostics from:" -ForegroundColor Cyan
Write-Host $RunDir

$runFiles = @("run_config.json","results.json","results.csv","results.xlsx","progress.jsonl","results.partial.json")
foreach ($name in $runFiles) {
    $src = Join-Path $RunDir $name
    if (Test-Path -LiteralPath $src) { Copy-Item -LiteralPath $src -Destination (Join-Path $diagRoot $name) -Force }
}

$resultsPath = Join-Path $RunDir "results.json"
$rows = @()
if (Test-Path -LiteralPath $resultsPath) {
    $obj = Get-Content -LiteralPath $resultsPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($obj -is [System.Array]) { $rows = @($obj) }
    elseif ($null -ne $obj.results) { $rows = @($obj.results) }
    elseif ($null -ne $obj.tasks) { $rows = @($obj.tasks) }
}

if ($rows.Count -eq 0) {
    $progressPath = Join-Path $RunDir "progress.jsonl"
    if (Test-Path -LiteralPath $progressPath) {
        foreach ($line in Get-Content -LiteralPath $progressPath -Encoding UTF8) {
            if ([string]::IsNullOrWhiteSpace($line)) { continue }
            try { $rows += ($line | ConvertFrom-Json) } catch {}
        }
    }
}

$selected = New-Object System.Collections.Generic.HashSet[string]
foreach ($r in $rows) {
    $id = [string]$r.task_id
    if ([string]::IsNullOrWhiteSpace($id)) { continue }
    $gradeError = [string]$r.grade_error
    $status = [string]$r.status
    $elapsed = 0.0
    try { if ($null -ne $r.agent_elapsed) { $elapsed = [double]$r.agent_elapsed } elseif ($null -ne $r.elapsed) { $elapsed = [double]$r.elapsed } } catch {}
    $isProblem = ($r.success -ne $true) -or (-not [string]::IsNullOrWhiteSpace($gradeError)) -or ($status -ne "success") -or ($r.network_task -eq $true) -or ($null -eq $r.score) -or ($elapsed -ge 500.0)
    if ($isProblem) { [void]$selected.Add($id) }
}

$slowRows = @($rows | Sort-Object @{Expression={
    try {
        if ($null -ne $_.agent_elapsed) { [double]$_.agent_elapsed }
        elseif ($null -ne $_.elapsed) { [double]$_.elapsed }
        else { 0.0 }
    } catch { 0.0 }
}} -Descending | Select-Object -First 10)

foreach ($r in $slowRows) {
    $id = [string]$r.task_id
    if (-not [string]::IsNullOrWhiteSpace($id)) { [void]$selected.Add($id) }
}

$selectedIds = @($selected) | Sort-Object
$selectedIds | Set-Content -LiteralPath (Join-Path $diagRoot "selected_tasks.txt") -Encoding UTF8

$srcTranscripts = Join-Path $RunDir "transcripts"
$dstTranscripts = Join-Path $diagRoot "transcripts"
New-Item -ItemType Directory -Force $dstTranscripts | Out-Null
foreach ($id in $selectedIds) {
    $src = Join-Path $srcTranscripts $id
    if (Test-Path -LiteralPath $src) { Copy-Item -LiteralPath $src -Destination (Join-Path $dstTranscripts $id) -Recurse -Force }
}

$runnerDir = Join-Path $diagRoot "runner"
New-Item -ItemType Directory -Force $runnerDir | Out-Null
$runnerCandidates = @((Join-Path $Root "runner\run_pinchbench_opencode_kimi_windows.py"),(Join-Path $Root "runner\run_pinchbench_opencode_kimi_windows_opus5.py"))
foreach ($src in $runnerCandidates) {
    if (Test-Path -LiteralPath $src) { Copy-Item -LiteralPath $src -Destination $runnerDir -Force }
}

$skill = Join-Path $Root "skill"
$skillOut = Join-Path $diagRoot "skill"
$scriptsOut = Join-Path $skillOut "scripts"
$tasksOut = Join-Path $skillOut "tasks"
New-Item -ItemType Directory -Force $scriptsOut,$tasksOut | Out-Null

if (Test-Path -LiteralPath (Join-Path $skill "scripts")) {
    Get-ChildItem -LiteralPath (Join-Path $skill "scripts") -File -Filter "*.py" | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $scriptsOut -Force }
}
$manifest = Join-Path $skill "tasks\manifest.yaml"
if (Test-Path -LiteralPath $manifest) { Copy-Item -LiteralPath $manifest -Destination $tasksOut -Force }

foreach ($id in $selectedIds) {
    $taskFiles = @(Get-ChildItem -LiteralPath (Join-Path $skill "tasks") -Recurse -File -ErrorAction SilentlyContinue | Where-Object { $_.BaseName -eq $id })
    foreach ($tf in $taskFiles) { Copy-Item -LiteralPath $tf.FullName -Destination $tasksOut -Force }
}

$envLines = New-Object System.Collections.Generic.List[string]
$envLines.Add("CollectedAt=" + (Get-Date).ToString("o"))
$envLines.Add("RunDir=" + $RunDir)
$envLines.Add("OPENROUTER_API_KEY_PRESENT=" + (-not [string]::IsNullOrWhiteSpace($env:OPENROUTER_API_KEY)))
foreach ($name in @("HTTP_PROXY","HTTPS_PROXY","ALL_PROXY","NO_PROXY","PYTHONUTF8","PYTHONIOENCODING","NODE_USE_ENV_PROXY")) {
    $value = [Environment]::GetEnvironmentVariable($name, "Process")
    $envLines.Add($name + "=" + [string]$value)
}

function Add-CommandOutput([string]$label, [scriptblock]$cmd) {
    $envLines.Add("")
    $envLines.Add("=== " + $label + " ===")
    try { $output = & $cmd 2>&1 | Out-String; $envLines.Add($output.TrimEnd()) }
    catch { $envLines.Add("ERROR: " + $_.Exception.Message) }
}

Add-CommandOutput "python -VV" { & (Join-Path $Root ".venv\Scripts\python.exe") -VV }
Add-CommandOutput "python encoding" { & (Join-Path $Root ".venv\Scripts\python.exe") -c "import sys,locale; print('utf8_mode=',sys.flags.utf8_mode); print('preferred=',locale.getpreferredencoding(False)); print('stdin=',sys.stdin.encoding); print('stdout=',sys.stdout.encoding); print('filesystem=',sys.getfilesystemencoding())" }
Add-CommandOutput "pip freeze" { & (Join-Path $Root ".venv\Scripts\python.exe") -m pip freeze }
Add-CommandOutput "opencode --version" { opencode --version }
Add-CommandOutput "node --version" { node --version }
Add-CommandOutput "npm --version" { npm --version }
Add-CommandOutput "git commit" { git -C $skill rev-parse HEAD }
Add-CommandOutput "git status --short" { git -C $skill status --short }
Add-CommandOutput "git diff" { git -C $skill diff -- }

$envLines | Set-Content -LiteralPath (Join-Path $diagRoot "environment.txt") -Encoding UTF8

$summary = New-Object System.Collections.Generic.List[string]
$summary.Add("Selected diagnostic tasks: " + $selectedIds.Count)
foreach ($r in $rows) {
    $id = [string]$r.task_id
    if (-not $selected.Contains($id)) { continue }
    $summary.Add(("{0}`tstatus={1}`tsuccess={2}`tscore={3}`telapsed={4}`tttft={5}`tgrade_error={6}`terror={7}" -f $id,$r.status,$r.success,$r.score,$r.elapsed,$r.ttft,([string]$r.grade_error -replace "`r|`n"," "),([string]$r.error -replace "`r|`n"," ")))
}
$summary | Set-Content -LiteralPath (Join-Path $diagRoot "diagnostic_summary.txt") -Encoding UTF8

$secretHits = @()
$textFiles = Get-ChildItem -LiteralPath $diagRoot -Recurse -File -ErrorAction SilentlyContinue | Where-Object { $_.Extension -in @(".json",".jsonl",".txt",".py",".md",".csv",".yaml",".yml",".log") }
foreach ($f in $textFiles) {
    try {
        $hits = Select-String -LiteralPath $f.FullName -Pattern "sk-or-" -SimpleMatch -ErrorAction SilentlyContinue
        if ($hits) { $secretHits += $hits }
    } catch {}
}

if ($secretHits.Count -gt 0) {
    Write-Host ""
    Write-Host "ABORTED: possible OpenRouter key text found in diagnostic files." -ForegroundColor Red
    $secretHits | Select-Object Path,LineNumber | Format-Table -AutoSize
    Write-Host "Nothing was zipped. Remove/redact the secret first." -ForegroundColor Red
    exit 2
}

if (Test-Path -LiteralPath $zipPath) { Remove-Item -LiteralPath $zipPath -Force }
Compress-Archive -Path (Join-Path $diagRoot "*") -DestinationPath $zipPath -CompressionLevel Optimal -Force

Write-Host ""
Write-Host "DIAGNOSTIC ZIP READY:" -ForegroundColor Green
Write-Host $zipPath -ForegroundColor Green
Write-Host ("Selected tasks: " + $selectedIds.Count)
Write-Host ("ZIP size MB: {0:N1}" -f ((Get-Item -LiteralPath $zipPath).Length / 1MB))
Write-Host "Upload this ZIP to ChatGPT." -ForegroundColor Cyan
