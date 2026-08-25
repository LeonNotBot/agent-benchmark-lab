param(
    [string]$RunRoot = "C:\pinchbench-opencode-kimi\runs",
    [string]$RunDir = "",
    [int]$RefreshSeconds = 5,
    [switch]$Once
)

$ErrorActionPreference = "SilentlyContinue"

function Get-LatestRunDir {
    param([string]$Root)
    if (-not (Test-Path $Root)) { return $null }
    return Get-ChildItem $Root -Directory |
        Where-Object { $_.Name -like "opencode_kimi_k3_*" -or $_.Name -like "opencode_*" } |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1
}

function First-Value {
    param([object[]]$Values)
    foreach ($value in $Values) {
        if ($null -ne $value -and "$value" -ne "") { return $value }
    }
    return 0
}

function Sum-Field {
    param($Rows, [string]$Name)
    $sum = 0.0
    $seen = $false
    foreach ($row in $Rows) {
        $prop = $row.PSObject.Properties[$Name]
        if ($null -ne $prop -and $null -ne $prop.Value -and "$($prop.Value)" -ne "") {
            $sum += [double]$prop.Value
            $seen = $true
        }
    }
    if ($seen) { return $sum }
    return $null
}

while ($true) {
    $activeRun = $null
    if ($RunDir) {
        if (Test-Path $RunDir) { $activeRun = Get-Item $RunDir }
    } else {
        $activeRun = Get-LatestRunDir -Root $RunRoot
    }

    Clear-Host
    Write-Host "PinchBench OpenCode + Kimi K3 Monitor" -ForegroundColor Cyan
    Write-Host ("Time: {0}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"))

    if ($null -eq $activeRun) {
        Write-Host "No run directory found yet." -ForegroundColor Yellow
        Write-Host "Watching: $RunRoot"
    } else {
        $configPath = Join-Path $activeRun.FullName "run_config.json"
        $progressPath = Join-Path $activeRun.FullName "progress.jsonl"
        $partialPath = Join-Path $activeRun.FullName "results.partial.json"
        $config = $null
        if (Test-Path $configPath) {
            $config = Get-Content $configPath -Raw | ConvertFrom-Json
        }

        $rows = @()
        if (Test-Path $progressPath) {
            $rows = @(Get-Content $progressPath | Where-Object { $_.Trim() } | ForEach-Object { $_ | ConvertFrom-Json })
        } elseif (Test-Path $partialPath) {
            $partial = Get-Content $partialPath -Raw | ConvertFrom-Json
            $rows = @($partial.results)
        }

        $completed = $rows.Count
        $total = if ($null -ne $config -and $config.task_count) { [int]$config.task_count } else { 0 }
        $pct = if ($total -gt 0) { [math]::Round(100.0 * $completed / $total, 1) } else { 0 }

        Write-Host "Run: $($activeRun.FullName)" -ForegroundColor Green
        if ($null -ne $config) {
            Write-Host "Model: $($config.model)"
            Write-Host "OpenCode: $($config.opencode_version)"
            Write-Host "PinchBench commit: $($config.pinchbench_commit)"
        }
        Write-Host ("Progress: {0}/{1} ({2}%)" -f $completed, $total, $pct) -ForegroundColor Cyan

        if ($completed -gt 0) {
            $last = $rows[-1]
            $scores = @($rows | Where-Object { $null -ne $_.score } | ForEach-Object { [double]$_.score })
            $avgScore = if ($scores.Count -gt 0) { [math]::Round((($scores | Measure-Object -Average).Average), 4) } else { $null }
            $successCount = @($rows | Where-Object { $_.success -eq $true }).Count
            $tokenMissing = @($rows | Where-Object { $_.token_coverage_complete -ne $true }).Count

            $agentSec = Sum-Field -Rows $rows -Name "agent_elapsed"
            if ($null -eq $agentSec) { $agentSec = Sum-Field -Rows $rows -Name "elapsed" }
            $gradingSec = Sum-Field -Rows $rows -Name "grading_elapsed"
            $e2eSec = Sum-Field -Rows $rows -Name "end_to_end_elapsed"
            $inputTok = Sum-Field -Rows $rows -Name "input_tokens"
            $outputTok = Sum-Field -Rows $rows -Name "output_tokens"
            $reasonTok = Sum-Field -Rows $rows -Name "reasoning_tokens"
            $cacheReadTok = Sum-Field -Rows $rows -Name "cache_read_tokens"
            $cacheWriteTok = Sum-Field -Rows $rows -Name "cache_write_tokens"
            $totalTok = Sum-Field -Rows $rows -Name "total_tokens"
            $cost = Sum-Field -Rows $rows -Name "cost_usd"

            Write-Host ""
            Write-Host "Latest completed task" -ForegroundColor Yellow
            Write-Host ("  {0} | status={1} | score={2}" -f $last.task_id, $last.status, $last.score)
            Write-Host ("  agent={0:N1}s grade={1:N1}s e2e={2:N1}s" -f [double](First-Value -Values @($last.agent_elapsed, $last.elapsed, 0)), [double](First-Value -Values @($last.grading_elapsed, 0)), [double](First-Value -Values @($last.end_to_end_elapsed, 0)))
            Write-Host ("  tokens={0} | steps={1} | usage_complete={2}" -f $last.total_tokens, $last.step_count, $last.token_coverage_complete)

            Write-Host ""
            Write-Host "Aggregate" -ForegroundColor Yellow
            Write-Host ("  success={0}/{1} avg_score={2} token_missing={3}" -f $successCount, $completed, $avgScore, $tokenMissing)
            Write-Host ("  agent_sec={0:N1} grading_sec={1:N1} e2e_sec={2:N1}" -f [double](First-Value -Values @($agentSec, 0)), [double](First-Value -Values @($gradingSec, 0)), [double](First-Value -Values @($e2eSec, 0)))
            Write-Host ("  input={0:N0} output={1:N0} reasoning={2:N0}" -f [double](First-Value -Values @($inputTok, 0)), [double](First-Value -Values @($outputTok, 0)), [double](First-Value -Values @($reasonTok, 0)))
            Write-Host ("  cache_read={0:N0} cache_write={1:N0} derived_total={2:N0}" -f [double](First-Value -Values @($cacheReadTok, 0)), [double](First-Value -Values @($cacheWriteTok, 0)), [double](First-Value -Values @($totalTok, 0)))
            Write-Host ("  OpenCode-reported cost USD={0:N6}" -f [double](First-Value -Values @($cost, 0)))
        }

        $transcriptsRoot = Join-Path $activeRun.FullName "transcripts"
        if (Test-Path $transcriptsRoot) {
            $latestFile = Get-ChildItem $transcriptsRoot -Recurse -File |
                Where-Object { $_.Name -like "*.jsonl" -or $_.Name -like "*.prompt.txt" -or $_.Name -like "*.stderr.txt" } |
                Sort-Object LastWriteTime -Descending |
                Select-Object -First 1
            if ($latestFile) {
                Write-Host ""
                Write-Host "Latest activity" -ForegroundColor Yellow
                Write-Host ("  {0}" -f $latestFile.FullName)
                Write-Host ("  updated {0}" -f $latestFile.LastWriteTime.ToString("HH:mm:ss"))
            }
        }
    }

    $procs = @(Get-CimInstance Win32_Process | Where-Object {
        $_.CommandLine -match "run_pinchbench_opencode_kimi_windows.py" -or
        $_.CommandLine -match "opencode(.cmd|.exe)?\s+run"
    })
    Write-Host ""
    Write-Host "Processes" -ForegroundColor Yellow
    if ($procs.Count -eq 0) {
        Write-Host "  No matching runner/OpenCode process detected."
    } else {
        foreach ($proc in $procs) {
            Write-Host ("  PID={0} Name={1}" -f $proc.ProcessId, $proc.Name)
        }
    }

    if ($Once) { break }
    Write-Host ""
    Write-Host "Ctrl+C to stop monitor. Refresh every $RefreshSeconds seconds." -ForegroundColor DarkGray
    Start-Sleep -Seconds ([math]::Max(1, $RefreshSeconds))
}
