param(
    [string]$Root = "C:\pinchbench-gemini",
    [string]$Python = "C:\pinchbench-opencode\.venv\Scripts\python.exe",
    [int]$Port = 8766,
    [switch]$SkipLong,
    [int]$DefaultTimeoutSeconds = 300,
    [int]$LongTimeoutSeconds = 480,
    [int]$HeartbeatSeconds = 15
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

$Gemini = Join-Path $Root "cli\node_modules\.bin\gemini.cmd"
$GeminiHome = Join-Path $Root "gemini-home"
$SettingsPath = Join-Path $GeminiHome ".gemini\settings.json"
$BaseUrl = "http://127.0.0.1:$Port"
$Stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$RunDir = Join-Path $Root ("canary-runs\gemini_adapter_" + $Stamp)
$Workspace = Join-Path $RunDir "workspace"
$Logs = Join-Path $RunDir "logs"
$StatePath = Join-Path $RunDir "canary_state.json"
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)

foreach ($Required in @($Gemini, $SettingsPath, $Python)) {
    if (-not (Test-Path -LiteralPath $Required)) {
        throw "Required path not found: $Required"
    }
}

New-Item -ItemType Directory -Force -Path $Workspace, $Logs | Out-Null

try {
    $Health = Invoke-RestMethod `
        -Method Get `
        -Uri "$BaseUrl/healthz" `
        -TimeoutSec 5
}
catch {
    throw "Adapter is not running at $BaseUrl."
}

if ($Health.ok -ne $true -or $Health.ready -ne $true) {
    throw "Adapter health check failed or OpenRouter key is unavailable."
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

$Steps = New-Object System.Collections.ArrayList

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

    $Parts = @(
        Read-JsonlEvents -Path $Path |
        Where-Object {
            $_.type -eq "message" -and
            $_.role -eq "assistant"
        } |
        ForEach-Object {
            [string]$_.content
        }
    )

    return ($Parts -join "")
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
        try {
            Stop-Process `
                -Id $ProcessId `
                -Force `
                -ErrorAction SilentlyContinue
        }
        catch {
        }

        return -1
    }
}

function Invoke-GeminiCanary {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string]$Prompt,
        [string]$ResumeSession = "",
        [int]$TimeoutSeconds = $DefaultTimeoutSeconds
    )

    if ($TimeoutSeconds -lt 30) {
        throw "TimeoutSeconds must be at least 30."
    }

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

    $Start = Get-Date
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
        $Elapsed = ((Get-Date) - $Start).TotalSeconds

        if ($Elapsed -ge $TimeoutSeconds) {
            $TimedOut = $true

            Write-Warning (
                "{0} reached hard timeout after {1:N0}s; " +
                "terminating PID {2} and its child processes." -f
                $Name,
                $Elapsed,
                $Process.Id
            )

            $KillExitCode = Stop-ProcessTree `
                -ProcessId $Process.Id

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
            [math]::Min($HeartbeatSeconds, $Remaining)
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

    $End = Get-Date
    $Status = Get-ResultStatus -Path $StdoutPath

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
        ResultStatus = $Status
        TimedOut = $TimedOut
        TimeoutSeconds = $TimeoutSeconds
        KillExitCode = $KillExitCode
        StartedAt = $Start.ToString("o")
        EndedAt = $End.ToString("o")
        DurationSeconds = [math]::Round(
            ($End - $Start).TotalSeconds,
            3
        )
        Prompt = $PromptPath
        Stdout = $StdoutPath
        Stderr = $StderrPath
    }
}

Write-Host "Canary 1/5: text stream..."
$TextStep = Invoke-GeminiCanary `
    -Name "01_text" `
    -Prompt "Reply with exactly: LOCAL_ADAPTER_TEXT_OK" `
    -TimeoutSeconds 180
$TextValue = Get-AssistantText -Path $TextStep.Stdout
$TextStep["ValidationPassed"] = (
    $TextStep.ExitCode -eq 0 -and
    $TextStep.ResultStatus -eq "success" -and
    $TextValue.Trim() -eq "LOCAL_ADAPTER_TEXT_OK"
)
$TextStep["AssistantText"] = $TextValue.Trim()
[void]$Steps.Add([PSCustomObject]$TextStep)

Write-Host "Canary 2/5: UTF-8 file tool..."
$Utf8File = Join-Path $Workspace "utf8_probe.md"
Remove-Item -LiteralPath $Utf8File -Force -ErrorAction SilentlyContinue
$ChineseLine = -join @(
    [char]20013,
    [char]25991,
    [char]32534,
    [char]30721,
    [char]27979,
    [char]35797
)
$CheckMark = [char]9989
$FilePrompt = @"
Create utf8_probe.md in the current workspace using the built-in write_file tool.

The file must contain exactly these three lines:
Gemini CLI adapter UTF-8 probe
$ChineseLine
Emoji: $CheckMark

Then read the file with read_file and verify all three lines.
"@
$FileStep = Invoke-GeminiCanary `
    -Name "02_utf8_file" `
    -Prompt $FilePrompt `
    -TimeoutSeconds $DefaultTimeoutSeconds

$ExpectedFile = (
    "Gemini CLI adapter UTF-8 probe`n" +
    $ChineseLine + "`n" +
    "Emoji: " + $CheckMark
)
$ActualFile = ""
$Utf8Valid = $false
if (Test-Path -LiteralPath $Utf8File) {
    try {
        $ActualFile = [System.IO.File]::ReadAllText(
            $Utf8File,
            (New-Object System.Text.UTF8Encoding($false, $true))
        )
        $Utf8Valid = $true
    }
    catch {
        $Utf8Valid = $false
    }
}
$NormalizedActual = $ActualFile -replace "`r`n", "`n"
$NormalizedActual = $NormalizedActual.TrimEnd([char[]]@([char]10, [char]13))
$FileStep["ValidationPassed"] = (
    $FileStep.ExitCode -eq 0 -and
    $FileStep.ResultStatus -eq "success" -and
    $Utf8Valid -and
    $NormalizedActual -eq $ExpectedFile
)
$FileStep["FileExists"] = Test-Path -LiteralPath $Utf8File
$FileStep["Utf8Valid"] = $Utf8Valid
[void]$Steps.Add([PSCustomObject]$FileStep)

Write-Host "Canary 3/5: Windows shell tool..."
$ShellFile = Join-Path $Workspace "shell_probe.txt"
Remove-Item -LiteralPath $ShellFile -Force -ErrorAction SilentlyContinue
$ShellPrompt = @'
Use run_shell_command exactly once.

Use a short PowerShell command to create shell_probe.txt in the current
workspace. The file must contain exactly:
shell-ok

Then verify the file using read_file. Do not use a long inline command.
'@
$ShellStep = Invoke-GeminiCanary `
    -Name "03_shell" `
    -Prompt $ShellPrompt `
    -TimeoutSeconds $DefaultTimeoutSeconds
$ShellText = ""
if (Test-Path -LiteralPath $ShellFile) {
    $ShellText = [System.IO.File]::ReadAllText($ShellFile)
}
$ShellStep["ValidationPassed"] = (
    $ShellStep.ExitCode -eq 0 -and
    $ShellStep.ResultStatus -eq "success" -and
    $ShellText.Trim() -eq "shell-ok"
)
$ShellStep["FileExists"] = Test-Path -LiteralPath $ShellFile
[void]$Steps.Add([PSCustomObject]$ShellStep)

if (-not $SkipLong) {
    Write-Host "Canary 4/5: long file write..."
    $LongFile = Join-Path $Workspace "long_write_probe.md"
    Remove-Item -LiteralPath $LongFile -Force -ErrorAction SilentlyContinue
    $LongPrompt = @'
Create long_write_probe.md in the current workspace.

Requirements:
- At least 16,000 characters.
- At least 250 lines.
- Include English, Chinese, code fences, a Markdown table, quotes, and emoji.
- Preserve the complete document.
- Do not embed the full document in one PowerShell command.
- Prefer write_file and replace, using multiple safe edits if needed.
- Read the completed file and report its character and line counts.
'@
    $LongStep = Invoke-GeminiCanary `
        -Name "04_long_write" `
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
    $LongStep["Characters"] = $LongCharacters
    $LongStep["Lines"] = $LongLines
    [void]$Steps.Add([PSCustomObject]$LongStep)
}
else {
    [void]$Steps.Add(
        [PSCustomObject][ordered]@{
            Name = "04_long_write"
            Skipped = $true
            ValidationPassed = $null
        }
    )
}

Write-Host "Canary 5/5: session and resume..."
$Marker = "ORANGE-7391"
$SessionFirst = Invoke-GeminiCanary `
    -Name "05_session_first" `
    -Prompt (
        "Remember the exact marker $Marker for this session. " +
        "Reply with exactly: STORED"
    ) `
    -TimeoutSeconds 180

$FirstEvents = Read-JsonlEvents -Path $SessionFirst.Stdout
$SessionId = [string](
    @(
        $FirstEvents |
        Where-Object { $_.type -eq "init" } |
        Select-Object -First 1
    ).session_id
)

$SessionFirstText = Get-AssistantText -Path $SessionFirst.Stdout
$SessionFirst["ValidationPassed"] = (
    $SessionFirst.ExitCode -eq 0 -and
    $SessionFirst.ResultStatus -eq "success" -and
    $SessionFirstText.Trim() -eq "STORED" -and
    -not [string]::IsNullOrWhiteSpace($SessionId)
)
$SessionFirst["SessionId"] = $SessionId
[void]$Steps.Add([PSCustomObject]$SessionFirst)

if (-not [string]::IsNullOrWhiteSpace($SessionId)) {
    $SessionResume = Invoke-GeminiCanary `
        -Name "05_session_resume" `
        -Prompt (
            "What exact marker did I ask you to remember? " +
            "Reply with the marker only."
        ) `
        -ResumeSession $SessionId `
        -TimeoutSeconds 180

    $SessionResumeText = Get-AssistantText -Path $SessionResume.Stdout
    $SessionResume["ValidationPassed"] = (
        $SessionResume.ExitCode -eq 0 -and
        $SessionResume.ResultStatus -eq "success" -and
        $SessionResumeText.Trim() -eq $Marker
    )
    $SessionResume["AssistantText"] = $SessionResumeText.Trim()
    $SessionResume["SessionId"] = $SessionId
    [void]$Steps.Add([PSCustomObject]$SessionResume)
}
else {
    [void]$Steps.Add(
        [PSCustomObject][ordered]@{
            Name = "05_session_resume"
            Skipped = $true
            Reason = "No session_id in first turn."
            ValidationPassed = $false
        }
    )
}

$Passed = @(
    $Steps |
    Where-Object { $_.ValidationPassed -eq $true }
).Count
$Failed = @(
    $Steps |
    Where-Object { $_.ValidationPassed -eq $false }
).Count
$Skipped = @(
    $Steps |
    Where-Object { $_.Skipped -eq $true }
).Count

$State = [ordered]@{
    RunId = "gemini_adapter_" + $Stamp
    StartedAt = (
        $Steps |
        Where-Object { $null -ne $_.StartedAt } |
        Select-Object -First 1
    ).StartedAt
    CompletedAt = (Get-Date).ToString("o")
    Root = $Root
    RunDirectory = $RunDir
    Workspace = $Workspace
    AdapterUrl = $BaseUrl
    ForcedModel = [string]$Health.forcedModel
    AdapterVersion = [string]$Health.version
    DefaultTimeoutSeconds = $DefaultTimeoutSeconds
    LongTimeoutSeconds = $LongTimeoutSeconds
    HeartbeatSeconds = $HeartbeatSeconds
    Passed = $Passed
    Failed = $Failed
    Skipped = $Skipped
    Steps = $Steps
}

[System.IO.File]::WriteAllText(
    $StatePath,
    ($State | ConvertTo-Json -Depth 30),
    $Utf8NoBom
)

Write-Host ""
Write-Host ("Canary run directory: " + $RunDir)
Write-Host ("Passed: " + $Passed)
Write-Host ("Failed: " + $Failed)
Write-Host ("Skipped: " + $Skipped)

if ($Failed -eq 0) {
    Write-Host "PASS: all executed canaries passed." `
        -ForegroundColor Green
}
else {
    Write-Warning "One or more canaries failed. Do not modify PinchBench runner yet."
}
