param(
    [string]$Root = "C:\pinchbench-gemini",
    [string]$RunDir = "",
    [switch]$IncludeWorkspaces
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

$Runs = Join-Path $Root "runs"

if ([string]::IsNullOrWhiteSpace($RunDir)) {
    $Latest = Get-ChildItem `
        -LiteralPath $Runs `
        -Directory `
        -Filter "gemini_*" `
        -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1

    if ($null -eq $Latest) {
        throw "No Gemini run directory was found."
    }

    $RunDir = $Latest.FullName
}

$RunDir = (Resolve-Path -LiteralPath $RunDir).Path
$Stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$Stage = Join-Path $env:TEMP (
    "gemini-run-diagnostic-" + $Stamp
)
$Desktop = [Environment]::GetFolderPath("Desktop")
$Zip = Join-Path $Desktop (
    "gemini-pinchbench-diagnostic-" + $Stamp + ".zip"
)
$ManifestTemp = Join-Path $env:TEMP (
    "gemini-run-manifest-" + $Stamp + ".csv"
)

Remove-Item `
    -LiteralPath $Stage `
    -Recurse `
    -Force `
    -ErrorAction SilentlyContinue

Remove-Item `
    -LiteralPath $Zip, $ManifestTemp `
    -Force `
    -ErrorAction SilentlyContinue

New-Item -ItemType Directory -Force -Path `
    $Stage,
    (Join-Path $Stage "run"),
    (Join-Path $Stage "runner") |
    Out-Null

$CoreFiles = @(
    "run_config.json",
    "results.json",
    "results.csv",
    "results.xlsx",
    "progress.jsonl",
    "results.partial.json"
)

foreach ($Name in $CoreFiles) {
    $Source = Join-Path $RunDir $Name
    if (Test-Path -LiteralPath $Source) {
        Copy-Item `
            -LiteralPath $Source `
            -Destination (Join-Path $Stage "run\$Name") `
            -Force
    }
}

foreach ($Name in @(
    "transcripts",
    "environment_snapshot"
)) {
    $Source = Join-Path $RunDir $Name
    if (Test-Path -LiteralPath $Source) {
        Copy-Item `
            -LiteralPath $Source `
            -Destination (Join-Path $Stage "run\$Name") `
            -Recurse `
            -Force
    }
}

if ($IncludeWorkspaces) {
    $Source = Join-Path $RunDir "workspaces"
    if (Test-Path -LiteralPath $Source) {
        Copy-Item `
            -LiteralPath $Source `
            -Destination (
                Join-Path $Stage "run\workspaces"
            ) `
            -Recurse `
            -Force
    }
}

$RunnerDir = Join-Path $Root "runner"
foreach ($Name in @(
    "run_pinchbench_gemini_windows.py",
    "common_gemini_runner.ps1",
    "01_preflight_gemini.ps1",
    "02_start_gemini_adapter_v1_2.ps1",
    "03_run_gemini_smoke.ps1",
    "04_monitor_pinchbench_gemini_windows.ps1",
    "05_run_gemini_full.ps1",
    "README_CN.txt",
    "VERSION.txt"
)) {
    $Source = Join-Path $RunnerDir $Name
    if (Test-Path -LiteralPath $Source) {
        Copy-Item `
            -LiteralPath $Source `
            -Destination (Join-Path $Stage "runner\$Name") `
            -Force
    }
}

$AdapterLogs = Join-Path $Root "logs\adapter-v1_2"
if (Test-Path -LiteralPath $AdapterLogs) {
    Copy-Item `
        -LiteralPath $AdapterLogs `
        -Destination (Join-Path $Stage "adapter_logs") `
        -Recurse `
        -Force
}

$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$Secrets = @(
    [string]$env:OPENROUTER_API_KEY,
    [string]$env:GEMINI_API_KEY
)

Get-ChildItem -LiteralPath $Stage -Recurse -File |
    Where-Object {
        @(
            ".txt",
            ".json",
            ".jsonl",
            ".csv",
            ".md",
            ".py",
            ".ps1",
            ".toml"
        ) -contains $_.Extension.ToLowerInvariant()
    } |
    ForEach-Object {
        try {
            $Text = [System.IO.File]::ReadAllText($_.FullName)
            $Redacted = $Text

            foreach ($Secret in $Secrets) {
                if (-not [string]::IsNullOrWhiteSpace($Secret)) {
                    $Redacted = $Redacted.Replace(
                        $Secret,
                        "[REDACTED]"
                    )
                }
            }

            $Redacted = [regex]::Replace(
                $Redacted,
                "sk-or-v1-[A-Za-z0-9_-]{20,}",
                "[REDACTED]"
            )

            if ($Redacted -ne $Text) {
                [System.IO.File]::WriteAllText(
                    $_.FullName,
                    $Redacted,
                    $Utf8NoBom
                )
            }
        }
        catch {
        }
    }

$Rows = @(
    Get-ChildItem -LiteralPath $Stage -Recurse -File |
    Sort-Object FullName |
    ForEach-Object {
        $Hash = Get-FileHash `
            -LiteralPath $_.FullName `
            -Algorithm SHA256

        [PSCustomObject]@{
            File = $_.FullName.Substring(
                $Stage.TrimEnd("\").Length + 1
            )
            Length = $_.Length
            SHA256 = $Hash.Hash
        }
    }
)

$Rows |
    Export-Csv `
        -LiteralPath $ManifestTemp `
        -NoTypeInformation `
        -Encoding UTF8

Move-Item `
    -LiteralPath $ManifestTemp `
    -Destination (
        Join-Path $Stage "bundle_inventory_sha256.csv"
    ) `
    -Force

Compress-Archive `
    -Path (Join-Path $Stage "*") `
    -DestinationPath $Zip `
    -CompressionLevel Optimal `
    -Force

$ZipHash = Get-FileHash `
    -LiteralPath $Zip `
    -Algorithm SHA256

Write-Host ""
Write-Host "DIAGNOSTIC ZIP READY" -ForegroundColor Green
Write-Host ("Run: " + $RunDir)
Write-Host ("ZIP: " + $Zip)
Write-Host ("SHA256: " + $ZipHash.Hash)
Write-Host (
    "Workspaces included: " +
    [bool]$IncludeWorkspaces
)

Remove-Item `
    -LiteralPath $Stage `
    -Recurse `
    -Force `
    -ErrorAction SilentlyContinue
