param(
    [string]$Root = "C:\pinchbench-opencode-kimi",
    [string]$RunDir = "",
    [int]$RefreshSeconds = 10
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

$Runs = Join-Path $Root "runs"

function Get-SafeDouble {
    param($Value)
    if ($null -eq $Value -or [string]::IsNullOrWhiteSpace([string]$Value)) {
        return 0.0
    }
    try {
        return [double]$Value
    }
    catch {
        return 0.0
    }
}

function Sum-Field {
    param(
        [object[]]$Rows,
        [string]$Name
    )

    $Sum = 0.0
    $Seen = $false

    foreach ($Row in $Rows) {
        $Prop = $Row.PSObject.Properties[$Name]
        if ($null -ne $Prop -and $null -ne $Prop.Value -and -not [string]::IsNullOrWhiteSpace([string]$Prop.Value)) {
            try {
                $Sum += [double]$Prop.Value
                $Seen = $true
            }
            catch {
            }
        }
    }

    if ($Seen) {
        return $Sum
    }

    return $null
}

function Get-ProcessState {
    $Runner = @()
    $OpenCode = @()

    try {
        $Processes = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue

        $Runner = @(
            $Processes |
            Where-Object {
                $_.CommandLine -match "run_pinchbench_opencode_kimi_windows\.py"
            }
        )

        $OpenCode = @(
            $Processes |
            Where-Object {
                $_.CommandLine -match "(?i)opencode(\.cmd|\.exe)?\s+run"
            }
        )
    }
    catch {
    }

    return [PSCustomObject]@{
        Runner = $Runner
        OpenCode = $OpenCode
    }
}

if ([string]::IsNullOrWhiteSpace($RunDir)) {
    Write-Host "Waiting for an OpenCode + Kimi K3 run directory..."

    while ([string]::IsNullOrWhiteSpace($RunDir)) {
        $Latest = Get-ChildItem `
            -LiteralPath $Runs `
            -Directory `
            -Filter "opencode_kimi_k3_*" `
            -ErrorAction SilentlyContinue |
            Sort-Object LastWriteTime -Descending |
            Select-Object -First 1

        if ($null -ne $Latest) {
            $RunDir = $Latest.FullName
            break
        }

        Start-Sleep -Seconds 2
    }
}

$RunDir = (Resolve-Path -LiteralPath $RunDir).Path
$ConfigPath = Join-Path $RunDir "run_config.json"
$ProgressPath = Join-Path $RunDir "progress.jsonl"
$ResultsPath = Join-Path $RunDir "results.json"
$TranscriptRoot = Join-Path $RunDir "transcripts"

while (-not (Test-Path -LiteralPath $ConfigPath)) {
    Start-Sleep -Seconds 1
}

$Config = Get-Content `
    -LiteralPath $ConfigPath `
    -Raw `
    -Encoding UTF8 |
    ConvertFrom-Json

$Total = [int]$Config.task_count

Write-Host ""
Write-Host "Connected to OpenCode + Kimi K3 run:" -ForegroundColor Green
Write-Host $RunDir -ForegroundColor Green
Write-Host ("Tasks: " + $Total)
Write-Host ("OpenCode: " + $Config.opencode_version)
Write-Host ("Tested model: " + $Config.model)
Write-Host ("Judge: " + $Config.judge_model)
Write-Host ("PinchBench commit: " + $Config.pinchbench_commit)
Write-Host "Ctrl+C stops only this monitor, not the benchmark." -ForegroundColor DarkGray
Write-Host ""

while ($true) {
    $Rows = @()

    if (Test-Path -LiteralPath $ProgressPath) {
        foreach ($Line in Get-Content `
            -LiteralPath $ProgressPath `
            -Encoding UTF8 `
            -ErrorAction SilentlyContinue
        ) {
            if ([string]::IsNullOrWhiteSpace($Line)) {
                continue
            }

            try {
                $Rows += ($Line | ConvertFrom-Json)
            }
            catch {
            }
        }
    }

    $Completed = $Rows.Count
    $Success = @(
        $Rows |
        Where-Object { $_.success -eq $true }
    ).Count
    $Failed = $Completed - $Success

    $ScoredRows = @(
        $Rows |
        Where-Object { $null -ne $_.score }
    )
    $Scored = $ScoredRows.Count
    $MeanScore = $null

    if ($Scored -gt 0) {
        $MeanScore = (
            $ScoredRows |
            Measure-Object -Property score -Average
        ).Average
    }

    $GradeErrors = @(
        $Rows |
        Where-Object {
            -not [string]::IsNullOrWhiteSpace([string]$_.grade_error)
        }
    ).Count

    $Timeouts = @(
        $Rows |
        Where-Object {
            [string]$_.status -eq "timeout" -or
            [string]$_.error -match "(?i)timeout|timed out|超时"
        }
    ).Count

    $UsageMissing = @(
        $Rows |
        Where-Object {
            $_.token_coverage_complete -ne $true -and
            $_.usage_complete -ne $true
        }
    ).Count

    $TotalCost = Sum-Field -Rows $Rows -Name "cost_usd"
    if ($null -eq $TotalCost) {
        $TotalCost = 0.0
    }

    $AgentSeconds = Sum-Field -Rows $Rows -Name "agent_elapsed"
    if ($null -eq $AgentSeconds) {
        $AgentSeconds = Sum-Field -Rows $Rows -Name "elapsed"
    }
    if ($null -eq $AgentSeconds) {
        $AgentSeconds = 0.0
    }

    $GradingSeconds = Sum-Field -Rows $Rows -Name "grading_elapsed"
    if ($null -eq $GradingSeconds) {
        $GradingSeconds = 0.0
    }

    $EndToEndSeconds = Sum-Field -Rows $Rows -Name "end_to_end_elapsed"
    if ($null -eq $EndToEndSeconds) {
        $EndToEndSeconds = 0.0
    }

    $InputTokens = Sum-Field -Rows $Rows -Name "input_tokens"
    $OutputTokens = Sum-Field -Rows $Rows -Name "output_tokens"
    $ReasoningTokens = Sum-Field -Rows $Rows -Name "reasoning_tokens"
    $CacheReadTokens = Sum-Field -Rows $Rows -Name "cache_read_tokens"
    $CacheWriteTokens = Sum-Field -Rows $Rows -Name "cache_write_tokens"
    $TotalTokens = Sum-Field -Rows $Rows -Name "total_tokens"

    foreach ($Name in @("InputTokens", "OutputTokens", "ReasoningTokens", "CacheReadTokens", "CacheWriteTokens", "TotalTokens")) {
        if ($null -eq (Get-Variable -Name $Name -ValueOnly)) {
            Set-Variable -Name $Name -Value 0.0
        }
    }

    $ActiveTask = ""
    $LastActivity = ""

    if (Test-Path -LiteralPath $TranscriptRoot) {
        $Newest = Get-ChildItem `
            -LiteralPath $TranscriptRoot `
            -Directory `
            -ErrorAction SilentlyContinue |
            Sort-Object LastWriteTime -Descending |
            Select-Object -First 1

        if ($null -ne $Newest) {
            $ActiveTask = $Newest.Name
            $Age = ((Get-Date) - $Newest.LastWriteTime).TotalSeconds
            $LastActivity = "{0:N0}s ago" -f $Age
        }
    }

    $ProcessState = Get-ProcessState
    $RunnerCount = @($ProcessState.Runner).Count
    $OpenCodeCount = @($ProcessState.OpenCode).Count

    $MeanText = "N/A"
    if ($null -ne $MeanScore) {
        $MeanText = "{0:N4}" -f [double]$MeanScore
    }

    $ActiveTaskText = "none"
    if (-not [string]::IsNullOrWhiteSpace($ActiveTask)) {
        $ActiveTaskText = $ActiveTask
    }

    $ActivityText = "none"
    if (-not [string]::IsNullOrWhiteSpace($LastActivity)) {
        $ActivityText = $LastActivity
    }

    $Percent = 0.0
    if ($Total -gt 0) {
        $Percent = 100.0 * $Completed / $Total
    }

    Clear-Host
    Write-Host "PinchBench OpenCode + Kimi K3 monitor" -ForegroundColor Cyan
    Write-Host ("Run: " + $RunDir)
    Write-Host ("Tested model: " + $Config.model)
    Write-Host ("Judge: " + $Config.judge_model)
    Write-Host ("OpenCode: " + $Config.opencode_version)
    Write-Host ""

    Write-Host (
        "Completed: {0}/{1} ({2:N1}%) | Success: {3} | Failed: {4}" -f
        $Completed,
        $Total,
        $Percent,
        $Success,
        $Failed
    )
    Write-Host (
        "Scored: {0} | Mean: {1} | Grade errors: {2}" -f
        $Scored,
        $MeanText,
        $GradeErrors
    )
    Write-Host (
        "Timeouts: {0} | Usage missing: {1} | Agent cost: ${2:N6}" -f
        $Timeouts,
        $UsageMissing,
        [double]$TotalCost
    )
    Write-Host (
        "Agent time: {0:N1}s | Grading time: {1:N1}s | End-to-end: {2:N1}s" -f
        [double]$AgentSeconds,
        [double]$GradingSeconds,
        [double]$EndToEndSeconds
    )
    Write-Host (
        "Tokens: in={0:N0} | out={1:N0} | reasoning={2:N0} | total={3:N0}" -f
        [double]$InputTokens,
        [double]$OutputTokens,
        [double]$ReasoningTokens,
        [double]$TotalTokens
    )
    Write-Host (
        "Cache: read={0:N0} | write={1:N0}" -f
        [double]$CacheReadTokens,
        [double]$CacheWriteTokens
    )
    Write-Host (
        "Newest transcript task: {0} | Activity: {1}" -f
        $ActiveTaskText,
        $ActivityText
    )
    Write-Host (
        "Processes: runner={0} | opencode={1}" -f
        $RunnerCount,
        $OpenCodeCount
    )

    if ($Rows.Count -gt 0) {
        Write-Host ""
        Write-Host "Latest completed tasks:"

        foreach ($Row in @($Rows | Select-Object -Last 8)) {
            $Score = "N/A"
            if ($null -ne $Row.score) {
                try {
                    $Score = "{0:N3}" -f [double]$Row.score
                }
                catch {
                    $Score = [string]$Row.score
                }
            }

            $Marker = "OK"
            if ($Row.success -ne $true) {
                $Marker = "FAIL"
            }
            elseif (-not [string]::IsNullOrWhiteSpace([string]$Row.grade_error)) {
                $Marker = "GRADE"
            }

            $AgentElapsed = Get-SafeDouble $Row.agent_elapsed
            if ($AgentElapsed -le 0) {
                $AgentElapsed = Get-SafeDouble $Row.elapsed
            }

            $GradeElapsed = Get-SafeDouble $Row.grading_elapsed
            $RowTokens = Get-SafeDouble $Row.total_tokens

            Write-Host (
                "[{0}] {1} status={2} score={3} agent={4:N1}s grade={5:N1}s tokens={6:N0}" -f
                $Marker,
                [string]$Row.task_id,
                [string]$Row.status,
                $Score,
                $AgentElapsed,
                $GradeElapsed,
                $RowTokens
            )
        }
    }

    Write-Host ""
    Write-Host (
        "Updated: " + (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
    )
    Write-Host "Ctrl+C stops only this monitor." -ForegroundColor DarkGray

    if (
        (Test-Path -LiteralPath $ResultsPath) -and
        $Completed -ge $Total
    ) {
        Write-Host ""
        Write-Host "Run is complete." -ForegroundColor Green
        break
    }

    Start-Sleep -Seconds ([Math]::Max(1, $RefreshSeconds))
}
