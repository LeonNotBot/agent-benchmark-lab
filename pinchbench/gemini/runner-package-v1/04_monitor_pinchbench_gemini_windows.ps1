param(
    [string]$Root = "C:\pinchbench-gemini",
    [string]$RunDir = "",
    [int]$RefreshSeconds = 10,
    [string]$AdapterUrl = "http://127.0.0.1:8766"
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

$Runs = Join-Path $Root "runs"

if ([string]::IsNullOrWhiteSpace($RunDir)) {
    Write-Host "Waiting for a Gemini run directory..."

    while ([string]::IsNullOrWhiteSpace($RunDir)) {
        $Latest = Get-ChildItem `
            -LiteralPath $Runs `
            -Directory `
            -Filter "gemini_*" `
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
Write-Host "Connected to Gemini run:" -ForegroundColor Green
Write-Host $RunDir -ForegroundColor Green
Write-Host ("Tasks: " + $Total)
Write-Host ("Gemini CLI: " + $Config.gemini_cli_version)
Write-Host ("Tested model: " + $Config.model)
Write-Host ("Judge: " + $Config.judge_model)
Write-Host ("Adapter: " + $Config.adapter_url)
Write-Host (
    "Ctrl+C stops only this monitor, not the benchmark."
) -ForegroundColor DarkGray
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
            -not [string]::IsNullOrWhiteSpace(
                [string]$_.grade_error
            )
        }
    ).Count

    $Timeouts = @(
        $Rows |
        Where-Object {
            [string]$_.status -eq "timeout" -or
            [string]$_.error -match "(?i)timeout|timed out"
        }
    ).Count

    $TotalCost = 0.0
    foreach ($Row in $Rows) {
        if ($null -ne $Row.cost_usd) {
            try {
                $TotalCost += [double]$Row.cost_usd
            }
            catch {
            }
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
            $Age = (
                (Get-Date) - $Newest.LastWriteTime
            ).TotalSeconds
            $LastActivity = (
                "{0:N0}s ago" -f $Age
            )
        }
    }

    $AdapterState = "unavailable"

    try {
        $Health = Invoke-RestMethod `
            -Method Get `
            -Uri ($AdapterUrl.TrimEnd("/") + "/healthz") `
            -TimeoutSec 3

        $AdapterState = (
            "ok={0}; ready={1}; version={2}; mode={3}" -f
            $Health.ok,
            $Health.ready,
            $Health.version,
            $Health.responseMode
        )
    }
    catch {
        $AdapterState = "health request failed"
    }

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

    Clear-Host
    Write-Host "PinchBench Gemini monitor" -ForegroundColor Cyan
    Write-Host ("Run: " + $RunDir)
    Write-Host ("Tested model: " + $Config.model)
    Write-Host ("Judge: " + $Config.judge_model)
    Write-Host ("Adapter: " + $AdapterState)
    Write-Host ""
    Write-Host (
        "Completed: {0}/{1} | Success: {2} | Failed: {3}" -f
        $Completed,
        $Total,
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
        "Timeouts: {0} | Recorded agent cost: ${1:N6}" -f
        $Timeouts,
        $TotalCost
    )
    Write-Host (
        "Newest transcript task: {0} | Activity: {1}" -f
        $ActiveTaskText,
        $ActivityText
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
            elseif (
                -not [string]::IsNullOrWhiteSpace(
                    [string]$Row.grade_error
                )
            ) {
                $Marker = "GRADE"
            }

            Write-Host (
                "[{0}] {1} status={2} score={3} elapsed={4:N1}s" -f
                $Marker,
                [string]$Row.task_id,
                [string]$Row.status,
                $Score,
                [double]$Row.elapsed
            )
        }
    }

    Write-Host ""
    Write-Host (
        "Updated: " +
        (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
    )
    Write-Host (
        "Ctrl+C stops only this monitor."
    ) -ForegroundColor DarkGray

    if (
        (Test-Path -LiteralPath $ResultsPath) -and
        $Completed -ge $Total
    ) {
        Write-Host ""
        Write-Host "Run is complete." -ForegroundColor Green
        break
    }

    Start-Sleep -Seconds $RefreshSeconds
}
