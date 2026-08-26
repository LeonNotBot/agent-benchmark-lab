function Resolve-PythonPath {
    param(
        [Parameter(Mandatory = $true)][string]$Root,
        [string]$Python = ""
    )

    $Candidates = @()

    if (-not [string]::IsNullOrWhiteSpace($Python)) {
        $Candidates += $Python
    }

    $Candidates += @(
        (Join-Path $Root ".venv\Scripts\python.exe"),
        "C:\pinchbench-opencode\.venv\Scripts\python.exe",
        "C:\pinchbench-codex\.venv\Scripts\python.exe"
    )

    foreach ($Candidate in $Candidates) {
        if (
            -not [string]::IsNullOrWhiteSpace($Candidate) -and
            (Test-Path -LiteralPath $Candidate)
        ) {
            return (Resolve-Path -LiteralPath $Candidate).Path
        }
    }

    throw (
        "No supported Python environment was found. Tried: " +
        ($Candidates -join " | ")
    )
}

function Resolve-SkillPath {
    param(
        [Parameter(Mandatory = $true)][string]$Root,
        [string]$SkillDir = ""
    )

    $Candidates = @()

    if (-not [string]::IsNullOrWhiteSpace($SkillDir)) {
        $Candidates += $SkillDir
    }

    $Candidates += @(
        (Join-Path $Root "skill"),
        "C:\pinchbench-codex\skill",
        "C:\pinchbench-opencode\skill",
        "C:\pinchbench-qwen-code\skill",
        "C:\pinchbench-ccb\skill"
    )

    foreach ($Candidate in $Candidates) {
        if (
            -not [string]::IsNullOrWhiteSpace($Candidate) -and
            (Test-Path -LiteralPath $Candidate) -and
            (Test-Path -LiteralPath (
                Join-Path $Candidate "tasks\manifest.yaml"
            )) -and
            (Test-Path -LiteralPath (
                Join-Path $Candidate "scripts\lib_grading.py"
            ))
        ) {
            return (Resolve-Path -LiteralPath $Candidate).Path
        }
    }

    throw (
        "No valid PinchBench skill checkout was found. Tried: " +
        ($Candidates -join " | ")
    )
}

function Set-ProxyEnvironment {
    param(
        [string]$ProxyUrl = "http://127.0.0.1:10090"
    )

    if (-not [string]::IsNullOrWhiteSpace($ProxyUrl)) {
        $env:HTTP_PROXY = $ProxyUrl
        $env:HTTPS_PROXY = $ProxyUrl
        $env:ALL_PROXY = $ProxyUrl
    }

    $NoProxyItems = @(
        "localhost",
        "127.0.0.1",
        "::1"
    )

    foreach ($Existing in @(
        [string]$env:NO_PROXY,
        [string]$env:no_proxy
    )) {
        if (-not [string]::IsNullOrWhiteSpace($Existing)) {
            $NoProxyItems += (
                $Existing -split "," |
                ForEach-Object { $_.Trim() } |
                Where-Object { $_ }
            )
        }
    }

    $NoProxyValue = (
        $NoProxyItems |
        Select-Object -Unique
    ) -join ","

    $env:NO_PROXY = $NoProxyValue
    $env:no_proxy = $NoProxyValue
}

function Assert-OpenRouterKey {
    if ([string]::IsNullOrWhiteSpace(
        [string]$env:OPENROUTER_API_KEY
    )) {
        throw (
            "OPENROUTER_API_KEY is missing in this PowerShell. " +
            "Window A needs it for the tested model; " +
            "window B needs it for the PinchBench Judge."
        )
    }
}

function Get-GeminiRunnerPaths {
    param(
        [Parameter(Mandatory = $true)][string]$Root,
        [string]$Python = "",
        [string]$SkillDir = ""
    )

    $ResolvedPython = Resolve-PythonPath `
        -Root $Root `
        -Python $Python

    $ResolvedSkill = Resolve-SkillPath `
        -Root $Root `
        -SkillDir $SkillDir

    $Runner = Join-Path $Root `
        "runner\run_pinchbench_gemini_windows.py"
    $Gemini = Join-Path $Root `
        "cli\node_modules\.bin\gemini.cmd"
    $GeminiHome = Join-Path $Root "gemini-home"
    $Runs = Join-Path $Root "runs"
    $Logs = Join-Path $Root "logs\gemini-runner"

    foreach ($Required in @(
        $ResolvedPython,
        $ResolvedSkill,
        $Runner,
        $Gemini,
        $GeminiHome
    )) {
        if (-not (Test-Path -LiteralPath $Required)) {
            throw "Required path not found: $Required"
        }
    }

    New-Item -ItemType Directory -Force -Path $Runs, $Logs |
        Out-Null

    return [PSCustomObject]@{
        Python = $ResolvedPython
        Skill = $ResolvedSkill
        Runner = $Runner
        Gemini = $Gemini
        GeminiHome = $GeminiHome
        Runs = $Runs
        Logs = $Logs
    }
}

function Show-LoggedProcessResult {
    param(
        [Parameter(Mandatory = $true)]$Process,
        [Parameter(Mandatory = $true)][string]$StdoutPath,
        [Parameter(Mandatory = $true)][string]$StderrPath,
        [int]$TailLines = 120
    )

    Write-Host ""

    if (Test-Path -LiteralPath $StdoutPath) {
        Get-Content `
            -LiteralPath $StdoutPath `
            -Encoding UTF8 `
            -Tail $TailLines
    }

    if (
        (Test-Path -LiteralPath $StderrPath) -and
        (Get-Item -LiteralPath $StderrPath).Length -gt 0
    ) {
        Write-Host ""
        Write-Host "stderr tail:" -ForegroundColor Yellow
        Get-Content `
            -LiteralPath $StderrPath `
            -Encoding UTF8 `
            -Tail $TailLines
    }

    Write-Host ""
    Write-Host ("Exit code: " + $Process.ExitCode)
    Write-Host ("stdout: " + $StdoutPath)
    Write-Host ("stderr: " + $StderrPath)
}
