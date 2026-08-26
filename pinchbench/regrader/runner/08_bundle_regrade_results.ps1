param(
    [string]$RunDir = ""
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

$OutputRoot = "C:\pinchbench-regrades"

if ([string]::IsNullOrWhiteSpace($RunDir)) {
    $Latest = Get-ChildItem `
        -LiteralPath $OutputRoot `
        -Directory `
        -Filter "regrade_*" `
        -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1

    if ($null -eq $Latest) {
        throw "No formal regrade run was found."
    }

    $RunDir = $Latest.FullName
}

$RunDir = (Resolve-Path -LiteralPath $RunDir).Path
$Stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$Stage = Join-Path $env:TEMP (
    "pinchbench-regrade-bundle-" + $Stamp
)
$ManifestTemp = Join-Path $env:TEMP (
    "pinchbench-regrade-manifest-" + $Stamp + ".csv"
)
$Desktop = [Environment]::GetFolderPath("Desktop")
$Zip = Join-Path $Desktop (
    "pinchbench-opus5-regrade-results-" + $Stamp + ".zip"
)

Remove-Item `
    -LiteralPath $Stage `
    -Recurse `
    -Force `
    -ErrorAction SilentlyContinue

Remove-Item `
    -LiteralPath $ManifestTemp, $Zip `
    -Force `
    -ErrorAction SilentlyContinue

New-Item -ItemType Directory -Force -Path $Stage | Out-Null

$IncludeNames = @(
    "run_config.json",
    "source_runs_snapshot.json",
    "state.sqlite",
    "progress.jsonl",
    "heartbeat.json",
    "summary.json",
    "results.json",
    "results.csv",
    "results.partial.json",
    "task_results",
    "worker_logs",
    "exports"
)

foreach ($Name in $IncludeNames) {
    $Source = Join-Path $RunDir $Name
    if (-not (Test-Path -LiteralPath $Source)) {
        continue
    }

    Copy-Item `
        -LiteralPath $Source `
        -Destination (Join-Path $Stage $Name) `
        -Recurse `
        -Force
}

foreach ($Name in @(
    "regrade_pinchbench.py",
    "reference_runner_contract.py",
    "regrade_config.json",
    "source_manifest.yaml",
    "source_run_config.json",
    "source_results_schema.json",
    "VERSION.txt"
)) {
    $Source = Join-Path "C:\pinchbench-regrader" $Name
    if (Test-Path -LiteralPath $Source) {
        Copy-Item `
            -LiteralPath $Source `
            -Destination (Join-Path $Stage $Name) `
            -Force
    }
}

$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$Secrets = @([string]$env:OPENROUTER_API_KEY)

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
            ".yaml",
            ".yml"
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

$Hash = Get-FileHash -LiteralPath $Zip -Algorithm SHA256

Write-Host ""
Write-Host "RE-GRADE BUNDLE READY" -ForegroundColor Green
Write-Host ("Run: " + $RunDir)
Write-Host ("ZIP: " + $Zip)
Write-Host ("SHA256: " + $Hash.Hash)

Remove-Item `
    -LiteralPath $Stage `
    -Recurse `
    -Force `
    -ErrorAction SilentlyContinue
