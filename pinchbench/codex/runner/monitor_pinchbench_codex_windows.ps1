param(
    [string]$RunDir = "",
    [int]$PollSeconds = 2,
    [string]$Root = "C:\pinchbench-codex"
)

$ErrorActionPreference = "Continue"
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

$Runs = "$Root\runs"
$MonitorStarted = Get-Date

function Find-LatestRun {
    $Candidates = Get-ChildItem -LiteralPath $Runs -Directory -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -like "codex_*" } |
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
    Write-Host "正在等待 Codex PinchBench 运行目录……" -ForegroundColor Cyan
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
Write-Host "已连接到 Codex 运行：" -ForegroundColor Green
Write-Host $RunDir -ForegroundColor Green
Write-Host "任务总数：$Total"
Write-Host "Codex 版本：$($Config.codex_version)"
Write-Host "模型：$($Config.model)"
Write-Host "审批 / 沙箱：$($Config.approval_policy) / $($Config.sandbox_mode)"
Write-Host "Windows 沙箱：$($Config.windows_sandbox)"
Write-Host "模型验证：config.toml + --model"
Write-Host "低分阈值：score < 0.8（优先于可恢复 Codex 警告显示）"
Write-Host "按 Ctrl+C 只停止监控，不会停止测试。" -ForegroundColor DarkGray
Write-Host ""
Write-Host ("=" * 124)

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
            $ToolErrors = 0
            $ItemErrors = 0
            $FatalErrors = 0
            try { $ToolErrors = [int]$Row.tool_errors } catch { }
            try { $ItemErrors = [int]$Row.item_error_count } catch { }
            try { $FatalErrors = [int]$Row.fatal_error_count } catch { }

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
            $IsLowScore = $false
            if ($null -ne $Row.score) {
                try { $IsLowScore = ([double]$Row.score -lt 0.8) } catch { }
            }

            # Severity order:
            # grading/model/fatal/network/execution failures > permission/usage/no-score
            # > low score > recoverable Codex warnings.
            # Low score must be evaluated before tool/item warnings, otherwise a
            # recurring Codex item warning can hide every low-scoring task.
            if (-not [string]::IsNullOrWhiteSpace($GradeError)) {
                $Label = "[评分链路异常]"
                $Color = "Magenta"
            }
            elseif (-not [string]::IsNullOrWhiteSpace($UnexpectedModels) -or $Status -eq "model_mismatch") {
                $Label = "[模型配置异常]"
                $Color = "DarkYellow"
            }
            elseif ($FatalErrors -gt 0 -or $Status -eq "timeout" -or $ErrorText -match "(?i)timeout|timed out|超时") {
                $Label = "[执行超时或致命错误]"
                $Color = "Yellow"
            }
            elseif ($ErrorText -match "(?i)provider_unavailable|network connection lost|Unexpected server error|No endpoints found|401|403|429|502|529|ECONN|ENOTFOUND|ETIMEDOUT|proxy|TLS|socket") {
                $Label = "[接口、认证、网络或路由异常]"
                $Color = "Red"
            }
            elseif ($Row.success -eq $false) {
                $Label = "[执行失败]"
                $Color = "Red"
            }
            elseif (-not [string]::IsNullOrWhiteSpace($PermissionDenials)) {
                $Label = "[完成，有权限拒绝]"
                $Color = "DarkYellow"
            }
            elseif ($Row.usage_complete -eq $false) {
                $Label = "[Usage缺失]"
                $Color = "Cyan"
            }
            elseif ($null -eq $Row.score) {
                $Label = "[无分数]"
                $Color = "DarkYellow"
            }
            elseif ($IsLowScore) {
                if ($ToolErrors -gt 0 -and $ItemErrors -gt 0) {
                    $Label = "[低分，需归因；有工具重试和Codex警告]"
                }
                elseif ($ToolErrors -gt 0) {
                    $Label = "[低分，需归因；有工具重试]"
                }
                elseif ($ItemErrors -gt 0) {
                    $Label = "[低分，需归因；有Codex警告]"
                }
                else {
                    $Label = "[低分，需归因]"
                }
                $Color = "Yellow"
            }
            elseif ($ToolErrors -gt 0 -and $ItemErrors -gt 0) {
                $Label = "[完成，有工具重试和Codex警告]"
                $Color = "Cyan"
            }
            elseif ($ToolErrors -gt 0) {
                $Label = "[完成，有工具重试]"
                $Color = "Cyan"
            }
            elseif ($ItemErrors -gt 0) {
                $Label = "[完成，有Codex警告]"
                $Color = "Cyan"
            }

            $Current = $Index + 1
            Write-Host (
                "{0} {1}/{2} {3} score={4} elapsed={5}s status={6} tool_errors={7} item_errors={8}" -f
                $Label, $Current, $Total, $TaskId, $ScoreText, $ElapsedText, $Status, $ToolErrors, $ItemErrors
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
        $RetryCount = @($ParsedRows | Where-Object { [int]$_.tool_errors -gt 0 }).Count
        $WarningCount = @($ParsedRows | Where-Object { [int]$_.item_error_count -gt 0 }).Count
        $ScoredRows = @($ParsedRows | Where-Object { $null -ne $_.score })
        $LowScoreRows = @($ScoredRows | Where-Object {
            try { [double]$_.score -lt 0.8 } catch { $false }
        })
        $AverageText = "N/A"
        if ($ScoredRows.Count -gt 0) {
            $Sum = 0.0
            foreach ($Scored in $ScoredRows) { $Sum += [double]$Scored.score }
            $AverageText = "{0:N4}" -f ($Sum / $ScoredRows.Count)
        }

        Write-Host (
            "累计：{0}/{1}｜成功 {2}｜失败 {3}｜低分(<0.8) {4}｜有工具重试 {5}｜有Codex警告 {6}｜有分数 {7}｜当前平均分 {8}" -f
            $Completed, $Total, $SuccessCount, $FailureCount, $LowScoreRows.Count,
            $RetryCount, $WarningCount, $ScoredRows.Count, $AverageText
        ) -ForegroundColor Cyan
        Write-Host ("-" * 124)
    }

    if ((Test-Path -LiteralPath $ResultsPath) -and ($Total -eq 0 -or $Seen -ge $Total)) {
        $Finished = $true
        Write-Host ""
        Write-Host "运行已完成。最终结果：$ResultsPath" -ForegroundColor Green
        break
    }

    Start-Sleep -Seconds $PollSeconds
}
