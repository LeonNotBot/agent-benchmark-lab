param(
    [string]$Root = "C:\pinchbench-gemini",
    [int]$Port = 8766,
    [int]$LongTimeoutSeconds = 600,
    [int]$SessionTimeoutSeconds = 180,
    [int]$ProgressSeconds = 15
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

$Gemini = Join-Path $Root "cli\node_modules\.bin\gemini.cmd"
$GeminiHome = Join-Path $Root "gemini-home"
$SettingsPath = Join-Path $GeminiHome ".gemini\settings.json"
$BaseUrl = "http://127.0.0.1:$Port"
$Stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$RunDir = Join-Path $Root ("canary-runs\gemini_adapter_v1_2_" + $Stamp)
$Workspace = Join-Path $RunDir "workspace"
$Logs = Join-Path $RunDir "logs"
$StatePath = Join-Path $RunDir "canary_state.json"
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$Steps = New-Object System.Collections.ArrayList

foreach ($Required in @($Gemini, $SettingsPath)) {
    if (-not (Test-Path -LiteralPath $Required)) {
        throw "Required path not found: $Required"
    }
}

New-Item -ItemType Directory -Force -Path $Workspace, $Logs | Out-Null

$Health = Invoke-RestMethod `
    -Method Get `
    -Uri "$BaseUrl/healthz" `
    -TimeoutSec 5

if (
    $Health.ok -ne $true -or
    $Health.ready -ne $true -or
    [string]$Health.version -ne "1.2.0"
) {
    throw "Adapter v1.2 is not ready at $BaseUrl."
}

$Settings = (
    [System.IO.File]::ReadAllText($SettingsPath) |
    ConvertFrom-Json
)

if ($null -eq $Settings.security) {
    $Settings | Add-Member `
        -MemberType NoteProperty `
        -Name security `
        -Value ([PSCustomObject]@{})
}

if ($null -eq $Settings.security.auth) {
    $Settings.security | Add-Member `
        -MemberType NoteProperty `
        -Name auth `
        -Value ([PSCustomObject]@{})
}

if ($null -eq $Settings.security.auth.PSObject.Properties["selectedType"]) {
    $Settings.security.auth | Add-Member `
        -MemberType NoteProperty `
        -Name selectedType `
        -Value "gemini-api-key"
}
else {
    $Settings.security.auth.selectedType = "gemini-api-key"
}

[System.IO.File]::WriteAllText(
    $SettingsPath,
    ($Settings | ConvertTo-Json -Depth 30),
    $Utf8NoBom
)

$env:GEMINI_CLI_HOME = $GeminiHome
$env:GEMINI_CLI_TRUST_WORKSPACE = "true"
$env:GEMINI_API_KEY = "AIzaSy" + ("0" * 33)
$env:GOOGLE_GEMINI_BASE_URL = $BaseUrl
$env:GOOGLE_GENAI_API_VERSION = "v1beta"
$env:GOOGLE_GENAI_USE_VERTEXAI = "false"
$env:NO_PROXY = "localhost,127.0.0.1,::1"
$env:no_proxy = "localhost,127.0.0.1,::1"
$env:NO_COLOR = "1"
$env:FORCE_COLOR = "0"

foreach ($Name in @(
    "GOOGLE_API_KEY",
    "GOOGLE_GENAI_USE_GCA",
    "GOOGLE_CLOUD_PROJECT",
    "GOOGLE_CLOUD_PROJECT_ID",
    "GOOGLE_CLOUD_LOCATION",
    "GOOGLE_APPLICATION_CREDENTIALS",
    "GOOGLE_VERTEX_BASE_URL"
)) {
    Remove-Item -LiteralPath "Env:\$Name" -ErrorAction SilentlyContinue
}

function Write-Utf8NoBom {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Text
    )

    [System.IO.File]::WriteAllText($Path, $Text, $Utf8NoBom)
}

function Read-JsonlEvents {
    param(
        [Parameter(Mandatory = $true)][string]$Path
    )

    $Events = @()
    if (-not (Test-Path -LiteralPath $Path)) {
        return $Events
    }

    foreach ($Line in Get-Content -LiteralPath $Path -Encoding UTF8) {
        if ([string]::IsNullOrWhiteSpace($Line)) {
            continue
        }

        try {
            $Events += ($Line | ConvertFrom-Json)
        }
        catch {
        }
    }

    return $Events
}

function Get-AssistantText {
    param(
        [Parameter(Mandatory = $true)][string]$Path
    )

    return (
        @(
            Read-JsonlEvents -Path $Path |
            Where-Object {
                $_.type -eq "message" -and
                $_.role -eq "assistant"
            } |
            ForEach-Object { [string]$_.content }
        ) -join ""
    )
}

function Get-ResultStatus {
    param(
        [Parameter(Mandatory = $true)][string]$Path
    )

    $Result = @(
        Read-JsonlEvents -Path $Path |
        Where-Object { $_.type -eq "result" }
    ) | Select-Object -Last 1

    if ($null -eq $Result) {
        return ""
    }

    return [string]$Result.status
}

function Save-State {
    $Passed = @(
        $Steps |
        Where-Object { $_.ValidationPassed -eq $true }
    ).Count

    $Failed = @(
        $Steps |
        Where-Object { $_.ValidationPassed -eq $false }
    ).Count

    $State = [ordered]@{
        RunId = "gemini_adapter_v1_2_" + $Stamp
        UpdatedAt = (Get-Date).ToString("o")
        RunDirectory = $RunDir
        Workspace = $Workspace
        AdapterUrl = $BaseUrl
        AdapterVersion = [string]$Health.version
        ResponseMode = [string]$Health.responseMode
        HeartbeatSeconds = $Health.heartbeatSeconds
        Passed = $Passed
        Failed = $Failed
        Steps = $Steps
    }

    [System.IO.File]::WriteAllText(
        $StatePath,
        ($State | ConvertTo-Json -Depth 30),
        $Utf8NoBom
    )
}

function Stop-ProcessTree {
    param(
        [Parameter(Mandatory = $true)][int]$ProcessId
    )

    $TaskKill = Join-Path $env:SystemRoot "System32\taskkill.exe"

    try {
        $Kill = Start-Process `
            -FilePath $TaskKill `
            -ArgumentList @(
                "/PID", [string]$ProcessId,
                "/T",
                "/F"
            ) `
            -NoNewWindow `
            -Wait `
            -PassThru

        return [int]$Kill.ExitCode
    }
    catch {
        Stop-Process `
            -Id $ProcessId `
            -Force `
            -ErrorAction SilentlyContinue

        return -1
    }
}

function Invoke-GeminiCanary {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string]$Prompt,
        [Parameter(Mandatory = $true)][int]$TimeoutSeconds,
        [string]$ResumeSession = ""
    )

    $PromptPath = Join-Path $Logs ($Name + ".prompt.txt")
    $StdoutPath = Join-Path $Logs ($Name + ".jsonl")
    $StderrPath = Join-Path $Logs ($Name + ".stderr.txt")

    Write-Utf8NoBom -Path $PromptPath -Text $Prompt
    Remove-Item `
        -LiteralPath $StdoutPath, $StderrPath `
        -Force `
        -ErrorAction SilentlyContinue

    $Arguments = @(
        "--model", "deepseek/deepseek-v4-pro",
        "--output-format", "stream-json",
        "--approval-mode", "yolo",
        "--skip-trust"
    )

    if (-not [string]::IsNullOrWhiteSpace($ResumeSession)) {
        $Arguments += @("--resume", $ResumeSession)
    }

    $Started = Get-Date
    $TimedOut = $false
    $KillExitCode = $null

    Write-Host (
        "  Starting {0}; hard timeout={1}s" -f
        $Name,
        $TimeoutSeconds
    )

    $Process = Start-Process `
        -FilePath $Gemini `
        -ArgumentList $Arguments `
        -WorkingDirectory $Workspace `
        -RedirectStandardInput $PromptPath `
        -RedirectStandardOutput $StdoutPath `
        -RedirectStandardError $StderrPath `
        -NoNewWindow `
        -PassThru

    while (-not $Process.HasExited) {
        $Elapsed = ((Get-Date) - $Started).TotalSeconds

        if ($Elapsed -ge $TimeoutSeconds) {
            $TimedOut = $true
            Write-Warning (
                "{0} reached hard timeout; killing PID {1} and children." -f
                $Name,
                $Process.Id
            )
            $KillExitCode = Stop-ProcessTree -ProcessId $Process.Id
            try {
                [void]$Process.WaitForExit(10000)
            }
            catch {
            }
            break
        }

        Write-Host (
            "  {0}: elapsed {1:N0}s / {2}s" -f
            $Name,
            $Elapsed,
            $TimeoutSeconds
        )

        $Remaining = [math]::Max(
            1,
            $TimeoutSeconds - [int][math]::Floor($Elapsed)
        )

        Start-Sleep -Seconds (
            [math]::Min($ProgressSeconds, $Remaining)
        )

        try {
            $Process.Refresh()
        }
        catch {
        }
    }

    if (-not $TimedOut) {
        try {
            $Process.WaitForExit()
        }
        catch {
        }
    }

    $Ended = Get-Date
    $ExitCode = 124

    if (-not $TimedOut) {
        try {
            $ExitCode = [int]$Process.ExitCode
        }
        catch {
            $ExitCode = -1
        }
    }

    return [ordered]@{
        Name = $Name
        ExitCode = $ExitCode
        ResultStatus = Get-ResultStatus -Path $StdoutPath
        TimedOut = $TimedOut
        TimeoutSeconds = $TimeoutSeconds
        KillExitCode = $KillExitCode
        StartedAt = $Started.ToString("o")
        EndedAt = $Ended.ToString("o")
        DurationSeconds = [math]::Round(
            ($Ended - $Started).TotalSeconds,
            3
        )
        Prompt = $PromptPath
        Stdout = $StdoutPath
        Stderr = $StderrPath
    }
}

Save-State

Write-Host "Canary A: long write with heartbeat transport..."
$LongFile = Join-Path $Workspace "long_write_probe.md"
$LongPrompt = @'
Create long_write_probe.md in the current workspace.

Requirements:
- At least 16,000 characters.
- At least 250 lines.
- Include English, Chinese, fenced code, a Markdown table, quotes, and emoji.
- Do not use run_shell_command for document content.
- Use write_file for the complete document if possible.
- Read the completed file and report its character and line counts.
'@

$LongStep = Invoke-GeminiCanary `
    -Name "01_long_write" `
    -Prompt $LongPrompt `
    -TimeoutSeconds $LongTimeoutSeconds

$LongCharacters = 0
$LongLines = 0

if (Test-Path -LiteralPath $LongFile) {
    $LongText = [System.IO.File]::ReadAllText($LongFile)
    $LongCharacters = $LongText.Length
    $LongLines = ($LongText -split "`r?`n").Count
}

$LongStep["ValidationPassed"] = (
    $LongStep.ExitCode -eq 0 -and
    $LongStep.ResultStatus -eq "success" -and
    $LongCharacters -ge 16000 -and
    $LongLines -ge 250
)
$LongStep["FileExists"] = Test-Path -LiteralPath $LongFile
$LongStep["Characters"] = $LongCharacters
$LongStep["Lines"] = $LongLines
[void]$Steps.Add([PSCustomObject]$LongStep)
Save-State

Write-Host "Canary B: session first turn..."
$Marker = "ORANGE-7391"
$SessionFirst = Invoke-GeminiCanary `
    -Name "02_session_first" `
    -Prompt (
        "Remember the exact marker $Marker for this session. " +
        "Reply with exactly: STORED"
    ) `
    -TimeoutSeconds $SessionTimeoutSeconds

$FirstEvents = Read-JsonlEvents -Path $SessionFirst.Stdout
$SessionId = [string](
    @(
        $FirstEvents |
        Where-Object { $_.type -eq "init" } |
        Select-Object -First 1
    ).session_id
)

$FirstText = Get-AssistantText -Path $SessionFirst.Stdout
$SessionFirst["ValidationPassed"] = (
    $SessionFirst.ExitCode -eq 0 -and
    $SessionFirst.ResultStatus -eq "success" -and
    $FirstText.Trim() -eq "STORED" -and
    -not [string]::IsNullOrWhiteSpace($SessionId)
)
$SessionFirst["AssistantText"] = $FirstText.Trim()
$SessionFirst["SessionId"] = $SessionId
[void]$Steps.Add([PSCustomObject]$SessionFirst)
Save-State

if (-not [string]::IsNullOrWhiteSpace($SessionId)) {
    Write-Host "Canary C: session resume..."
    $SessionResume = Invoke-GeminiCanary `
        -Name "03_session_resume" `
        -Prompt (
            "What exact marker did I ask you to remember? " +
            "Reply with the marker only."
        ) `
        -TimeoutSeconds $SessionTimeoutSeconds `
        -ResumeSession $SessionId

    $ResumeText = Get-AssistantText -Path $SessionResume.Stdout
    $SessionResume["ValidationPassed"] = (
        $SessionResume.ExitCode -eq 0 -and
        $SessionResume.ResultStatus -eq "success" -and
        $ResumeText.Trim() -eq $Marker
    )
    $SessionResume["AssistantText"] = $ResumeText.Trim()
    $SessionResume["SessionId"] = $SessionId
    [void]$Steps.Add([PSCustomObject]$SessionResume)
}
else {
    [void]$Steps.Add(
        [PSCustomObject][ordered]@{
            Name = "03_session_resume"
            Skipped = $true
            Reason = "No session id from first turn."
            ValidationPassed = $false
        }
    )
}

Save-State

$Passed = @(
    $Steps |
    Where-Object { $_.ValidationPassed -eq $true }
).Count

$Failed = @(
    $Steps |
    Where-Object { $_.ValidationPassed -eq $false }
).Count

Write-Host ""
Write-Host ("Run directory: " + $RunDir)
Write-Host ("State: " + $StatePath)
Write-Host ("Passed: " + $Passed)
Write-Host ("Failed: " + $Failed)

if ($Failed -eq 0) {
    Write-Host "PASS: remaining v1.2 canaries passed." `
        -ForegroundColor Green
}
else {
    Write-Warning "One or more remaining canaries failed."
}
