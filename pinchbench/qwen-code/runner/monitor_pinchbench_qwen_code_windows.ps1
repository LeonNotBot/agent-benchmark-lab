param(
    [string]$RunDir = "",
    [int]$PollSeconds = 2
)

$ErrorActionPreference = "Continue"
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

$Root = "C:\pinchbench-qwen-code"
$Runs = "$Root\runs"
$MonitorStarted = Get-Date

function Find-LatestRun {
    $Candidates = Get-ChildItem -LiteralPath $Runs -Directory -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -like "qwen_code_*" } |
        Sort-Object LastWriteTime -Descending

    foreach ($Candidate in $Candidates) {
        $ConfigPath = Join-Path $Candidate.FullName "run_config.json"
        $ProgressPath = Join-Path $Candidate.FullName "progress.jsonl"
        $ResultsPath = Join-Path $Candidate.FullName "results.json"
        $IsActive = -not (Test-Path -LiteralPath $ResultsPath)
        $IsNew = $Candidate.CreationTime -ge $MonitorStarted
        if ((Test-Path -LiteralPath $ConfigPath) -and (Test-Path -LiteralPath $ProgressPath) -and ($IsActive -or $IsNew)) {
            return $Candidate.FullName
        }
    }
    return $null
}

if ([string]::IsNullOrWhiteSpace($RunDir)) {
    Write-Host "正在等待 Qwen Code PinchBench 运行目录……" -ForegroundColor Cyan
    while ([string]::IsNullOrWhiteSpace($RunDir)) {
        $RunDir = Find-LatestRun
        if ([string]::IsNullOrWhiteSpace($RunDir)) {
            Start-Sleep -Seconds $PollSeconds
        }
    }
}

$RunDir = (Resolve-Path -LiteralPath $RunDir).Path
$ConfigPath = Join-Path $RunDir "run_config.json"
$ProgressPath = Join-Path $RunDir "progress.jsonl"
$ResultsPath = Join-Path $RunDir "results.json"

if (-not (Test-Path -LiteralPath $ConfigPath)) {
    throw "找不到 run_config.json：$ConfigPath"
}
if (-not (Test-Path -LiteralPath $ProgressPath)) {
    throw "找不到 progress.jsonl：$ProgressPath"
}

$Config = Get-Content -LiteralPath $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
$Total = 0
if ($null -ne $Config.task_count) {
    $Total = [int]$Config.task_count
}

Write-Host ""
Write-Host "已连接到 Qwen Code 运行：" -ForegroundColor Green
Write-Host $RunDir -ForegroundColor Green
Write-Host "任务总数：$Total"
Write-Host "Qwen 版本：$($Config.qwen_code_version)"
Write-Host "模型：$($Config.model)"
Write-Host "审批 / Safe Mode：$($Config.approval_mode) / $($Config.safe_mode)"
Write-Host "按 Ctrl+C 只停止监控，不会停止测试。" -ForegroundColor DarkGray
Write-Host ""
Write-Host ("=" * 118)

$Seen = 0
$Finished = $false

while (-not $Finished) {
    $Lines = @(Get-Content -LiteralPath $ProgressPath -Encoding UTF8 -ErrorAction SilentlyContinue)

    if ($Lines.Count -gt $Seen) {
        for ($Index = $Seen; $Index -lt $Lines.Count; $Index++) {
            $Line = [string]$Lines[$Index]
            if ([string]::IsNullOrWhiteSpace($Line)) {
                continue
            }

            try {
                $Row = $Line | ConvertFrom-Json
            }
            catch {
                # 最后一行可能正在写入；下轮再读。
                break
            }

            $TaskId = [string]$Row.task_id
            $Status = [string]$Row.status
            $ErrorText = [string]$Row.error
            $GradeError = [string]$Row.grade_error
            $UnexpectedModels = (@($Row.unexpected_models) | Where-Object { $_ }) -join ", "
            $PermissionDenials = (@($Row.permission_denials) | Where-Object { $_ }) -join " | "

            $ScoreText = "N/A"
            if ($null -ne $Row.score) {
                try { $ScoreText = "{0:N3}" -f [double]$Row.score } catch { $ScoreText = [string]$Row.score }
            }

            $ElapsedText = "N/A"
            if ($null -ne $Row.elapsed) {
                try { $ElapsedText = "{0:N1}" -f [double]$Row.elapsed } catch { $ElapsedText = [string]$Row.elapsed }
            }

            $Label = "[正常]"
            $Color = "Green"

            if (-not [string]::IsNullOrWhiteSpace($GradeError)) {
                $Label = "[评分链路异常]"
                $Color = "Magenta"
            }
            elseif (-not [string]::IsNullOrWhiteSpace($UnexpectedModels) -or $Status -eq "model_mismatch") {
                $Label = "[模型身份异常]"
                $Color = "DarkYellow"
            }
            elseif (-not [string]::IsNullOrWhiteSpace($PermissionDenials)) {
                $Label = "[权限拒绝]"
                $Color = "DarkYellow"
            }
            elseif ($Status -eq "timeout" -or $ErrorText -match "(?i)timeout|timed out|超时") {
                $Label = "[执行超时]"
                $Color = "Yellow"
            }
            elseif ($ErrorText -match "(?i)provider_unavailable|network connection lost|Unexpected server error|No endpoints found|429|502|529|ECONN|ENOTFOUND|ETIMEDOUT|proxy|TLS|socket") {
                $Label = "[接口、网络或路由异常]"
                $Color = "Red"
            }
            elseif ($Row.success -eq $false) {
                $Label = "[执行失败]"
                $Color = "Red"
            }
            elseif ($Row.usage_complete -eq $false) {
                $Label = "[Usage缺失]"
                $Color = "Cyan"
            }
            elseif ($null -eq $Row.score) {
                $Label = "[无分数]"
                $Color = "DarkYellow"
            }
            else {
                try {
                    if ([double]$Row.score -lt 0.8) {
                        $Label = "[低分，需归因]"
                        $Color = "Yellow"
                    }
                }
                catch { }
            }

            $Current = $Index + 1
            Write-Host (
                "{0} {1}/{2} {3} score={4} elapsed={5}s status={6}" -f
                $Label, $Current, $Total, $TaskId, $ScoreText, $ElapsedText, $Status
            ) -ForegroundColor $Color

            if (-not [string]::IsNullOrWhiteSpace($UnexpectedModels)) {
                Write-Host "  非目标模型：$UnexpectedModels" -ForegroundColor DarkGray
            }
            if (-not [string]::IsNullOrWhiteSpace($PermissionDenials)) {
                Write-Host "  权限拒绝：$PermissionDenials" -ForegroundColor DarkGray
            }
            if (-not [string]::IsNullOrWhiteSpace($ErrorText)) {
                Write-Host "  运行错误：$ErrorText" -ForegroundColor DarkGray
            }
            if (-not [string]::IsNullOrWhiteSpace($GradeError)) {
                $ShortGradeError = $GradeError
                if ($ShortGradeError.Length -gt 600) {
                    $ShortGradeError = $ShortGradeError.Substring(0, 600) + "……"
                }
                Write-Host "  打分错误：$ShortGradeError" -ForegroundColor DarkGray
            }
            Write-Host ""

            $Seen = $Index + 1
        }

        $ParsedRows = @()
        foreach ($ExistingLine in $Lines) {
            if ([string]::IsNullOrWhiteSpace([string]$ExistingLine)) { continue }
            try { $ParsedRows += ($ExistingLine | ConvertFrom-Json) } catch { }
        }

        $Completed = $ParsedRows.Count
        $SuccessCount = @($ParsedRows | Where-Object { $_.success -eq $true }).Count
        $FailureCount = @($ParsedRows | Where-Object { $_.success -eq $false }).Count
        $ScoredRows = @($ParsedRows | Where-Object { $null -ne $_.score })
        $AverageText = "N/A"
        if ($ScoredRows.Count -gt 0) {
            $Sum = 0.0
            foreach ($Scored in $ScoredRows) { $Sum += [double]$Scored.score }
            $AverageText = "{0:N4}" -f ($Sum / $ScoredRows.Count)
        }

        Write-Host (
            "累计：{0}/{1}｜成功 {2}｜失败 {3}｜有分数 {4}｜当前平均分 {5}" -f
            $Completed, $Total, $SuccessCount, $FailureCount, $ScoredRows.Count, $AverageText
        ) -ForegroundColor Cyan
        Write-Host ("-" * 118)
    }

    if ((Test-Path -LiteralPath $ResultsPath) -and ($Total -eq 0 -or $Seen -ge $Total)) {
        $Finished = $true
        Write-Host ""
        Write-Host "运行已完成。最终结果：$ResultsPath" -ForegroundColor Green
        break
    }

    Start-Sleep -Seconds $PollSeconds
}
