param(
    [string]$Root = "C:\pinchbench-gemini",
    [string]$Python = "C:\pinchbench-opencode\.venv\Scripts\python.exe",
    [string]$RunDirectory = ""
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

$Summarizer = Join-Path $PSScriptRoot "summarize_canaries.py"
$AdapterLogs = Join-Path $Root "logs\adapter-v1"

foreach ($Required in @($Python, $Summarizer, $AdapterLogs)) {
    if (-not (Test-Path -LiteralPath $Required)) {
        throw "Required path not found: $Required"
    }
}

if ([string]::IsNullOrWhiteSpace($RunDirectory)) {
    $Latest = Get-ChildItem `
        -LiteralPath (Join-Path $Root "canary-runs") `
        -Directory `
        -Filter "gemini_adapter_*" `
        -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1

    if ($null -eq $Latest) {
        throw "No canary run directory was found."
    }

    $RunDirectory = $Latest.FullName
}

$Stdout = Join-Path $RunDirectory "summary.stdout.txt"
$Stderr = Join-Path $RunDirectory "summary.stderr.txt"

Remove-Item `
    -LiteralPath $Stdout, $Stderr `
    -Force `
    -ErrorAction SilentlyContinue

$Process = Start-Process `
    -FilePath $Python `
    -ArgumentList @(
        "-X", "utf8",
        $Summarizer,
        "--run-dir", $RunDirectory,
        "--adapter-log-dir", $AdapterLogs
    ) `
    -WorkingDirectory $PSScriptRoot `
    -RedirectStandardOutput $Stdout `
    -RedirectStandardError $Stderr `
    -NoNewWindow `
    -Wait `
    -PassThru

if ($Process.ExitCode -ne 0) {
    Write-Host (Get-Content -LiteralPath $Stdout -Raw)
    Write-Host (Get-Content -LiteralPath $Stderr -Raw)
    throw "Canary summary failed with exit code $($Process.ExitCode)."
}

Write-Host (Get-Content -LiteralPath $Stdout -Raw)
Write-Host "PASS: canary summary created." -ForegroundColor Green
Write-Host ("Summary: " + (Join-Path $RunDirectory "canary_summary.json"))
