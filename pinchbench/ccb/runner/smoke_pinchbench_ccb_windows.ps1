﻿param(
    [string]$Root = "C:\pinchbench-ccb",
    [string]$Proxy = "http://127.0.0.1:10090",
    [string]$Model = "deepseek/deepseek-v4-pro",
    [string]$ExpectedCcbVersion = "2.8.4",
    [switch]$SkipCliCanaries
)

$ErrorActionPreference = "Stop"
Set-ExecutionPolicy -Scope Process Bypass -Force
chcp 65001 > $null

$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[Console]::InputEncoding = $Utf8NoBom
[Console]::OutputEncoding = $Utf8NoBom
$OutputEncoding = $Utf8NoBom
$env:PYTHONUTF8 = "1"
$env:PYTHONIOENCODING = "utf-8"

$Skill = Join-Path $Root "skill"
$Runs = Join-Path $Root "runs"
$Logs = Join-Path $Root "logs"
$Canary = Join-Path $Root "canary"
$Runner = Join-Path $Root "runner\run_pinchbench_ccb_windows.py"
$Python = Join-Path $Root ".venv\Scripts\python.exe"
$Profile = Join-Path $Root "ccb-profile"
$ExpectedJudgeModel = "openrouter/anthropic/claude-opus-5"

foreach ($Dir in @($Runs, $Logs, $Canary, $Profile)) {
    New-Item -ItemType Directory -Path $Dir -Force | Out-Null
}
foreach ($RequiredPath in @($Skill, $Runner, $Python)) {
    if (-not (Test-Path -LiteralPath $RequiredPath)) {
        throw "Required path is missing: $RequiredPath"
    }
}

if (-not [string]::IsNullOrWhiteSpace($Proxy)) {
    $env:HTTP_PROXY = $Proxy
    $env:HTTPS_PROXY = $Proxy
    $env:http_proxy = $Proxy
    $env:https_proxy = $Proxy
    $env:NO_PROXY = "localhost,127.0.0.1,::1"
    $env:no_proxy = $env:NO_PROXY
}

if ([string]::IsNullOrWhiteSpace($env:OPENROUTER_API_KEY)) {
    $SecureKey = Read-Host "Enter the OpenRouter API key for this PowerShell session" -AsSecureString
    $KeyPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureKey)
    try {
        $env:OPENROUTER_API_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($KeyPtr)
    }
    finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($KeyPtr)
        Remove-Variable SecureKey, KeyPtr -ErrorAction SilentlyContinue
    }
}
if ([string]::IsNullOrWhiteSpace($env:OPENROUTER_API_KEY)) {
    throw "OPENROUTER_API_KEY is not set"
}

# One OpenRouter key is intentionally reused for both the tested agent and Judge.
$env:ANTHROPIC_BASE_URL = "https://openrouter.ai/api"
$env:ANTHROPIC_AUTH_TOKEN = $env:OPENROUTER_API_KEY
Remove-Item Env:ANTHROPIC_API_KEY -ErrorAction SilentlyContinue
$env:CLAUDE_CONFIG_DIR = $Profile

foreach ($Name in @(
    "ANTHROPIC_MODEL",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL",
    "ANTHROPIC_DEFAULT_SONNET_MODEL",
    "ANTHROPIC_DEFAULT_OPUS_MODEL",
    "ANTHROPIC_REASONING_MODEL",
    "CLAUDE_CODE_SUBAGENT_MODEL"
)) {
    Set-Item -Path ("Env:" + $Name) -Value $Model
}

$CcbCommand = (Get-Command ccb -ErrorAction Stop).Source
$CcbVersion = (& $CcbCommand --version 2>&1 | Out-String).Trim()
if ($CcbVersion -notlike ("*" + $ExpectedCcbVersion + "*")) {
    throw "CCB version mismatch. Expected $ExpectedCcbVersion; found $CcbVersion"
}

$LogPath = Join-Path $Logs ("ccb-smoke-" + (Get-Date -Format "yyyyMMdd-HHmmss") + ".txt")
Start-Transcript -Path $LogPath -Force | Out-Null
try {
    Write-Host "=== CCB / PinchBench smoke test ===" -ForegroundColor Cyan
    [PSCustomObject]@{
        Root = $Root
        Skill = $Skill
        Runner = $Runner
        Python = $Python
        CCB = $CcbCommand
        CCBVersion = $CcbVersion
        AgentModel = $Model
        JudgeModel = $ExpectedJudgeModel
        PermissionMode = "acceptEdits"
        BaseURL = $env:ANTHROPIC_BASE_URL
        ConfigDir = $env:CLAUDE_CONFIG_DIR
        AgentKeySet = -not [string]::IsNullOrWhiteSpace($env:ANTHROPIC_AUTH_TOKEN)
        JudgeKeySet = -not [string]::IsNullOrWhiteSpace($env:OPENROUTER_API_KEY)
        AgentJudgeKeySame = ($env:ANTHROPIC_AUTH_TOKEN -eq $env:OPENROUTER_API_KEY)
        AnthropicApiKeyEmpty = [string]::IsNullOrEmpty($env:ANTHROPIC_API_KEY)
    } | Format-List

    if (-not $SkipCliCanaries) {
        Write-Host "[1/4] CCB text canary" -ForegroundColor Cyan
        $TextJsonl = Join-Path $Canary "smoke_text.jsonl"
        $TextErr = Join-Path $Canary "smoke_text.stderr.txt"
        Remove-Item $TextJsonl, $TextErr -Force -ErrorAction SilentlyContinue

        $TextSession = [guid]::NewGuid().ToString()
        $TextPrompt = "Reply with exactly: CCB_TEXT_OK. Do not call tools."
        $TextPrompt | & $CcbCommand `
            --session-id $TextSession `
            --model $Model `
            --input-format text `
            --output-format stream-json `
            --permission-mode acceptEdits `
            --verbose `
            --include-partial-messages `
            -p `
            1> $TextJsonl `
            2> $TextErr
        if ($LASTEXITCODE -ne 0) {
            throw "CCB text canary failed with exit code $LASTEXITCODE. See $TextErr"
        }

        $TextResult = Get-Content $TextJsonl -Encoding UTF8 |
            ForEach-Object { try { $_ | ConvertFrom-Json } catch { $null } } |
            Where-Object { $_.type -eq "result" } |
            Select-Object -Last 1
        if ($null -eq $TextResult -or $TextResult.is_error -or $TextResult.result -ne "CCB_TEXT_OK") {
            throw "CCB text canary did not return CCB_TEXT_OK. See $TextJsonl"
        }
        if ($TextResult.session_id -ne $TextSession) {
            throw "CCB text canary returned an unexpected session_id. See $TextJsonl"
        }

        Write-Host "[2/4] CCB Read/Write canary" -ForegroundColor Cyan
        Set-Content (Join-Path $Canary "input.txt") -Value "SOURCE_VALUE_123" -Encoding UTF8
        $OutputFile = Join-Path $Canary "output.txt"
        $ToolJsonl = Join-Path $Canary "smoke_tool.jsonl"
        $ToolErr = Join-Path $Canary "smoke_tool.stderr.txt"
        Remove-Item $OutputFile, $ToolJsonl, $ToolErr -Force -ErrorAction SilentlyContinue

        $ToolPrompt = @"
Read input.txt.
Then create output.txt in the current working directory.
output.txt must contain exactly:
CCB_TOOL_OK
Do not ask follow-up questions. Complete the task now.
"@
        Push-Location $Canary
        try {
            $ToolSession = [guid]::NewGuid().ToString()
            $ToolPrompt | & $CcbCommand `
                --session-id $ToolSession `
                --model $Model `
                --input-format text `
                --output-format stream-json `
                --permission-mode acceptEdits `
                --verbose `
                --include-partial-messages `
                --allowedTools "Read,Write" `
                -p `
                1> $ToolJsonl `
                2> $ToolErr
            if ($LASTEXITCODE -ne 0) {
                throw "CCB tool canary failed with exit code $LASTEXITCODE. See $ToolErr"
            }
        }
        finally {
            Pop-Location
        }

        if (-not (Test-Path -LiteralPath $OutputFile)) {
            throw "CCB tool canary did not create output.txt. See $ToolJsonl"
        }
        $ToolContent = (Get-Content $OutputFile -Raw -Encoding UTF8).Trim()
        if ($ToolContent -ne "CCB_TOOL_OK") {
            throw "output.txt has unexpected content: $ToolContent"
        }
    }

    Write-Host "[3/4] Full runner preflight; no model call" -ForegroundColor Cyan
    & $Python $Runner `
        --skill-dir $Skill `
        --model $Model `
        --permission-mode acceptEdits `
        --suite all `
        --results-dir $Runs `
        --preflight
    if ($LASTEXITCODE -ne 0) {
        throw "Runner preflight failed with exit code $LASTEXITCODE"
    }

    Write-Host "[4/4] Four-task PinchBench smoke run, including multi-session" -ForegroundColor Cyan
    & $Python $Runner `
        --skill-dir $Skill `
        --model $Model `
        --permission-mode acceptEdits `
        --suite "task_sanity,task_email_triage,task_csv_stock_trend,task_iterative_code_refine" `
        --results-dir $Runs `
        --keep-workspaces `
        --clear-judge-cache `
        --verbose
    if ($LASTEXITCODE -ne 0) {
        throw "PinchBench smoke runner failed with exit code $LASTEXITCODE"
    }

    $Latest = Get-ChildItem $Runs -Directory |
        Where-Object { $_.Name -like "ccb_*" } |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1
    if ($null -eq $Latest) {
        throw "No CCB smoke result directory was found"
    }

    $ResultsPath = Join-Path $Latest.FullName "results.json"
    $ConfigPath = Join-Path $Latest.FullName "run_config.json"
    $Results = Get-Content $ResultsPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $RunConfig = Get-Content $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json

    if ($RunConfig.judge_model -ne $ExpectedJudgeModel) {
        throw "Unexpected Judge model: $($RunConfig.judge_model)"
    }
    if (-not $RunConfig.judge_key_present) {
        throw "Judge key was not detected in run_config.json"
    }
    if ($RunConfig.permission_mode -ne "acceptEdits") {
        throw "Unexpected permission mode: $($RunConfig.permission_mode)"
    }
    if ($RunConfig.prompt_transport -ne "stdin") {
        throw "Unexpected prompt transport: $($RunConfig.prompt_transport)"
    }
    if ($RunConfig.output_protocol -notlike "*stream-json*") {
        throw "Unexpected output protocol: $($RunConfig.output_protocol)"
    }

    $ById = @{}
    foreach ($Row in $Results.results) {
        $ById[$Row.task_id] = $Row
    }
    if ($null -eq $ById["task_sanity"].score -or [double]$ById["task_sanity"].score -le 0) {
        throw "task_sanity did not receive a positive automated score; normalized assistant transcript is still invalid"
    }
    if ($null -eq $ById["task_email_triage"].score -or $ById["task_email_triage"].grade_error) {
        throw "task_email_triage Judge/hybrid grading did not pass"
    }
    foreach ($Row in $Results.results) {
        if (-not $Row.stream_json_complete) {
            throw ("stream-json protocol was incomplete for " + $Row.task_id + ": " + $Row.error)
        }
        if (-not $Row.usage_complete) {
            throw ("CCB result usage was missing for " + $Row.task_id)
        }
        if ($null -ne $Row.unexpected_models -and $Row.unexpected_models.Count -gt 0) {
            throw ("Unexpected model in " + $Row.task_id + ": " + ($Row.unexpected_models -join ","))
        }
    }

    $MultiTurnsPath = Join-Path $Latest.FullName "transcripts\task_iterative_code_refine\turn_results.json"
    $MultiTurns = Get-Content $MultiTurnsPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($MultiTurns -isnot [System.Array]) {
        $MultiTurns = @($MultiTurns)
    }
    if ($MultiTurns.Count -ne 3) {
        throw "Multi-session canary expected 3 turns; found $($MultiTurns.Count)"
    }
    foreach ($Turn in $MultiTurns) {
        if (-not $Turn.stream_json_ok -or $Turn.protocol_mode -ne "stream-json") {
            throw "A multi-session turn did not return valid stream-json"
        }
        if ($Turn.session_id -ne $Turn.requested_session_id) {
            throw "A multi-session turn returned a session ID different from the explicit requested UUID"
        }
    }
    if ($MultiTurns[0].resume_requested) {
        throw "Turn 1 must start an explicit new session"
    }
    if (-not $MultiTurns[1].resume_requested) {
        throw "Turn 2 did not request --resume"
    }
    if ($MultiTurns[2].resume_requested) {
        throw "Turn 3 must start a new explicit session rather than resume"
    }
    if ($MultiTurns[0].requested_session_id -ne $MultiTurns[1].requested_session_id) {
        throw "Turn 2 did not resume the explicit session UUID from turn 1"
    }
    if ($MultiTurns[2].requested_session_id -eq $MultiTurns[1].requested_session_id) {
        throw "Turn 3 should use a new explicit session UUID"
    }

    $MultiTranscriptDir = Join-Path $Latest.FullName "transcripts\task_iterative_code_refine"
    $PendingPattern = "permission is pending|once you approve|approval required|waiting for approval"
    $PendingHit = Get-ChildItem $MultiTranscriptDir -Filter "turn_*.jsonl" |
        Select-String -Pattern $PendingPattern -CaseSensitive:$false |
        Select-Object -First 1
    if ($null -ne $PendingHit) {
        throw "CCB still waited for interactive file permission: $($PendingHit.Path):$($PendingHit.LineNumber)"
    }

    $CalculatorPath = Join-Path $Latest.FullName "workspaces\task_iterative_code_refine\calculator.py"
    if (-not (Test-Path -LiteralPath $CalculatorPath)) {
        throw "Multi-session canary did not create calculator.py; unattended edit permission is not working"
    }

    Write-Host "Smoke test completed successfully." -ForegroundColor Green
    Write-Host "Result directory: $($Latest.FullName)"
    Write-Host "Transcript log: $LogPath"
    Write-Host "Validated: stdin prompt transport, required stream-json/result events, usage/provider parsing, unattended Read/Write, fixed Claude Judge, and explicit UUID resume/new-session behavior."
}
finally {
    Stop-Transcript | Out-Null
}
