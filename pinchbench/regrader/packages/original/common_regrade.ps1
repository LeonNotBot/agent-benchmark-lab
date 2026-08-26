function Resolve-RegradePython {
    param(
        [string]$Python = ""
    )

    $Candidates = @()

    if (-not [string]::IsNullOrWhiteSpace($Python)) {
        $Candidates += $Python
    }

    $Candidates += @(
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
        "No supported Python was found. Tried: " +
        ($Candidates -join " | ")
    )
}

function Assert-RegradeKey {
    if ([string]::IsNullOrWhiteSpace(
        [string]$env:OPENROUTER_API_KEY
    )) {
        throw (
            "OPENROUTER_API_KEY is missing in this PowerShell. " +
            "One OpenRouter key is enough for all four regrades."
        )
    }
}

function Set-RegradeProxy {
    param(
        [string]$ProxyUrl = "http://127.0.0.1:10090"
    )

    if (-not [string]::IsNullOrWhiteSpace($ProxyUrl)) {
        $env:HTTP_PROXY = $ProxyUrl
        $env:HTTPS_PROXY = $ProxyUrl
        $env:ALL_PROXY = $ProxyUrl
    }

    $env:NO_PROXY = "localhost,127.0.0.1,::1"
    $env:no_proxy = "localhost,127.0.0.1,::1"
}

function Invoke-RegradeProcess {
    param(
        [Parameter(Mandatory = $true)][string]$Python,
        [Parameter(Mandatory = $true)][string[]]$Arguments,
        [Parameter(Mandatory = $true)][string]$WorkingDirectory,
        [Parameter(Mandatory = $true)][string]$LogPrefix
    )

    $LogDir = "C:\pinchbench-regrades\launcher-logs"
    New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

    $Stamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $Stdout = Join-Path $LogDir (
        $LogPrefix + "-" + $Stamp + ".stdout.txt"
    )
    $Stderr = Join-Path $LogDir (
        $LogPrefix + "-" + $Stamp + ".stderr.txt"
    )

    $Process = Start-Process `
        -FilePath $Python `
        -ArgumentList $Arguments `
        -WorkingDirectory $WorkingDirectory `
        -RedirectStandardOutput $Stdout `
        -RedirectStandardError $Stderr `
        -NoNewWindow `
        -Wait `
        -PassThru

    Write-Host ""
    if (Test-Path -LiteralPath $Stdout) {
        Get-Content `
            -LiteralPath $Stdout `
            -Encoding UTF8 `
            -Tail 240 |
            ForEach-Object { Write-Host $_ }
    }

    if (
        (Test-Path -LiteralPath $Stderr) -and
        (Get-Item -LiteralPath $Stderr).Length -gt 0
    ) {
        Write-Host ""
        Write-Host "stderr tail:" -ForegroundColor Yellow
        Get-Content `
            -LiteralPath $Stderr `
            -Encoding UTF8 `
            -Tail 240 |
            ForEach-Object { Write-Host $_ }
    }

    Write-Host ""
    Write-Host ("Exit code: " + $Process.ExitCode)
    Write-Host ("stdout: " + $Stdout)
    Write-Host ("stderr: " + $Stderr)

    return $Process
}
